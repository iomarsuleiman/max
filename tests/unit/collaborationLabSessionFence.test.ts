import { describe, expect, it } from "vitest";
import {
  inspectCollaborationLabOperation, type TrustedCollaborationLabSession,
  type LabOperationRequest, type LabServerContext,
} from "@/lib/domain/collaborationLabSessionFence";
import type { WorkspaceAuthorizationStore } from "@/lib/domain/workspaceAccessGateway";

function labFixture() {
  let enabled = true;
  const member = { accountId: "alice", status: "active" as "active" | "revoked", role: "owner" as const };
  const store: WorkspaceAuthorizationStore = {
    workspaces: async (id) => id === "workspace1"
      ? [{ workspaceId: id, ownerId: "alice", status: "active" }] : [],
    memberships: async (id, account) => id === "workspace1" && account === member.accountId
      ? [{ workspaceId: id, ...member }] : [],
    groups: async () => [],
    teamspaces: async () => [],
    groupRegistrations: async () => [],
    teamspaceRegistrations: async () => [],
    scopes: async (id, page) => id === "workspace1" && page === "page1"
      ? [{ workspaceId: id, pageId: page, parentId: null, teamspaceId: null }] : [],
    grants: async () => [],
  };
  const session: TrustedCollaborationLabSession = {
    accountId: "alice", workspaceId: "workspace1", pageId: "page1",
    sessionId: "server-only-session", candidate: "blocknote-yjs",
    generation: 3, issuedAt: 1000, expiresAt: 30000,
  };
  const request: LabOperationRequest = {
    workspaceId: session.workspaceId, pageId: session.pageId,
    sessionId: session.sessionId, candidate: session.candidate, operation: "join",
  };
  const server: LabServerContext = { labEnabled: true, now: 2000, currentGeneration: 3 };
  const check = (req = request, current = session, serverCtx = server, account: string | null = "alice") =>
    inspectCollaborationLabOperation(store, account, current, req, serverCtx);
  return { member, session, request, server, check, store, disable: () => { enabled = false; }, get enabled() { return enabled; } };
}

describe("PR15 isolated provider lab session fence (no shared-document access)", () => {
  it("derives policy from authenticated account and live server ACL only", async () => {
    const lab = labFixture();
    expect(await lab.check()).toEqual({
      policyEligible: true, canReadSharedContent: false,
      canSubmitSteps: false, canActivateProvider: false,
    });
    expect((await lab.check({ ...lab.request, operation: "submit-steps" })).canSubmitSteps).toBe(false);
  });

  it("keeps every operation denied when the independent server lab flag is off", async () => {
    const lab = labFixture();
    expect((await lab.check(lab.request, lab.session, { ...lab.server, labEnabled: false })).policyEligible).toBe(false);
  });

  it("rejects a false or missing authenticated identity and another subject", async () => {
    const lab = labFixture();
    expect((await lab.check(lab.request, lab.session, lab.server, null)).policyEligible).toBe(false);
    expect((await lab.check(lab.request, lab.session, lab.server, "bob")).policyEligible).toBe(false);
  });

  it("rejects cross-workspace, cross-page, cross-session and provider swaps", async () => {
    const lab = labFixture();
    for (const request of [
      { ...lab.request, workspaceId: "workspace2" },
      { ...lab.request, pageId: "page2" },
      { ...lab.request, sessionId: "stolen" },
      { ...lab.request, candidate: "convex-prosemirror-sync" as const },
    ]) expect((await lab.check(request)).policyEligible).toBe(false);
  });

  it("denies stale generation after session revocation/fencing", async () => {
    const lab = labFixture();
    expect((await lab.check(lab.request, lab.session, { ...lab.server, currentGeneration: 4 })).policyEligible).toBe(false);
    expect((await lab.check(lab.request, { ...lab.session, generation: 2 })).policyEligible).toBe(false);
  });

  it("rejects expired, future, malformed and overlong session leases", async () => {
    const lab = labFixture();
    expect((await lab.check(lab.request, lab.session, { ...lab.server, now: 30000 })).policyEligible).toBe(false);
    expect((await lab.check(lab.request, lab.session, { ...lab.server, now: 999 })).policyEligible).toBe(false);
    expect((await lab.check(lab.request, { ...lab.session, expiresAt: 301001 })).policyEligible).toBe(false);
    expect((await lab.check(lab.request, { ...lab.session, sessionId: "invalid\nid" })).policyEligible).toBe(false);
  });

  it("rechecks membership on every operation, even after an earlier successful join", async () => {
    const lab = labFixture();
    expect((await lab.check()).policyEligible).toBe(true);
    lab.member.status = "revoked";
    for (const operation of ["join", "subscribe", "read-snapshot", "submit-steps", "reconnect"] as const) {
      const result = await lab.check({ ...lab.request, operation });
      expect(result.policyEligible).toBe(false);
      expect(result.canSubmitSteps).toBe(false);
    }
  });

  it("denies unknown or removed document scopes even when session metadata matches", async () => {
    const lab = labFixture();
    expect((await lab.check({ ...lab.request, pageId: "missing" })).policyEligible).toBe(false);
  });

  it("fails closed when ACL fetch fails", async () => {
    const lab = labFixture();
    const failing: WorkspaceAuthorizationStore = {
      ...lab.store, workspaces: async () => { throw Error("backend unavailable"); },
    };
    expect((await inspectCollaborationLabOperation(
      failing, "alice", lab.session, lab.request, lab.server,
    )).policyEligible).toBe(false);
  });

  it("never turns a positive read probe into a mutation, room or bearer grant", async () => {
    const lab = labFixture();
    const approved = await lab.check({ ...lab.request, operation: "read-snapshot" });
    expect(approved).toMatchObject({
      policyEligible: true, canReadSharedContent: false,
      canSubmitSteps: false, canActivateProvider: false,
    });
  });
});
