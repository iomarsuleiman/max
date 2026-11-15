import { describe, expect, it } from "vitest";
import {
  listManagedLinks, nextLinkRevision, previewManagedLink,
  validLinkAudience, validLinkExpiry, validLinkPolicyRow,
  MAX_LINK_POLICIES_PER_SCOPE, type LinkPolicyRow, type LinkPolicyStore,
} from "@/lib/domain/workspaceLinkPolicy";
import type { MembershipRow, ScopeRow, WorkspaceRow } from "@/lib/domain/workspaceAccessGateway";

const workspaceId = "tenant01", pageId = "page01", owner = "clerk_owner";
const guest = "clerk_guest", now = 2000000000000;

function fixture() {
  const workspaces: WorkspaceRow[] = [
    { workspaceId, ownerId: owner, status: "active" },
  ];
  const memberships: MembershipRow[] = [
    { workspaceId, accountId: owner, role: "owner", status: "active" },
    { workspaceId, accountId: guest, role: "member", status: "active" },
  ];
  const scopes: ScopeRow[] = [
    { workspaceId, pageId, parentId: null, teamspaceId: null },
  ];
  const policies: LinkPolicyRow[] = [{
    linkId: "link01", originWorkspaceId: workspaceId, scopeId: pageId,
    issuedByAccountId: owner, audience: "anyone_with_link", state: "active",
    createdAt: now - 1000, expiresAt: now + 10000,
    updatedAt: now - 1000, revokedAt: null,
  }];
  let fail = false;
  const store: LinkPolicyStore = {
    workspaces: async (id) => workspaces.filter((w) => w.workspaceId === id),
    memberships: async (id, actor) =>
      memberships.filter((m) => m.workspaceId === id && m.accountId === actor),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (id, scope) =>
      scopes.filter((s) => s.workspaceId === id && s.pageId === scope),
    grants: async () => [],
    globalScopes: async (scope) => scopes.filter((s) => s.pageId === scope),
    linkPoliciesById: async (id) => {
      if (fail) throw new Error("offline");
      return policies.filter((p) => p.linkId === id);
    },
    linkPoliciesByScope: async (id, scope) => {
      if (fail) throw new Error("offline");
      return policies.filter((p) => p.originWorkspaceId === id && p.scopeId === scope);
    },
  };
  return { policies, scopes, workspaces, memberships, store,
    read: (actor: string | null = owner, at = now) =>
      previewManagedLink(store, actor, "link01", at),
    list: (actor: string | null = owner, at = now) =>
      listManagedLinks(store, actor, workspaceId, pageId, at),
    fail: () => { fail = true; } };
}

describe("Max 2.0 PR38 expiring link-policy management safety", () => {
  it("only current scope managers can inspect link policy metadata", async () => {
    const f = fixture();
    expect(await f.read()).toEqual({
      linkId: "link01", audience: "anyone_with_link", status: "active",
      expiresAt: now + 10000, updatedAt: now - 1000,
    });
    expect(await f.read(guest)).toBeNull();
    expect(await f.read(null)).toBeNull();
  });
  it("never exposes the issuer's identity, tenant ID, scope ID or content", async () => {
    const f = fixture(), data = JSON.stringify(await f.read());
    expect(data).not.toContain(owner);
    expect(data).not.toContain(workspaceId);
    expect(data).not.toContain(pageId);
    expect(data).not.toContain("content");
    expect(data).not.toContain("token");
  });
  it("expired links become inactive at the exact expiry boundary", async () => {
    const f = fixture();
    expect((await f.read(owner, now + 9999))?.status).toBe("active");
    expect((await f.read(owner, now + 10000))?.status).toBe("expired");
  });
  it("revoked policies are terminal even before the expiry", async () => {
    const f = fixture(), row = f.policies[0];
    row.state = "revoked"; row.revokedAt = now - 10; row.updatedAt = now - 10;
    expect((await f.read())?.status).toBe("revoked");
    expect((await f.list())[0]?.status).toBe("revoked");
  });
  it("issuer revocation invalidates a link even while another manager retains access", async () => {
    const f = fixture();
    const replacement = "clerk_new_owner";
    f.policies[0].issuedByAccountId = guest;
    f.memberships[1].status = "revoked";
    expect((await f.read())?.status).toBe("issuer_revoked");
    expect((await f.list())[0]?.status).toBe("issuer_revoked");
    expect(replacement).not.toEqual(owner);
  });
  it("a suspended or revoked manager cannot list or read link policies", async () => {
    const f = fixture();
    f.memberships[0].status = "suspended";
    expect(await f.read()).toBeNull();
    expect(await f.list()).toEqual([]);
  });
  it("rejects disabled tenants and duplicate global scopes", async () => {
    const f = fixture();
    f.workspaces[0].status = "disabled";
    expect(await f.read()).toBeNull();
    f.workspaces[0].status = "active";
    f.scopes.push({ ...f.scopes[0] });
    expect(await f.read()).toBeNull();
    expect(await f.list()).toEqual([]);
  });
  it("rejects a policy referencing the wrong origin tenant or wrong scope", async () => {
    const f = fixture();
    f.policies[0].originWorkspaceId = "tenant02";
    expect(await f.read()).toBeNull();
    f.policies[0].originWorkspaceId = workspaceId;
    f.policies[0].scopeId = "page02";
    expect(await f.read()).toBeNull();
  });
  it("fails closed for duplicate IDs, invalid status and malformed times", async () => {
    const f = fixture(), row = f.policies[0];
    f.policies.push({ ...row });
    expect(await f.read()).toBeNull();
    expect(await f.list()).toEqual([]);
    f.policies.pop();
    expect(validLinkPolicyRow({ ...row, state: "corrupt" as never })).toBe(false);
    expect(validLinkPolicyRow({ ...row, expiresAt: row.createdAt })).toBe(false);
    expect(validLinkPolicyRow({ ...row, updatedAt: NaN })).toBe(false);
  });
  it("validates irrevocable state consistency", () => {
    const row = fixture().policies[0];
    expect(validLinkPolicyRow(row)).toBe(true);
    expect(validLinkPolicyRow({ ...row, revokedAt: now })).toBe(false);
    expect(validLinkPolicyRow({ ...row, state: "revoked", revokedAt: null })).toBe(false);
    expect(validLinkPolicyRow({ ...row, state: "revoked", revokedAt: now + 50 })).toBe(false);
  });
  it("limits link policies to thirty days after original issuance", () => {
    expect(validLinkExpiry(now, now + 30 * 86400000)).toBe(true);
    expect(validLinkExpiry(now, now + 31 * 86400000)).toBe(false);
    expect(validLinkExpiry(now, now)).toBe(false);
    expect(validLinkExpiry(now, Infinity)).toBe(false);
    expect(validLinkPolicyRow({
      ...fixture().policies[0], expiresAt: now + 31 * 86400000,
    })).toBe(false);
  });
  it("only admits explicit link audience values", () => {
    expect(validLinkAudience("workspace_members")).toBe(true);
    expect(validLinkAudience("anyone_with_link")).toBe(true);
    expect(validLinkAudience("public")).toBe(false);
    expect(validLinkAudience("password_protected")).toBe(false);
  });
  it("enforces the 32-row ceiling without partial listing", async () => {
    const f = fixture();
    for (let i = 1; i < MAX_LINK_POLICIES_PER_SCOPE; i++) {
      f.policies.push({ ...f.policies[0], linkId: `link${String(i + 1).padStart(2, "0")}` });
    }
    expect((await f.list()).length).toBe(MAX_LINK_POLICIES_PER_SCOPE);
    f.policies.push({ ...f.policies[0], linkId: "link99" });
    expect(await f.list()).toEqual([]);
  });
  it("rejects duplicate or cross-tenant results in a scope listing", async () => {
    const f = fixture();
    f.policies.push({ ...f.policies[0] });
    expect(await f.list()).toEqual([]);
    f.policies.pop();
    f.policies[0].scopeId = "other-page";
    expect(await f.read()).toBeNull();
  });
  it("keeps monotonic revisions for compare-and-set mutations", () => {
    expect(nextLinkRevision(now, now)).toBe(now + 1);
    expect(nextLinkRevision(now, now + 500)).toBe(now + 500);
    expect(nextLinkRevision(4102444800000, now)).toBeNull();
    expect(nextLinkRevision(now, NaN)).toBeNull();
  });
  it("returns empty results when backend reads fail", async () => {
    const f = fixture(); f.fail();
    expect(await f.read()).toBeNull();
    expect(await f.list()).toEqual([]);
  });
});
