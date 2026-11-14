import { describe, expect, it } from "vitest";
import {
  canAccessWorkspacePageFromServer,
  type WorkspaceAuthorizationStore,
  type WorkspaceRow,
  type MembershipRow,
  type AffiliationRow,
  type ScopeRow,
  type GrantRow,
} from "@/lib/domain/workspaceAccessGateway";

const workspaceId = "tenant01";
const accountId = "clerk_member";
const ownerId = "clerk_owner";
const baseGrant: GrantRow = {
  workspaceId, pageId: "root", subjectType: "account", subjectId: accountId,
  effect: "allow", level: "view",
};

/** Intentionally permissive mock fetches simulate a corrupt index or buggy adapter.
 * The authorization boundary MUST reject untrusted row metadata itself. */
function fixture() {
  const rows: {
    workspaces: WorkspaceRow[];
    memberships: MembershipRow[];
    groups: AffiliationRow[];
    teams: AffiliationRow[];
    scopes: ScopeRow[];
    grants: GrantRow[];
  } = {
    workspaces: [{ workspaceId, ownerId, status: "active" }],
    memberships: [
      { workspaceId, accountId: ownerId, role: "owner", status: "active" },
      { workspaceId, accountId, role: "member", status: "active" },
    ],
    groups: [],
    teams: [],
    scopes: [{ workspaceId, pageId: "root", parentId: null, teamspaceId: null }],
    grants: [{ ...baseGrant }],
  };
  const store: WorkspaceAuthorizationStore = {
    workspaces: async () => rows.workspaces,
    memberships: async (_workspace, id) => rows.memberships.filter((r) => r.accountId === id),
    groups: async () => rows.groups,
    teamspaces: async () => rows.teams,
    groupRegistrations: async (id, groupId) => id === workspaceId && groupId === "group1"
      ? [{ workspaceId, groupId }] : [],
    teamspaceRegistrations: async (id, teamspaceId) => id === workspaceId && teamspaceId === "team1"
      ? [{ workspaceId, teamspaceId }] : [],
    scopes: async (_workspace, id) => rows.scopes.filter((r) => r.pageId === id),
    grants: async () => rows.grants,
  };
  const can = (id: string | null, pageId = "root", capability: "view" | "manage" = "view") =>
    canAccessWorkspacePageFromServer(store, id, workspaceId, pageId, capability);
  return { rows, can };
}

describe("Max 2.0 authorization snapshot integrity", () => {
  it("preserves legitimate member and owner access on clean rows", async () => {
    const { can } = fixture();
    expect(await can(accountId)).toBe(true);
    expect(await can(accountId, "root", "manage")).toBe(false);
    expect(await can(ownerId, "root", "manage")).toBe(true);
  });

  it("denies an unrelated malformed ACL entry instead of skipping it", async () => {
    const { rows, can } = fixture();
    rows.grants.push({
      ...baseGrant, subjectType: "workspace_role", subjectId: "not-a-role",
    });
    expect(await can(accountId)).toBe(false);
    expect(await can(ownerId)).toBe(false);
  });

  it("denies duplicate grants, including same subject with conflicting effects", async () => {
    const { rows, can } = fixture();
    rows.grants.push({ ...baseGrant, effect: "deny" });
    expect(await can(accountId)).toBe(false);
    expect(await can(ownerId)).toBe(false);
  });

  it("denies cross-workspace and cross-page grant rows even for an owner", async () => {
    for (const altered of [
      { workspaceId: "tenant02" },
      { pageId: "anotherPage" },
    ]) {
      const { rows, can } = fixture();
      rows.grants.push({ ...baseGrant, ...altered, subjectId: "stranger" });
      expect(await can(ownerId)).toBe(false);
      expect(await can(accountId)).toBe(false);
    }
  });

  it("fails closed on an oversized ACL read rather than silently truncating", async () => {
    const { rows, can } = fixture();
    rows.grants = Array.from({ length: 101 }, (_, i) => ({
      ...baseGrant, subjectId: `account_${i}`,
    }));
    expect(await can(ownerId)).toBe(false);
  });

  it("rejects invalid effect, level and identity fields in persisted grants", async () => {
    for (const patch of [
      { effect: "accept" },
      { level: "superuser" },
      { subjectId: "../escape" },
      { subjectType: "unknown" },
    ]) {
      const { rows, can } = fixture();
      rows.grants = [{ ...baseGrant, ...patch } as GrantRow];
      expect(await can(ownerId)).toBe(false);
    }
  });

  it("rejects forged or malformed membership and owner identity claims", async () => {
    const { rows, can } = fixture();
    rows.memberships[1].workspaceId = "tenant02";
    expect(await can(accountId)).toBe(false);
    rows.memberships[1].workspaceId = workspaceId;
    rows.memberships[1].role = "superadmin" as MembershipRow["role"];
    expect(await can(accountId)).toBe(false);
    rows.memberships[1].role = "member";
    rows.workspaces[0].ownerId = "../not-an-id";
    expect(await can(ownerId)).toBe(false);
  });

  it("rejects wrong-account and wrong-tenant affiliation records", async () => {
    for (const extra of [
      { workspaceId: "tenant02" },
      { accountId: "clerk_other" },
    ]) {
      const { rows, can } = fixture();
      rows.groups = [{ workspaceId, accountId, id: "group1", status: "active", ...extra }];
      rows.grants = [{ ...baseGrant, subjectType: "group", subjectId: "group1" }];
      expect(await can(accountId)).toBe(false);
    }
  });

  it("rejects broken scope metadata before evaluating access", async () => {
    for (const patch of [
      { parentId: "../escape" },
      { teamspaceId: "../escape" },
      { workspaceId: "tenant02" },
    ]) {
      const { rows, can } = fixture();
      rows.scopes[0] = { ...rows.scopes[0], ...patch };
      expect(await can(ownerId)).toBe(false);
    }
  });
});
