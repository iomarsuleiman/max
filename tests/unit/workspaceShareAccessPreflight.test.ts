import { describe, expect, it } from "vitest";
import {
  acceptedExternalSharePreflight, currentMemberLinkPreflight,
  type SharingPreflightStore,
} from "@/lib/domain/workspaceShareAccessPreflight";
import type { ExternalShareRow } from "@/lib/domain/workspaceExternalSharePolicy";
import type { LinkPolicyRow } from "@/lib/domain/workspaceLinkPolicy";
import type {
  GrantRow, MembershipRow, ScopeRow, WorkspaceRow,
} from "@/lib/domain/workspaceAccessGateway";

const source = "tenant01", destination = "tenant02", scope = "page01";
const sourceOwner = "clerk_source_owner", destinationOwner = "clerk_destination_owner";
const member = "clerk_source_member", recipient = "clerk_target_account";
const outsider = "clerk_unrelated_account", now = 2000000000000;
const shareId = "share01", linkId = "link01";

function fixture() {
  const workspaces: WorkspaceRow[] = [
    { workspaceId: source, ownerId: sourceOwner, status: "active" },
    { workspaceId: destination, ownerId: destinationOwner, status: "active" },
  ];
  const memberships: MembershipRow[] = [
    { workspaceId: source, accountId: sourceOwner, role: "owner", status: "active" },
    { workspaceId: source, accountId: member, role: "member", status: "active" },
    { workspaceId: destination, accountId: destinationOwner, role: "owner", status: "active" },
    { workspaceId: destination, accountId: recipient, role: "member", status: "active" },
  ];
  const scopes: ScopeRow[] = [
    { workspaceId: source, pageId: scope, parentId: null, teamspaceId: null },
  ];
  const grants: GrantRow[] = [{
    workspaceId: source, pageId: scope, subjectType: "account",
    subjectId: member, effect: "allow", level: "view",
  }];
  const shares: ExternalShareRow[] = [{
    shareId, originWorkspaceId: source, scopeId: scope,
    targetWorkspaceId: destination, targetAccountId: recipient,
    createdByAccountId: sourceOwner, status: "accepted",
    createdAt: now - 1000, expiresAt: now + 10000,
    resolvedAt: now - 100, updatedAt: now - 100,
  }];
  const links: LinkPolicyRow[] = [{
    linkId, originWorkspaceId: source, scopeId: scope,
    issuedByAccountId: sourceOwner, audience: "workspace_members", state: "active",
    createdAt: now - 1000, expiresAt: now + 10000,
    updatedAt: now - 1000, revokedAt: null,
  }];
  let broken = false;
  const store: SharingPreflightStore = {
    workspaces: async (id) => workspaces.filter((row) => row.workspaceId === id),
    memberships: async (id, actor) => memberships.filter((row) =>
      row.workspaceId === id && row.accountId === actor),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (id, page) => scopes.filter((row) =>
      row.workspaceId === id && row.pageId === page),
    globalScopes: async (page) => scopes.filter((row) => row.pageId === page),
    grants: async (id, page) => grants.filter((row) =>
      row.workspaceId === id && row.pageId === page),
    externalShares: async (id) => {
      if (broken) throw new Error("database unavailable");
      return shares.filter((row) => row.shareId === id);
    },
    linkPoliciesById: async (id) => {
      if (broken) throw new Error("database unavailable");
      return links.filter((row) => row.linkId === id);
    },
    linkPoliciesByScope: async (id, page) =>
      links.filter((row) => row.originWorkspaceId === id && row.scopeId === page),
  };
  return {
    workspaces, memberships, scopes, grants, shares, links,
    external: (actor: string | null = recipient, at = now) =>
      acceptedExternalSharePreflight(store, actor, shareId, at),
    link: (actor: string | null = member, at = now) =>
      currentMemberLinkPreflight(store, actor, linkId, at),
    breakStore: () => { broken = true; },
  };
}

describe("Max 2.0 PR39 fail-closed sharing preflight", () => {
  it("allows a candidate only for the authenticated accepted recipient", async () => {
    const f = fixture();
    expect(await f.external()).toBe(true);
    expect(await f.external(outsider)).toBe(false);
    expect(await f.external(sourceOwner)).toBe(false);
    expect(await f.external(null)).toBe(false);
  });
  it("does not enroll an external recipient in the source tenant", async () => {
    const f = fixture();
    expect(f.memberships.some((m) => m.workspaceId === source && m.accountId === recipient)).toBe(false);
    expect(await f.external()).toBe(true);
    expect(await f.link(recipient)).toBe(false);
  });
  it("requires accepted consent; pending, declined and revoked always deny", async () => {
    const f = fixture(), row = f.shares[0];
    row.status = "pending"; row.resolvedAt = null;
    expect(await f.external()).toBe(false);
    for (const status of ["declined", "revoked"] as const) {
      row.status = status; row.resolvedAt = now - 50;
      expect(await f.external()).toBe(false);
    }
  });
  it("revalidates expiry at the exact boundary", async () => {
    const f = fixture();
    expect(await f.external(recipient, now + 9999)).toBe(true);
    expect(await f.external(recipient, now + 10000)).toBe(false);
    expect(await f.link(member, now + 9999)).toBe(true);
    expect(await f.link(member, now + 10000)).toBe(false);
  });
  it("rejects future-dated issuance and invalid clocks", async () => {
    const f = fixture();
    expect(await f.external(recipient, now - 1001)).toBe(false);
    expect(await f.link(member, now - 1001)).toBe(false);
    expect(await f.external(recipient, NaN)).toBe(false);
    expect(await f.link(member, Infinity)).toBe(false);
  });
  it("enforces current destination membership and tenant liveness", async () => {
    const f = fixture();
    f.memberships.find((m) => m.accountId === recipient)!.status = "revoked";
    expect(await f.external()).toBe(false);
    f.memberships.find((m) => m.accountId === recipient)!.status = "active";
    f.workspaces[1].status = "disabled";
    expect(await f.external()).toBe(false);
  });
  it("invalidates acceptance when the originating manager loses rights", async () => {
    const f = fixture();
    f.memberships[0].status = "revoked";
    expect(await f.external()).toBe(false);
    expect(await f.link(member)).toBe(false);
  });
  it("rejects duplicate, foreign or corrupt external proposals", async () => {
    const f = fixture();
    f.shares.push({ ...f.shares[0] });
    expect(await f.external()).toBe(false);
    f.shares.pop();
    f.shares[0].originWorkspaceId = destination;
    expect(await f.external()).toBe(false);
    f.shares[0].originWorkspaceId = source;
    f.shares[0].resolvedAt = null;
    expect(await f.external()).toBe(false);
  });
  it("rejects duplicated global scopes and scope ownership changes", async () => {
    const f = fixture();
    f.scopes.push({ ...f.scopes[0] });
    expect(await f.external()).toBe(false);
    expect(await f.link()).toBe(false);
    f.scopes.pop();
    f.scopes[0].workspaceId = destination;
    expect(await f.external()).toBe(false);
    expect(await f.link()).toBe(false);
  });
  it("only preflights member links when the caller has CURRENT page view", async () => {
    const f = fixture();
    expect(await f.link()).toBe(true);
    f.grants.length = 0;
    expect(await f.link()).toBe(false);
    expect(await f.link(sourceOwner)).toBe(true);
  });
  it("does not treat anyone-with-link intent as a bearer grant", async () => {
    const f = fixture();
    f.links[0].audience = "anyone_with_link";
    expect(await f.link(sourceOwner)).toBe(false);
    expect(await f.link(member)).toBe(false);
    expect(await f.link(null)).toBe(false);
  });
  it("rejects expired, revoked, invalid or future-issued policies", async () => {
    const f = fixture(), row = f.links[0];
    row.state = "revoked"; row.revokedAt = now - 10; row.updatedAt = now - 10;
    expect(await f.link()).toBe(false);
    row.state = "active"; row.revokedAt = null;
    row.expiresAt = row.createdAt + 31 * 86400000;
    expect(await f.link()).toBe(false);
  });
  it("requires the source issuer to retain manage permission, not just view", async () => {
    const f = fixture();
    f.links[0].issuedByAccountId = member;
    expect(await f.link(member)).toBe(false);
  });
  it("honors current actor revocation and explicit page denies", async () => {
    const f = fixture();
    f.memberships.find((m) => m.accountId === member)!.status = "suspended";
    expect(await f.link()).toBe(false);
    f.memberships.find((m) => m.accountId === member)!.status = "active";
    f.grants[0].effect = "deny";
    expect(await f.link()).toBe(false);
  });
  it("fails closed on duplicate link IDs, bad account IDs and backend exceptions", async () => {
    const f = fixture();
    f.links.push({ ...f.links[0] });
    expect(await f.link()).toBe(false);
    f.links.pop();
    expect(await f.link("bad subject !")).toBe(false);
    f.breakStore();
    expect(await f.link()).toBe(false);
    expect(await f.external()).toBe(false);
  });
  it("returns only booleans, never an access token, ID, document or URL", async () => {
    const f = fixture();
    const result = await f.external();
    expect(typeof result).toBe("boolean");
    expect(JSON.stringify(result)).not.toContain(source);
    expect(JSON.stringify(result)).not.toContain(scope);
    expect(typeof (await f.link())).toBe("boolean");
  });
});
