import { describe, expect, it } from "vitest";
import {
  canAccessWorkspacePageFromServer, type WorkspaceAuthorizationStore,
} from "@/lib/domain/workspaceAccessGateway";

type Fixtures = {
  workspaceId?: string;
  ownerId?: string;
  status?: "active" | "disabled";
  members?: Array<{ accountId: string; role: "owner" | "admin" | "member" | "guest"; status: "active" | "suspended" | "revoked" }>;
  groups?: Array<{ id: string; status: "active" | "suspended" | "revoked" }>;
  teams?: Array<{ id: string; status: "active" | "suspended" | "revoked" }>;
  groupRegistry?: string[];
  teamRegistry?: string[];
  scopes?: Array<{ pageId: string; workspaceId: string; parentId: string | null; teamspaceId: string | null }>;
  grants?: Array<{ pageId: string; subjectType: "account" | "group" | "workspace_role"; subjectId: string; effect: "allow" | "deny"; level: "view" | "comment" | "edit_content" | "edit" | "full_access" }>;
};
const ws = "workspace1";
const root = { pageId: "root", workspaceId: ws, parentId: null, teamspaceId: null };
const member = { accountId: "clerk_member", role: "member" as const, status: "active" as const };
const owner = { accountId: "clerk_owner", role: "owner" as const, status: "active" as const };
const groupAllow = { pageId: "root", subjectType: "group" as const, subjectId: "group1", effect: "allow" as const, level: "view" as const };

function fixture(options: Fixtures = {}): WorkspaceAuthorizationStore {
  const workspaceId = options.workspaceId ?? ws;
  const members = options.members ?? [owner, member];
  const groups = options.groups ?? [];
  const teams = options.teams ?? [];
  const scopes = options.scopes ?? [root];
  const grants = options.grants ?? [];
  const groupsRegistered = options.groupRegistry ?? [];
  const teamsRegistered = options.teamRegistry ?? [];
  return {
    workspaces: async (id) => id === workspaceId ? [{ workspaceId, ownerId: options.ownerId ?? owner.accountId, status: options.status ?? "active" }] : [],
    memberships: async (id, accountId) => id === workspaceId ? members.filter((m) => m.accountId === accountId).map((m) => ({ ...m, workspaceId: id })) : [],
    groups: async (id, accountId) => id === workspaceId && members.some((m) => m.accountId === accountId) ? groups.map((g) => ({ ...g, workspaceId: id, accountId })) : [],
    teamspaces: async (id, accountId) => id === workspaceId && members.some((m) => m.accountId === accountId) ? teams.map((t) => ({ ...t, workspaceId: id, accountId })) : [],
    groupRegistrations: async (id, groupId) => id === workspaceId && groupsRegistered.includes(groupId) ? [{ workspaceId, groupId }] : [],
    teamspaceRegistrations: async (id, teamspaceId) => id === workspaceId && teamsRegistered.includes(teamspaceId) ? [{ workspaceId, teamspaceId }] : [],
    scopes: async (id, page) => scopes.filter((s) => s.workspaceId === id && s.pageId === page),
    grants: async (id, page) => id === workspaceId ? grants.filter((g) => g.pageId === page).map((g) => ({
      workspaceId: id, pageId: page,
      subjectType: g.subjectType, subjectId: g.subjectId, effect: g.effect, level: g.level,
    })) : [],
  };
}
const can = (source: WorkspaceAuthorizationStore, account: string | null, page = "root") =>
  canAccessWorkspacePageFromServer(source, account, ws, page, "view");

describe("Max 2.0 shadow authorization: synthetic multi-account isolation", () => {
  it("denies anonymous users and outsiders even when they know a page ID", async () => {
    const source = fixture({ grants: [{ ...groupAllow, subjectType: "account", subjectId: "clerk_outsider" }] });
    expect(await can(source, null)).toBe(false);
    expect(await can(source, "clerk_outsider")).toBe(false);
  });
  it("requires an active membership and rejects forged owner rows", async () => {
    for (const status of ["suspended", "revoked"] as const) {
      expect(await can(fixture({ members: [owner, { ...member, status }] }), member.accountId)).toBe(false);
    }
    expect(await can(fixture({ ownerId: "clerk_someone_else" }), owner.accountId)).toBe(false);
    expect(await can(fixture({ members: [owner, member, member] }), member.accountId)).toBe(false);
  });
  it("accepts group ACLs only for registered active affiliations", async () => {
    const opts: Fixtures = { groups: [{ id: "group1", status: "active" }], groupRegistry: ["group1"], grants: [groupAllow] };
    expect(await can(fixture(opts), member.accountId)).toBe(true);
    expect(await can(fixture({ ...opts, groupRegistry: [] }), member.accountId)).toBe(false);
    expect(await can(fixture({ ...opts, groups: [{ id: "group1", status: "revoked" }] }), member.accountId)).toBe(false);
    expect(await can(fixture({ ...opts, groups: [{ id: "group1", status: "active" }, { id: "group1", status: "revoked" }] }), member.accountId)).toBe(false);
  });
  it("requires teamspace registry and membership before scoped page access", async () => {
    const page = { pageId: "teamPage", workspaceId: ws, parentId: null, teamspaceId: "team1" };
    const opts: Fixtures = {
      scopes: [page], teams: [{ id: "team1", status: "active" }],
      teamRegistry: ["team1"], grants: [{ ...groupAllow, pageId: "teamPage", subjectType: "account", subjectId: member.accountId }],
    };
    expect(await can(fixture(opts), member.accountId, "teamPage")).toBe(true);
    expect(await can(fixture({ ...opts, teamRegistry: [] }), member.accountId, "teamPage")).toBe(false);
    expect(await can(fixture({ ...opts, teams: [{ id: "team2", status: "active" }], teamRegistry: ["team2"] }), member.accountId, "teamPage")).toBe(false);
  });
  it("blocks cross-tenant ancestry, missing parents and inherited denies", async () => {
    const child = { pageId: "child", workspaceId: ws, parentId: "root", teamspaceId: null };
    const direct = { ...groupAllow, subjectType: "account" as const, subjectId: member.accountId };
    const good: Fixtures = { scopes: [root, child], grants: [{ ...direct, pageId: "root" }] };
    expect(await can(fixture(good), member.accountId, "child")).toBe(true);
    expect(await can(fixture({ ...good, grants: [good.grants![0], { ...direct, pageId: "child", effect: "deny" }] }), member.accountId, "child")).toBe(false);
    expect(await can(fixture({ ...good, scopes: [{ ...root, workspaceId: "anotherws" }, child] }), member.accountId, "child")).toBe(false);
    expect(await can(fixture({ ...good, scopes: [child] }), member.accountId, "child")).toBe(false);
  });
  it("denies malformed, duplicate and oversized affiliation records", async () => {
    const opts: Fixtures = { groups: [{ id: "group1", status: "active" }], groupRegistry: ["group1"], grants: [groupAllow] };
    expect(await can(fixture({ ...opts, groups: [{ id: "../escape", status: "active" }] }), member.accountId)).toBe(false);
    expect(await can(fixture({ ...opts, groups: [{ id: "group1", status: "active" }, { id: "group1", status: "active" }] }), member.accountId)).toBe(false);
    expect(await can(fixture({ ...opts, groups: Array.from({ length: 101 }, (_, i) => ({ id: "group" + i, status: "active" as const })) }), member.accountId)).toBe(false);
  });
});
