import { describe, expect, it } from "vitest";
import { canIssueInvitation, isActionableInvitation, validNewPageScope } from "@/lib/domain/workspaceInvitationPolicy";

const owner = { accountId: "user_owner", role: "owner" as const, status: "active" as const };
const admin = { accountId: "user_admin", role: "admin" as const, status: "active" as const };
const revoked = { accountId: "user_target", role: "member" as const, status: "revoked" as const };
const scope = (pageId: string, parentId: string | null, teamspaceId: string | null = null,
  workspaceId = "myspace") => ({ pageId, parentId, teamspaceId, workspaceId });

describe("Max 2.0 invitation security contract", () => {
  it("permits only a verified owner/admin to invite a distinct account", () => {
    expect(canIssueInvitation(owner, owner.accountId, "user_new", "admin", null)).toBe(true);
    expect(canIssueInvitation(admin, owner.accountId, "user_new", "member", null)).toBe(true);
    expect(canIssueInvitation(admin, owner.accountId, "user_new", "admin", null)).toBe(false);
  });
  it("fails closed for forged owner roles and unauthorized actors", () => {
    expect(canIssueInvitation(owner, "other_owner", "user_new", "member", null)).toBe(false);
    expect(canIssueInvitation({ ...admin, status: "suspended" }, owner.accountId, "user_new", "member", null)).toBe(false);
    expect(canIssueInvitation({ accountId: "user_guest", role: "guest", status: "active" }, owner.accountId, "user_new", "guest", null)).toBe(false);
  });
  it("prevents inviting self, owner, malformed IDs and already active targets", () => {
    expect(canIssueInvitation(owner, owner.accountId, owner.accountId, "member", null)).toBe(false);
    expect(canIssueInvitation(admin, owner.accountId, admin.accountId, "member", null)).toBe(false);
    expect(canIssueInvitation(owner, owner.accountId, "../bad", "member", null)).toBe(false);
    expect(canIssueInvitation(owner, owner.accountId, "user_target", "member", { ...revoked, status: "active" })).toBe(false);
    expect(canIssueInvitation(owner, owner.accountId, "user_target", "member", { ...revoked, status: "suspended" })).toBe(false);
  });
  it("allows verified rejoin of revoked ordinary members but not a revoked owner", () => {
    expect(canIssueInvitation(owner, owner.accountId, "user_target", "member", revoked)).toBe(true);
    expect(canIssueInvitation(admin, owner.accountId, "user_target", "member", { ...revoked, role: "admin" })).toBe(false);
    expect(canIssueInvitation(owner, owner.accountId, "user_target", "member", { ...revoked, role: "owner" })).toBe(false);
    expect(canIssueInvitation(owner, owner.accountId, "user_target", "guest", { ...revoked, accountId: "other" })).toBe(false);
  });
});

describe("shadow page scope provisioning contract", () => {
  it("allows valid roots and continuous same-tenant ancestry", () => {
    expect(validNewPageScope("myspace", "new", null, null, [], true)).toBe(true);
    expect(validNewPageScope("myspace", "new", "child", "team1",
      [scope("child", "root", "team1"), scope("root", null, "team1")], true)).toBe(true);
  });
  it("rejects missing, cross-tenant, cyclic and misordered ancestry", () => {
    expect(validNewPageScope("myspace", "new", "parent", null, [], true)).toBe(false);
    expect(validNewPageScope("myspace", "new", "parent", null, [scope("parent", null, null, "otherws")], true)).toBe(false);
    expect(validNewPageScope("myspace", "new", "parent", null, [scope("parent", "new")], true)).toBe(false);
    expect(validNewPageScope("myspace", "new", "parent", null, [scope("wrong", null)], true)).toBe(false);
  });
  it("keeps teamspace scope boundaries and registry integrity", () => {
    expect(validNewPageScope("myspace", "new", null, "team1", [], false)).toBe(false);
    expect(validNewPageScope("myspace", "new", "parent", "team1", [scope("parent", null, null)], true)).toBe(false);
    expect(validNewPageScope("myspace", "new", "parent", null, [scope("parent", null, "team1")], true)).toBe(false);
  });
  it("enforces valid workspace and IDs, plus a bounded ancestry depth", () => {
    expect(validNewPageScope("x", "new", null, null, [], true)).toBe(false);
    expect(validNewPageScope("myspace", "../bad", null, null, [], true)).toBe(false);
    const chain = Array.from({ length: 64 }, (_, i) => scope("p" + i, i === 63 ? null : "p" + (i + 1)));
    expect(validNewPageScope("myspace", "new", "p0", null, chain, true)).toBe(false);
  });
});

describe("actionable invitation integrity and replay safety", () => {
  const now = 1_800_000_000_000;
  const invite = {
    workspaceId: "workspace01", targetAccountId: "user_target", createdByAccountId: "user_owner",
    role: "member", status: "pending", createdAt: now - 60_000,
    expiresAt: now + 3_600_000, resolvedAt: null,
  };
  it("accepts a pending invitation only for its exact subject and valid lifetime", () => {
    expect(isActionableInvitation(invite, "user_target", now)).toBe(true);
    expect(isActionableInvitation(invite, "user_other", now)).toBe(false);
  });
  it("rejects replay, resolved and expired invitation records", () => {
    expect(isActionableInvitation({ ...invite, status: "accepted" }, "user_target", now)).toBe(false);
    expect(isActionableInvitation({ ...invite, resolvedAt: now }, "user_target", now)).toBe(false);
    expect(isActionableInvitation({ ...invite, expiresAt: now }, "user_target", now)).toBe(false);
  });
  it("rejects malformed times, future issuance and excessive TTL", () => {
    expect(isActionableInvitation({ ...invite, createdAt: now + 1 }, "user_target", now)).toBe(false);
    expect(isActionableInvitation({ ...invite, expiresAt: now + 169 * 3_600_000 }, "user_target", now)).toBe(false);
    expect(isActionableInvitation({ ...invite, expiresAt: Infinity }, "user_target", now)).toBe(false);
    expect(isActionableInvitation({ ...invite, createdAt: NaN }, "user_target", now)).toBe(false);
  });
  it("rejects forged issuer and malformed scope fields", () => {
    expect(isActionableInvitation({ ...invite, createdByAccountId: "user_target" }, "user_target", now)).toBe(false);
    expect(isActionableInvitation({ ...invite, workspaceId: "../other" }, "user_target", now)).toBe(false);
    expect(isActionableInvitation({ ...invite, role: "owner" }, "user_target", now)).toBe(false);
  });
});
