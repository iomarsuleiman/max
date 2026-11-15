import { describe, expect, it } from "vitest";
import {
  canManageExternalScope, nextExternalShareRevision,
  readAuthorizedExternalShare, validExternalShareExpiry,
  validExternalShareRecipient, validExternalShareRow,
  validExternalShareTarget, type ExternalShareRow, type ExternalShareStore,
} from "@/lib/domain/workspaceExternalSharePolicy";
import type {
  MembershipRow, ScopeRow, WorkspaceRow,
} from "@/lib/domain/workspaceAccessGateway";

const origin = "tenant01", destination = "tenant02";
const sourceOwner = "clerk_source_owner", recipient = "clerk_external_guest";
const destinationOwner = "clerk_destination_owner";
const scopeId = "page01", shareId = "share01", now = 2000000000000;

function fixture(mode: "guest" | "cross_workspace" = "guest") {
  const workspaces: WorkspaceRow[] = [
    { workspaceId: origin, ownerId: sourceOwner, status: "active" },
    { workspaceId: destination, ownerId: destinationOwner, status: "active" },
  ];
  const memberships: MembershipRow[] = [
    { workspaceId: origin, accountId: sourceOwner, role: "owner", status: "active" },
    { workspaceId: destination, accountId: destinationOwner, role: "owner", status: "active" },
    { workspaceId: destination, accountId: recipient, role: "member", status: "active" },
  ];
  const scopes: ScopeRow[] = [
    { workspaceId: origin, pageId: scopeId, parentId: null, teamspaceId: null },
  ];
  const rows: ExternalShareRow[] = [{
    shareId, originWorkspaceId: origin, scopeId,
    targetWorkspaceId: mode === "guest" ? null : destination,
    targetAccountId: recipient, createdByAccountId: sourceOwner,
    status: "pending", createdAt: now - 1000, expiresAt: now + 10000,
    resolvedAt: null, updatedAt: now - 1000,
  }];
  let fail = false;
  const store: ExternalShareStore = {
    workspaces: async (id) => workspaces.filter((w) => w.workspaceId === id),
    memberships: async (id, account) =>
      memberships.filter((m) => m.workspaceId === id && m.accountId === account),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (id, pageId) =>
      scopes.filter((s) => s.workspaceId === id && s.pageId === pageId),
    grants: async () => [],
    globalScopes: async (id) => scopes.filter((s) => s.pageId === id),
    externalShares: async (id) => {
      if (fail) throw new Error("offline");
      return rows.filter((row) => row.shareId === id);
    },
  };
  const read = (account: string | null = recipient, at = now) =>
    readAuthorizedExternalShare(store, account, shareId, at);
  return { store, rows, scopes, workspaces, memberships, read,
    fail: () => { fail = true; } };
}

describe("Max 2.0 PR37 external sharing proposal authorization", () => {
  it("returns only invitation status to the intended authenticated guest", async () => {
    const f = fixture();
    expect(await f.read()).toEqual({
      shareId, mode: "guest", status: "pending", expiresAt: now + 10000,
      updatedAt: now - 1000, sourceWorkspaceId: null, scopeId: null,
    });
    expect(JSON.stringify(await f.read())).not.toContain(sourceOwner);
    expect(await f.read("clerk_stranger")).toBeNull();
    expect(await f.read(null)).toBeNull();
  });
  it("exposes only a shadow scope reference after acceptance", async () => {
    const f = fixture(), row = f.rows[0];
    row.status = "accepted"; row.resolvedAt = now - 300; row.updatedAt = now - 300;
    expect(await f.read()).toEqual({
      shareId, mode: "guest", status: "accepted", expiresAt: now + 10000,
      updatedAt: now - 300, sourceWorkspaceId: origin, scopeId,
    });
  });
  it("requires current destination membership for cross-workspace proposals", async () => {
    const f = fixture("cross_workspace");
    expect((await f.read())?.mode).toBe("cross_workspace");
    f.memberships.find((m) => m.accountId === recipient)!.status = "suspended";
    expect(await f.read()).toBeNull();
    expect(await validExternalShareRecipient(f.store, recipient, destination)).toBe(false);
  });
  it("requires destination workspace to remain active and owner identity bound", async () => {
    const f = fixture("cross_workspace");
    f.workspaces[1].status = "disabled";
    expect(await f.read()).toBeNull();
    f.workspaces[1].status = "active";
    f.memberships.find((m) => m.accountId === recipient)!.role = "owner";
    expect(await f.read()).toBeNull();
  });
  it("guest proposals do not auto-add source workspace membership", async () => {
    const f = fixture();
    expect(f.memberships.some((m) => m.workspaceId === origin &&
      m.accountId === recipient)).toBe(false);
    expect((await f.read())?.status).toBe("pending");
    expect(await validExternalShareRecipient(f.store, recipient, null)).toBe(true);
  });
  it("expires at the clock boundary and hides even accepted scope IDs", async () => {
    const f = fixture(), row = f.rows[0];
    row.status = "accepted"; row.resolvedAt = now - 5; row.updatedAt = now - 5;
    const result = await f.read(recipient, now + 10000);
    expect(result?.status).toBe("expired");
    expect(result?.sourceWorkspaceId).toBeNull();
    expect(result?.scopeId).toBeNull();
  });
  it("invalidates proposals if the source manager loses permission", async () => {
    const f = fixture();
    f.memberships.find((m) => m.accountId === sourceOwner)!.status = "revoked";
    expect(await f.read()).toBeNull();
  });
  it("invalidates proposals when the original source workspace is disabled", async () => {
    const f = fixture();
    f.workspaces[0].status = "disabled";
    expect(await f.read()).toBeNull();
  });
  it("rejects duplicate global scopes and wrong origin", async () => {
    const f = fixture();
    f.scopes.push({ ...f.scopes[0] });
    expect(await f.read()).toBeNull();
    f.scopes.pop();
    f.scopes[0].workspaceId = destination;
    expect(await f.read()).toBeNull();
  });
  it("requires actual manage capability, not viewer permission", async () => {
    const f = fixture();
    expect(await canManageExternalScope(f.store, recipient, origin, scopeId)).toBe(false);
    expect(await canManageExternalScope(f.store, sourceOwner, origin, scopeId)).toBe(true);
  });
  it("fails closed on wrong tenant, malformed or duplicate proposals", async () => {
    const f = fixture();
    f.rows[0].originWorkspaceId = destination;
    expect(await f.read()).toBeNull();
    f.rows[0].originWorkspaceId = origin;
    f.rows.push({ ...f.rows[0] });
    expect(await f.read()).toBeNull();
    f.rows.pop();
    f.rows[0].expiresAt = f.rows[0].createdAt;
    expect(await f.read()).toBeNull();
  });
  it("rejects bad identity, self-sharing and same-workspace targets", () => {
    expect(validExternalShareTarget(origin, null, recipient, sourceOwner)).toBe(true);
    expect(validExternalShareTarget(origin, destination, recipient, sourceOwner)).toBe(true);
    expect(validExternalShareTarget(origin, origin, recipient, sourceOwner)).toBe(false);
    expect(validExternalShareTarget(origin, null, sourceOwner, sourceOwner)).toBe(false);
    expect(validExternalShareTarget(origin, null, "bad account!", sourceOwner)).toBe(false);
  });
  it("enforces bounded expiry and strict status/revision coherence", () => {
    const f = fixture(), row = f.rows[0];
    expect(validExternalShareRow(row)).toBe(true);
    expect(validExternalShareExpiry(now, now)).toBe(false);
    expect(validExternalShareExpiry(now, now + 30 * 86400000)).toBe(true);
    expect(validExternalShareExpiry(now, now + 31 * 86400000)).toBe(false);
    expect(validExternalShareExpiry(NaN, now + 100)).toBe(false);
    expect(validExternalShareRow({ ...row, status: "accepted" })).toBe(false);
    expect(validExternalShareRow({
      ...row, status: "accepted", resolvedAt: now - 500, updatedAt: now - 600,
    })).toBe(false);
  });
  it("generates monotonic CAS revisions and rejects invalid clocks", () => {
    expect(nextExternalShareRevision(now, now)).toBe(now + 1);
    expect(nextExternalShareRevision(now, now + 500)).toBe(now + 500);
    expect(nextExternalShareRevision(now, Infinity)).toBeNull();
    expect(nextExternalShareRevision(4102444800000, now)).toBeNull();
  });
  it("returns no result for missing shares or storage failures", async () => {
    const f = fixture();
    f.rows.length = 0;
    expect(await f.read()).toBeNull();
    f.fail();
    expect(await f.read()).toBeNull();
  });
});
