import { describe, expect, it } from "vitest";
import { canAccessPage, retainsWorkspaceOwner, type PermissionSnapshot, type VerifiedPrincipal } from "@/lib/domain/workspacePolicy";

const member: VerifiedPrincipal = {
  accountId: "alice", workspaceId: "w1", role: "member",
  membershipStatus: "active", groupIds: ["team"], teamspaceIds: ["engineering"],
};
const policy: PermissionSnapshot = {
  pages: [
    { id: "root", workspaceId: "w1", parentId: null, teamspaceId: null },
    { id: "child", workspaceId: "w1", parentId: "root", teamspaceId: null },
    { id: "private", workspaceId: "w1", parentId: "root", teamspaceId: "engineering" },
    { id: "foreign", workspaceId: "w2", parentId: null, teamspaceId: null },
  ],
  grants: [{ pageId: "root", subject: { type: "group", id: "team" }, effect: "allow", level: "edit" }],
};

describe("Max 2.0 workspace permission contract (not connected to production)", () => {
  it("denies by default and inherits explicit group grants", () => {
    expect(canAccessPage({ ...member, groupIds: [] }, "child", "view", policy)).toBe(false);
    expect(canAccessPage(member, "child", "edit", policy)).toBe(true);
    expect(canAccessPage(member, "child", "manage", policy)).toBe(false);
  });
  it("revocation overrides prior and inherited access", () => {
    expect(canAccessPage({ ...member, membershipStatus: "revoked" }, "child", "view", policy)).toBe(false);
    expect(canAccessPage({ ...member, membershipStatus: "suspended" }, "child", "view", policy)).toBe(false);
  });
  it("denials win even over broad roles and page grants", () => {
    const denied: PermissionSnapshot = {
      ...policy,
      grants: [...policy.grants, { pageId: "child", subject: { type: "account", id: "alice" }, effect: "deny", level: "view" }],
    };
    expect(canAccessPage(member, "child", "view", denied)).toBe(false);
    expect(canAccessPage({ ...member, role: "admin" }, "child", "view", denied)).toBe(false);
  });
  it("isolates teamspaces and tenants, including for admin", () => {
    expect(canAccessPage({ ...member, teamspaceIds: [] }, "private", "view", policy)).toBe(false);
    expect(canAccessPage(member, "private", "view", policy)).toBe(true);
    expect(canAccessPage({ ...member, role: "owner" }, "foreign", "view", policy)).toBe(false);
  });
  it("fails closed on missing parents, cycles, cross-workspace ancestry and duplicate IDs", () => {
    const alternate = (parentId: string): PermissionSnapshot => ({ ...policy, pages: [
      { id: "broken", workspaceId: "w1", parentId, teamspaceId: null },
      ...policy.pages,
    ] });
    for (const parentId of ["missing", "broken", "foreign"]) {
      expect(canAccessPage(member, "broken", "view", alternate(parentId))).toBe(false);
    }
    expect(canAccessPage(member, "child", "view", { ...policy, pages: [...policy.pages, policy.pages[0]] })).toBe(false);
  });
  it("protects the last active workspace owner", () => {
    const single = [{ accountId: "alice", role: "owner" as const, status: "active" as const }];
    expect(retainsWorkspaceOwner(single, "alice", "member", "active")).toBe(false);
    expect(retainsWorkspaceOwner(single, "alice", "owner", "revoked")).toBe(false);
    expect(retainsWorkspaceOwner([...single, { accountId: "bob", role: "owner" as const, status: "active" as const }], "alice", null, "revoked")).toBe(true);
  });
});
