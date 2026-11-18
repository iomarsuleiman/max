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

function fixture() {
  const workspaces: WorkspaceRow[] = [{ workspaceId: "acme01", ownerId: "alice", status: "active" }];
  const memberships: Array<Omit<MembershipRow, "workspaceId">> = [
    { accountId: "alice", role: "owner", status: "active" },
    { accountId: "bob", role: "member", status: "active" },
    { accountId: "carol", role: "guest", status: "active" },
  ];
  const groups = new Map<string, Array<Omit<AffiliationRow, "workspaceId" | "accountId">>>([["bob", [{ id: "writers", status: "active" }]]]);
  const teamspaces = new Map<string, Array<Omit<AffiliationRow, "workspaceId" | "accountId">>>([["bob", [{ id: "ts1", status: "active" }]]]);
  const scopes: ScopeRow[] = [
    { pageId: "root", workspaceId: "acme01", parentId: null, teamspaceId: null },
    { pageId: "child", workspaceId: "acme01", parentId: "root", teamspaceId: null },
    { pageId: "secret", workspaceId: "acme01", parentId: "root", teamspaceId: "ts1" },
  ];
  const grants = new Map<string, Array<Omit<GrantRow, "workspaceId" | "pageId">>>([["root", [{ subjectType: "group", subjectId: "writers", effect: "allow", level: "edit" }]]]);
  let scopeReads = 0;
  const store: WorkspaceAuthorizationStore = {
    workspaces: async (id) => workspaces.filter((w) => w.workspaceId === id),
    memberships: async (id, account) => memberships.filter((m) => m.accountId === account).map((m) => ({ ...m, workspaceId: id })),
    groups: async (id, account) => (groups.get(account) ?? []).map((g) => ({ ...g, workspaceId: id, accountId: account })),
    teamspaces: async (id, account) => (teamspaces.get(account) ?? []).map((t) => ({ ...t, workspaceId: id, accountId: account })),
    groupRegistrations: async (id, groupId) => id === "acme01" && groupId === "writers"
      ? [{ workspaceId: id, groupId }] : [],
    teamspaceRegistrations: async (id, teamspaceId) => id === "acme01" && teamspaceId === "ts1"
      ? [{ workspaceId: id, teamspaceId }] : [],
    scopes: async (id, page) => { scopeReads++; return scopes.filter((p) => p.workspaceId === id && p.pageId === page); },
    grants: async (id, page) => (grants.get(page) ?? []).map((g) => ({ ...g, workspaceId: id, pageId: page })),
  };
  const access = (account: string | null, page: string, capability: "view" | "edit" | "manage" = "view", workspace = "acme01") =>
    canAccessWorkspacePageFromServer(store, account, workspace, page, capability);
  return { workspaces, memberships, groups, teamspaces, scopes, grants, access, store, scopeReadCount: () => scopeReads };
}

describe("Max 2.0 authenticated workspace gateway", () => {
  it("fails closed for anonymous sessions, strangers and unknown workspaces without reading page scopes", async () => {
    const a = fixture();
    expect(await a.access(null, "root")).toBe(false);
    expect(await a.access("stranger", "root")).toBe(false);
    expect(await a.access("bob", "root", "view", "other")).toBe(false);
    expect(a.scopeReadCount()).toBe(0);
  });
  it("derives role and grants from the server and respects capability levels", async () => {
    const a = fixture();
    expect(await a.access("bob", "child", "edit")).toBe(true);
    expect(await a.access("bob", "child", "manage")).toBe(false);
    expect(await a.access("carol", "child")).toBe(false);
  });
  it("revokes access immediately when membership is suspended or removed", async () => {
    const a = fixture();
    a.memberships[1].status = "suspended";
    expect(await a.access("bob", "child")).toBe(false);
    a.memberships[1].status = "revoked";
    expect(await a.access("bob", "child")).toBe(false);
    a.memberships.splice(1, 1);
    expect(await a.access("bob", "child")).toBe(false);
  });
  it("does not permit mismatched or duplicated owner/membership claims", async () => {
    const a = fixture();
    a.memberships[1].role = "owner";
    expect(await a.access("bob", "root")).toBe(false);
    a.memberships[1].role = "member";
    a.memberships.push({ ...a.memberships[1] });
    expect(await a.access("bob", "root")).toBe(false);
    a.memberships.pop();
    a.workspaces.push({ ...a.workspaces[0] });
    expect(await a.access("alice", "root")).toBe(false);
  });
  it("enforces teamspace membership and immediate teamspace revocation", async () => {
    const a = fixture();
    expect(await a.access("bob", "secret")).toBe(true);
    a.teamspaces.set("bob", [{ id: "ts1", status: "revoked" }]);
    expect(await a.access("bob", "secret")).toBe(false);
    expect(await a.access("alice", "secret")).toBe(false); // even owners need teamspace membership
  });
  it("applies inherited deny before direct grants or owner privilege", async () => {
    const a = fixture();
    a.grants.set("root", [
      { subjectType: "group", subjectId: "writers", effect: "allow", level: "full_access" },
      { subjectType: "account", subjectId: "bob", effect: "deny", level: "view" },
      { subjectType: "account", subjectId: "alice", effect: "deny", level: "view" },
    ]);
    a.grants.set("child", [{ subjectType: "account", subjectId: "bob", effect: "allow", level: "full_access" }]);
    expect(await a.access("bob", "child", "manage")).toBe(false);
    expect(await a.access("alice", "child")).toBe(false);
  });
  it("rejects missing parents, cross-tenant ancestry, cycles and duplicate scopes", async () => {
    const a = fixture();
    a.scopes[1].parentId = "missing";
    expect(await a.access("alice", "child")).toBe(false);
    a.scopes[1].parentId = "root";
    a.scopes[0].workspaceId = "other";
    expect(await a.access("alice", "child")).toBe(false);
    a.scopes[0].workspaceId = "acme01";
    a.scopes[0].parentId = "child";
    expect(await a.access("alice", "child")).toBe(false);
    a.scopes[0].parentId = null;
    a.scopes.push({ ...a.scopes[0] });
    expect(await a.access("alice", "root")).toBe(false);
  });
  it("disables the entire workspace and rejects blank/grant-corrupt data", async () => {
    const a = fixture();
    a.workspaces[0].status = "disabled";
    expect(await a.access("alice", "root")).toBe(false);
    a.workspaces[0].status = "active";
    a.grants.set("root", [{ subjectType: "account", subjectId: "", effect: "allow", level: "full_access" }]);
    expect(await a.access("alice", "root")).toBe(false);
    expect(await a.access("bob", "")).toBe(false);
  });
});
