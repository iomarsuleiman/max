import { describe, expect, it } from "vitest";
import { WorkspaceService, webCryptoCollaborationRuntime } from "@/lib/domain/collaboration/workspaces";
import type { AccessGrant, GrantPrincipal, PageGrant, PolicyPage } from "@/lib/domain/collaboration/policy";
import { authorizeCollaborationPage } from "@/lib/domain/collaboration/authorization";
import {
  COLLABORATION_AUDIT_TYPES,
  COLLABORATION_LIMITS,
  type CollaborationAuditEvent,
  type CollaborationGroup,
  type CollaborationGroupMembership,
  type CollaborationInvitation,
  type CollaborationMembership,
  type CollaborationRuntime,
  type CollaborationStore,
  type CollaborationTeamspace,
  type CollaborationTransaction,
  type CollaborationWorkspace,
  type InvitationRole,
  type ResolvedCollaborationActor,
} from "@/lib/domain/collaboration/collaborationStore";

interface State {
  workspaces: CollaborationWorkspace[];
  memberships: CollaborationMembership[];
  groups: CollaborationGroup[];
  groupMemberships: CollaborationGroupMembership[];
  teamspaces: CollaborationTeamspace[];
  invitations: CollaborationInvitation[];
  audit: CollaborationAuditEvent[];
  pages: PolicyPage[];
}

const copy = <T>(value: T): T => structuredClone(value);

/** A real serialized transaction implementation, with full snapshot rollback. */
class TestCollaborationStore implements CollaborationStore {
  private state: State = { workspaces: [], memberships: [], groups: [], groupMemberships: [], teamspaces: [], invitations: [], audit: [], pages: [] };
  private tail: Promise<unknown> = Promise.resolve();
  failAudit = false;

  inspect() {
    return copy(this.state);
  }
  seedPages(...pages: PolicyPage[]) {
    this.state.pages = copy(pages);
  }

  transaction<T>(body: (tx: CollaborationTransaction) => Promise<T>): Promise<T> {
    const run = this.tail.then(async () => {
      const before = copy(this.state);
      let open = true;
      const check = () => {
        if (!open) throw new Error("Transaction is closed");
      };
      const one = <T>(rows: readonly T[], predicate: (row: T) => boolean) => {
        check();
        return copy(rows.find(predicate) ?? null);
      };
      const many = <T>(rows: readonly T[], predicate: (row: T) => boolean) => {
        check();
        return copy(rows.filter(predicate));
      };
      const insert = <T extends { id: string }>(rows: T[], row: T) => {
        check();
        if (rows.some((existing) => existing.id === row.id)) throw new Error("Duplicate id");
        rows.push(copy(row));
      };
      const patch = <T extends { id: string }>(rows: T[], id: string, change: Partial<T>) => {
        check();
        const existing = rows.find((row) => row.id === id);
        if (!existing) throw new Error("Missing row");
        Object.assign(existing, copy(change));
      };
      const put = <T>(rows: T[], row: T, matches: (other: T) => boolean) => {
        check();
        const index = rows.findIndex(matches);
        if (index < 0) rows.push(copy(row));
        else rows[index] = copy(row);
      };
      const tx: CollaborationTransaction = {
        getWorkspace: async (id) => one(this.state.workspaces, (row) => row.id === id),
        getPersonalWorkspace: async (ownerId) => one(this.state.workspaces, (row) => row.kind === "personal" && row.ownerId === ownerId),
        insertWorkspace: async (row) => {
          if (row.kind === "personal" && this.state.workspaces.some((existing) => existing.kind === "personal" && existing.ownerId === row.ownerId))
            throw new Error("Duplicate personal owner");
          insert(this.state.workspaces, row);
        },
        patchWorkspace: async (id, change) => patch(this.state.workspaces, id, change),
        getMembership: async (workspaceId, userId) => one(this.state.memberships, (row) => row.workspaceId === workspaceId && row.userId === userId),
        listWorkspaceMemberships: async (workspaceId) => many(this.state.memberships, (row) => row.workspaceId === workspaceId),
        listUserMemberships: async (userId) => many(this.state.memberships, (row) => row.userId === userId),
        putMembership: async (row) => put(this.state.memberships, row, (other) => other.workspaceId === row.workspaceId && other.userId === row.userId),
        getGroup: async (id) => one(this.state.groups, (row) => row.id === id),
        listGroups: async (workspaceId) => many(this.state.groups, (row) => row.workspaceId === workspaceId && row.state === "active"),
        insertGroup: async (row) => insert(this.state.groups, row),
        patchGroup: async (id, change) => patch(this.state.groups, id, change),
        listGroupMemberships: async (workspaceId, groupId) =>
          many(this.state.groupMemberships, (row) => row.workspaceId === workspaceId && row.groupId === groupId),
        getGroupMembership: async (workspaceId, groupId, userId) =>
          one(this.state.groupMemberships, (row) => row.workspaceId === workspaceId && row.groupId === groupId && row.userId === userId),
        getPolicyPage: async (pageId) => one(this.state.pages, (page) => page.id === pageId),
        listPrincipalGrantPageIds: async (workspaceId, principal, effect) => {
          check();
          const matches = (other: GrantPrincipal) =>
            other.kind === principal.kind &&
            (other.kind === "workspace_members" ||
              (other.kind === "group" && principal.kind === "group" && other.groupId === principal.groupId) ||
              (other.kind === "user" && principal.kind === "user" && other.userId === principal.userId));
          return this.state.pages
            .filter(
              (page) =>
                page.workspaceId === workspaceId && page.access.grants.some((grant) => matches(grant.principal) && (!effect || grant.effect === effect)),
            )
            .map((page) => page.id);
        },
        listUserGroupMemberships: async (workspaceId, userId) =>
          many(this.state.groupMemberships, (row) => row.workspaceId === workspaceId && row.userId === userId && row.state === "active"),
        putGroupMembership: async (row) =>
          put(
            this.state.groupMemberships,
            row,
            (other) => other.workspaceId === row.workspaceId && other.groupId === row.groupId && other.userId === row.userId,
          ),
        getTeamspace: async (id) => one(this.state.teamspaces, (row) => row.id === id),
        listTeamspaces: async (workspaceId) => many(this.state.teamspaces, (row) => row.workspaceId === workspaceId && row.state === "active"),
        insertTeamspace: async (row) => insert(this.state.teamspaces, row),
        patchTeamspace: async (id, change) => patch(this.state.teamspaces, id, change),
        getInvitation: async (id) => one(this.state.invitations, (row) => row.id === id),
        getInvitationByHash: async (hash) => one(this.state.invitations, (row) => row.tokenHash === hash),
        listOpenInvitations: async (workspaceId, now) =>
          many(this.state.invitations, (row) => row.workspaceId === workspaceId && row.state === "pending" && row.expiresAt > now),
        insertInvitation: async (row) => {
          if (this.state.invitations.some((other) => other.tokenHash === row.tokenHash)) throw new Error("Duplicate token hash");
          insert(this.state.invitations, row);
        },
        putInvitation: async (row) => {
          const existing = one(this.state.invitations, (other) => other.id === row.id);
          if (
            !existing ||
            existing.tokenHash !== row.tokenHash ||
            existing.workspaceId !== row.workspaceId ||
            existing.invitedBy !== row.invitedBy ||
            existing.recipientEmail !== row.recipientEmail
          )
            throw new Error("Immutable invitation identity changed");
          put(this.state.invitations, row, (other) => other.id === row.id);
        },
        appendAudit: async (row) => {
          if (this.failAudit) throw new Error("Injected audit persistence failure");
          insert(this.state.audit, row);
        },
      };
      try {
        return copy(await body(tx));
      } catch (error) {
        this.state = before;
        throw error;
      } finally {
        open = false;
      }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

const alice: ResolvedCollaborationActor = { userId: "alice", verifiedEmail: "alice@example.com" };
const bob: ResolvedCollaborationActor = { userId: "bob", verifiedEmail: "bob@example.com" };
const carol: ResolvedCollaborationActor = { userId: "carol", verifiedEmail: "carol@example.com" };
const dave: ResolvedCollaborationActor = { userId: "dave", verifiedEmail: "dave@example.com" };

function setup() {
  const store = new TestCollaborationStore();
  const crypto = webCryptoCollaborationRuntime();
  let clock = 100_000;
  let sequence = 0;
  const runtime: CollaborationRuntime = { ...crypto, now: () => clock, newId: () => `collab-${++sequence}` };
  const service = new WorkspaceService(store, runtime);
  return {
    store,
    service,
    runtime,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

async function organization() {
  const fixture = setup();
  const { workspace } = await fixture.service.createOrganization(alice, { name: "Team" });
  return { ...fixture, workspaceId: workspace.id };
}

async function join(fixture: Awaited<ReturnType<typeof organization>>, actor: ResolvedCollaborationActor, role: InvitationRole = "member") {
  const { token } = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: actor.verifiedEmail, role });
  return fixture.service.acceptInvitation(actor, { token });
}

const denied = { code: "NOT_FOUND" };
const userGrant = (userId: string, grant: PageGrant = "full"): AccessGrant => ({
  principal: { kind: "user", userId },
  effect: "allow",
  grant,
  expiresAt: null,
});
const groupGrant = (groupId: string, effect: "allow" | "deny" = "allow"): AccessGrant =>
  effect === "deny" ? { principal: { kind: "group", groupId }, effect } : { principal: { kind: "group", groupId }, effect, grant: "full", expiresAt: null };
const policyPage = (workspaceId: string, id: string, grants: readonly AccessGrant[]): PolicyPage => ({
  id,
  workspaceId,
  parentId: null,
  teamspaceId: null,
  access: { mode: "replace", grants },
});

describe("page authority across workspace governance", () => {
  it("requires the open teamspace manager to admit a guest through a group", async () => {
    const f = await organization();
    await join(f, bob, "admin");
    await join(f, carol, "guest");
    const { group } = await f.service.createGroup(alice, { workspaceId: f.workspaceId, name: "Guests" });
    const { teamspace } = await f.service.createTeamspace(alice, { workspaceId: f.workspaceId, name: "Open", visibility: "open", memberGroupIds: [group.id] });
    f.store.seedPages({ ...policyPage(f.workspaceId, "guest-page", [userGrant("carol")]), teamspaceId: teamspace.id });
    const authorize = () =>
      f.store.transaction((tx) =>
        authorizeCollaborationPage({
          transaction: tx,
          pages: tx,
          actor: carol,
          workspaceId: f.workspaceId,
          now: f.runtime.now(),
          pageId: "guest-page",
          capability: "page.read",
        }),
      );
    await expect(authorize()).rejects.toMatchObject(denied);
    const before = f.store.inspect();
    await expect(f.service.setGroupMember(bob, { workspaceId: f.workspaceId, groupId: group.id, userId: "carol", state: "active" })).rejects.toMatchObject(
      denied,
    );
    expect(f.store.inspect()).toEqual(before);
    await f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "carol", state: "active" });
    expect((await authorize()).grant).toBe("full");
  });
  it("prevents an admin from joining an access-bearing group to bootstrap page sharing", async () => {
    const f = await organization();
    await join(f, bob, "admin");
    const { group } = await f.service.createGroup(alice, { workspaceId: f.workspaceId, name: "Private editors" });
    f.store.seedPages(policyPage(f.workspaceId, "private", [userGrant("alice"), groupGrant(group.id)]));
    const before = f.store.inspect();
    await expect(f.service.setGroupMember(bob, { workspaceId: f.workspaceId, groupId: group.id, userId: "bob", state: "active" })).rejects.toMatchObject(
      denied,
    );
    expect(f.store.inspect()).toEqual(before);
    await f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "bob", state: "active" });
    expect(f.store.inspect().groupMemberships[0]).toMatchObject({ userId: "bob", state: "active" });
  });

  it.each(["active", "revoked"] as const)("requires sharing authority for a %s group membership request", async (state) => {
    const f = await organization();
    await join(f, bob, "admin");
    await join(f, carol);
    const { group } = await f.service.createGroup(alice, { workspaceId: f.workspaceId, name: "Readers" });
    await f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "carol", state: "active" });
    f.store.seedPages(policyPage(f.workspaceId, "private", [userGrant("alice"), userGrant("bob", "view"), groupGrant(group.id)]));
    const before = f.store.inspect();
    await expect(f.service.setGroupMember(bob, { workspaceId: f.workspaceId, groupId: group.id, userId: "carol", state })).rejects.toMatchObject(denied);
    expect(f.store.inspect()).toEqual(before);
  });

  it("checks every allow and deny anchor before any membership or audit write", async () => {
    const f = await organization();
    await join(f, bob);
    const { group } = await f.service.createGroup(alice, { workspaceId: f.workspaceId, name: "Mixed" });
    f.store.seedPages(
      policyPage(f.workspaceId, "allowed", [userGrant("alice"), groupGrant(group.id)]),
      policyPage(f.workspaceId, "denied", [userGrant("alice", "comment"), groupGrant(group.id, "deny")]),
    );
    const before = f.store.inspect();
    await expect(f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "bob", state: "active" })).rejects.toMatchObject(
      denied,
    );
    expect(f.store.inspect()).toEqual(before);
    f.store.seedPages(
      ...before.pages.map((page) =>
        policyPage(f.workspaceId, page.id, [userGrant("alice"), ...page.access.grants.filter((grant) => grant.principal.kind === "group")]),
      ),
    );
    await f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "bob", state: "active" });
  });

  it("guards deny removal through group revocation and archival", async () => {
    const f = await organization();
    await join(f, bob, "admin");
    await join(f, carol);
    const { group } = await f.service.createGroup(alice, { workspaceId: f.workspaceId, name: "Restricted" });
    await f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "carol", state: "active" });
    f.store.seedPages(
      policyPage(f.workspaceId, "restricted", [userGrant("alice"), userGrant("bob", "comment"), userGrant("carol"), groupGrant(group.id, "deny")]),
    );
    const before = f.store.inspect();
    await expect(f.service.setGroupMember(bob, { workspaceId: f.workspaceId, groupId: group.id, userId: "carol", state: "revoked" })).rejects.toMatchObject(
      denied,
    );
    await expect(f.service.updateGroup(bob, { workspaceId: f.workspaceId, groupId: group.id, change: { kind: "archive" } })).rejects.toMatchObject(denied);
    expect(f.store.inspect()).toEqual(before);
    await f.service.updateGroup(alice, { workspaceId: f.workspaceId, groupId: group.id, change: { kind: "archive" } });
    expect(f.store.inspect().groups[0].state).toBe("archived");
  });

  it("keeps emergency revocation immediate but guards direct reactivation from losing group denies", async () => {
    const f = await organization();
    await join(f, bob, "admin");
    await join(f, carol);
    const { group } = await f.service.createGroup(alice, { workspaceId: f.workspaceId, name: "Restricted" });
    await f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "carol", state: "active" });
    f.store.seedPages(policyPage(f.workspaceId, "restricted", [userGrant("alice"), userGrant("carol"), groupGrant(group.id, "deny")]));
    await f.service.changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "revoked" } });
    const revoked = f.store.inspect();
    expect(revoked.groupMemberships[0].state).toBe("revoked");
    await expect(
      f.service.changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "active", role: "member" } }),
    ).rejects.toMatchObject(denied);
    expect(f.store.inspect()).toEqual(revoked);
    await f.service.changeMembership(alice, { workspaceId: f.workspaceId, userId: "carol", next: { state: "active", role: "member" } });
  });

  it("rechecks the issuer's page authority before accepting a revoked member's invitation", async () => {
    const f = await organization();
    await join(f, bob, "admin");
    await join(f, carol);
    const { group } = await f.service.createGroup(alice, { workspaceId: f.workspaceId, name: "Restricted" });
    await f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "carol", state: "active" });
    f.store.seedPages(policyPage(f.workspaceId, "restricted", [userGrant("alice"), userGrant("carol"), groupGrant(group.id, "deny")]));
    await f.service.changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "revoked" } });
    const invitation = await f.service.createInvitation(bob, { workspaceId: f.workspaceId, email: carol.verifiedEmail });
    const before = f.store.inspect();
    await expect(f.service.acceptInvitation(carol, { token: invitation.token })).rejects.toMatchObject(denied);
    expect(f.store.inspect()).toEqual(before);
    await f.service.revokeInvitation(alice, { workspaceId: f.workspaceId, invitationId: invitation.invitation.id });
    const authorized = await f.service.createInvitation(alice, { workspaceId: f.workspaceId, email: carol.verifiedEmail });
    await f.service.acceptInvitation(carol, { token: authorized.token });
  });

  it.each(["direct", "reinvite"] as const)("blocks workspace_members deny laundering through %s guest downgrade", async (path) => {
    const f = await organization();
    await join(f, bob, "admin");
    await join(f, carol);
    f.store.seedPages(policyPage(f.workspaceId, "restricted", [userGrant("carol"), { principal: { kind: "workspace_members" }, effect: "deny" }]));
    if (path === "direct") {
      const before = f.store.inspect();
      await expect(
        f.service.changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "active", role: "guest" } }),
      ).rejects.toMatchObject(denied);
      expect(f.store.inspect()).toEqual(before);
    } else {
      await f.service.changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "revoked" } });
      const invitation = await f.service.createInvitation(bob, { workspaceId: f.workspaceId, email: carol.verifiedEmail, role: "guest" });
      const before = f.store.inspect();
      await expect(f.service.acceptInvitation(carol, { token: invitation.token })).rejects.toMatchObject(denied);
      expect(f.store.inspect()).toEqual(before);
    }
  });

  it("ignores archived group history during reactivation and checks only current deny anchors", async () => {
    const f = await organization();
    await join(f, bob);
    await f.service.changeMembership(alice, { workspaceId: f.workspaceId, userId: "bob", next: { state: "revoked" } });
    await f.store.transaction(async (tx) => {
      for (let index = 0; index <= COLLABORATION_LIMITS.groupsPerWorkspace; index++) {
        const id = `archived-${index}`;
        await tx.insertGroup({ id, workspaceId: f.workspaceId, name: id, state: "archived", createdAt: 1, updatedAt: 1 });
        await tx.putGroupMembership({ workspaceId: f.workspaceId, groupId: id, userId: "bob", state: "revoked", createdAt: 1, updatedAt: 1 });
      }
    });
    await f.service.changeMembership(alice, { workspaceId: f.workspaceId, userId: "bob", next: { state: "active", role: "member" } });
    expect(f.store.inspect().memberships.find((member) => member.userId === "bob")?.state).toBe("active");
  });

  it("refuses oversized reverse grants rather than checking a partial permission set", async () => {
    const f = await organization();
    await join(f, bob);
    const { group } = await f.service.createGroup(alice, { workspaceId: f.workspaceId, name: "Large" });
    f.store.seedPages(
      ...Array.from({ length: COLLABORATION_LIMITS.grantAnchorsPerPrincipal + 1 }, (_, index) =>
        policyPage(f.workspaceId, `page-${index}`, [userGrant("alice"), groupGrant(group.id)]),
      ),
    );
    const before = f.store.inspect();
    await expect(f.service.setGroupMember(alice, { workspaceId: f.workspaceId, groupId: group.id, userId: "bob", state: "active" })).rejects.toMatchObject({
      code: "LIMIT",
    });
    expect(f.store.inspect()).toEqual(before);
  });
});

describe("workspace lifecycle transactions", () => {
  it("creates one personal workspace per immutable account, including concurrent retries", async () => {
    const { service, store } = setup();
    const results = await Promise.all(Array.from({ length: 8 }, () => service.ensurePersonalWorkspace(alice, { name: "My notes" })));
    expect(new Set(results.map((result) => result.workspace.id)).size).toBe(1);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const state = store.inspect();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0]).toMatchObject({ kind: "personal", ownerId: "alice" });
    expect(state.memberships).toEqual([expect.objectContaining({ userId: "alice", role: "owner", state: "active" })]);
    expect(state.audit).toHaveLength(1);
    const second = await service.ensurePersonalWorkspace(bob);
    expect(second.workspace.id).not.toBe(results[0].workspace.id);
    expect((await service.listWorkspaces(alice)).workspaces).toHaveLength(1);
  });

  it("creates organizations and their owner membership atomically and preserves personal mode", async () => {
    const fixture = setup();
    const personal = await fixture.service.ensurePersonalWorkspace(alice);
    const first = await fixture.service.createOrganization(alice, { name: " First " });
    const second = await fixture.service.createOrganization(alice, { name: "Second" });
    expect(first.workspace.name).toBe("First");
    expect(first.workspace.id).not.toBe(second.workspace.id);
    expect((await fixture.service.listWorkspaces(alice)).workspaces.map((item) => item.workspace.id)).toEqual([
      personal.workspace.id,
      first.workspace.id,
      second.workspace.id,
    ]);
    expect(fixture.store.inspect().memberships.filter((row) => row.role === "owner")).toHaveLength(3);
  });

  it("rolls back workspace and membership bootstrap if the audit write fails", async () => {
    const fixture = setup();
    fixture.store.failAudit = true;
    await expect(fixture.service.createOrganization(alice, { name: "Failed" })).rejects.toThrow("audit persistence");
    await expect(fixture.service.ensurePersonalWorkspace(alice)).rejects.toThrow("audit persistence");
    expect(fixture.store.inspect()).toEqual({
      workspaces: [],
      memberships: [],
      groups: [],
      groupMemberships: [],
      teamspaces: [],
      invitations: [],
      audit: [],
      pages: [],
    });
    fixture.store.failAudit = false;
    expect((await fixture.service.ensurePersonalWorkspace(alice)).created).toBe(true);
  });

  it("rejects forged personal membership even when the forged role is owner", async () => {
    const fixture = setup();
    const { workspace } = await fixture.service.ensurePersonalWorkspace(alice);
    await fixture.store.transaction((tx) =>
      tx.putMembership({ workspaceId: workspace.id, userId: "bob", role: "owner", state: "active", joinedAt: 1, updatedAt: 1 }),
    );
    await expect(fixture.service.renameWorkspace(bob, { workspaceId: workspace.id, name: "Stolen" })).rejects.toMatchObject(denied);
    expect((await fixture.service.listWorkspaces(bob)).workspaces).toEqual([]);
  });

  it("keeps personal collaboration governance unavailable", async () => {
    const fixture = setup();
    const { workspace } = await fixture.service.ensurePersonalWorkspace(alice);
    const workspaceId = workspace.id;
    await expect(fixture.service.createInvitation(alice, { workspaceId, email: bob.verifiedEmail })).rejects.toMatchObject(denied);
    await expect(fixture.service.createGroup(alice, { workspaceId, name: "Team" })).rejects.toMatchObject(denied);
    await expect(fixture.service.createTeamspace(alice, { workspaceId, name: "Team" })).rejects.toMatchObject(denied);
    await expect(fixture.service.archiveOrganization(alice, { workspaceId })).rejects.toMatchObject(denied);
    expect((await fixture.service.renameWorkspace(alice, { workspaceId, name: "Personal renamed" })).workspace.name).toBe("Personal renamed");
  });

  it("uses fresh membership after revocation and hides foreign or missing workspace IDs", async () => {
    const fixture = await organization();
    await join(fixture, bob, "admin");
    await fixture.service.renameWorkspace(bob, { workspaceId: fixture.workspaceId, name: "Admin rename" });
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "revoked" } });
    const request = { workspaceId: fixture.workspaceId, name: "Should fail" };
    await expect(fixture.service.renameWorkspace(bob, request)).rejects.toMatchObject(denied);
    await expect(fixture.service.renameWorkspace(carol, request)).rejects.toMatchObject(denied);
    await expect(fixture.service.renameWorkspace(carol, { ...request, workspaceId: "missing" })).rejects.toMatchObject(denied);
    expect((await fixture.service.listWorkspaces(bob)).workspaces).toEqual([]);
  });

  it("archives only through an organization owner and blocks pending invitations afterward", async () => {
    const fixture = await organization();
    await join(fixture, bob, "admin");
    const invitation = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: carol.verifiedEmail });
    await expect(fixture.service.archiveOrganization(bob, { workspaceId: fixture.workspaceId })).rejects.toMatchObject(denied);
    await fixture.service.archiveOrganization(alice, { workspaceId: fixture.workspaceId });
    expect((await fixture.service.listWorkspaces(alice)).workspaces).toEqual([]);
    await expect(fixture.service.acceptInvitation(carol, { token: invitation.token })).rejects.toMatchObject(denied);
  });
});

describe("membership and owner protection", () => {
  it("serializes concurrent owner demotions so one active owner always remains", async () => {
    const fixture = await organization();
    await join(fixture, bob);
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "active", role: "owner" } });
    const results = await Promise.allSettled([
      fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "alice", next: { state: "active", role: "member" } }),
      fixture.service.changeMembership(bob, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "active", role: "member" } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(fixture.store.inspect().memberships.filter((member) => member.state === "active" && member.role === "owner")).toHaveLength(1);
  });

  it("protects the last owner and supports an explicit owner handover", async () => {
    const fixture = await organization();
    await join(fixture, bob);
    for (const next of [{ state: "revoked" }, { state: "active", role: "member" }]) {
      await expect(fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "alice", next })).rejects.toMatchObject(denied);
    }
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "active", role: "owner" } });
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "alice", next: { state: "revoked" } });
    expect((await fixture.service.listMembers(bob, { workspaceId: fixture.workspaceId })).members.find((row) => row.userId === "bob")?.role).toBe("owner");
    await expect(
      fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "alice", next: { state: "active", role: "owner" } }),
    ).rejects.toMatchObject(denied);
  });

  it("prevents admins from granting ownership, modifying owners or restoring revoked owners", async () => {
    const fixture = await organization();
    await join(fixture, bob, "admin");
    await join(fixture, carol);
    await expect(
      fixture.service.changeMembership(bob, { workspaceId: fixture.workspaceId, userId: "carol", next: { state: "active", role: "owner" } }),
    ).rejects.toMatchObject(denied);
    await expect(
      fixture.service.changeMembership(bob, { workspaceId: fixture.workspaceId, userId: "alice", next: { state: "revoked" } }),
    ).rejects.toMatchObject(denied);
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "carol", next: { state: "active", role: "owner" } });
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "carol", next: { state: "revoked" } });
    await expect(
      fixture.service.changeMembership(bob, { workspaceId: fixture.workspaceId, userId: "carol", next: { state: "active", role: "member" } }),
    ).rejects.toMatchObject(denied);
  });

  it.each<InvitationRole>(["member", "guest"])("prevents %s users from managing members, groups or invitations", async (role) => {
    const fixture = await organization();
    await join(fixture, bob, role);
    await expect(fixture.service.listMembers(bob, { workspaceId: fixture.workspaceId })).rejects.toMatchObject(denied);
    await expect(fixture.service.createInvitation(bob, { workspaceId: fixture.workspaceId, email: carol.verifiedEmail })).rejects.toMatchObject(denied);
    await expect(fixture.service.createGroup(bob, { workspaceId: fixture.workspaceId, name: "Unauthorized" })).rejects.toMatchObject(denied);
    await expect(
      fixture.service.changeMembership(bob, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "active", role: "admin" } }),
    ).rejects.toMatchObject(denied);
  });

  it("rolls back role updates and all admission removal when audit persistence fails", async () => {
    const fixture = await organization();
    await join(fixture, bob);
    const { group } = await fixture.service.createGroup(alice, { workspaceId: fixture.workspaceId, name: "Editors" });
    await fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "bob", state: "active" });
    await fixture.service.createTeamspace(alice, { workspaceId: fixture.workspaceId, name: "Private", visibility: "private", memberUserIds: ["bob"] });
    const before = fixture.store.inspect();
    fixture.store.failAudit = true;
    await expect(fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "revoked" } })).rejects.toThrow(
      "audit persistence",
    );
    expect(fixture.store.inspect()).toEqual(before);
  });
});

describe("invitation security", () => {
  it("deduplicates concurrent recipient invitations without storing either raw token", async () => {
    const fixture = await organization();
    const results = await Promise.allSettled([
      fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: "  BOB@EXAMPLE.COM " }),
      fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: "bob@example.com" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(fixture.store.inspect().invitations).toHaveLength(1);
    expect(fixture.store.inspect().invitations[0].recipientEmail).toBe("bob@example.com");
  });

  it("rolls back hash collisions and creation-audit failures without replacing the first invitation", async () => {
    const fixture = await organization();
    const token = `max-invite-v1.${"a".repeat(64)}`;
    const repeated = new WorkspaceService(fixture.store, { ...fixture.runtime, createInvitationToken: () => token });
    await repeated.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail });
    const before = fixture.store.inspect();
    await expect(repeated.createInvitation(alice, { workspaceId: fixture.workspaceId, email: carol.verifiedEmail })).rejects.toThrow("Duplicate token hash");
    expect(fixture.store.inspect()).toEqual(before);
    fixture.store.failAudit = true;
    await expect(fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: carol.verifiedEmail })).rejects.toThrow(
      "audit persistence",
    );
    expect(fixture.store.inspect()).toEqual(before);
  });

  it("prevents an administrator invitation from reactivating a revoked owner", async () => {
    const fixture = await organization();
    await join(fixture, bob, "admin");
    await join(fixture, carol);
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "carol", next: { state: "active", role: "owner" } });
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "carol", next: { state: "revoked" } });
    const { token } = await fixture.service.createInvitation(bob, { workspaceId: fixture.workspaceId, email: carol.verifiedEmail, role: "admin" });
    await expect(fixture.service.acceptInvitation(carol, { token })).rejects.toMatchObject(denied);
    expect(fixture.store.inspect().memberships.find((member) => member.userId === "carol")).toMatchObject({ state: "revoked", role: "owner" });
  });

  it("stores only a hash, case-folds recipients, and binds acceptance to a verified identity", async () => {
    const fixture = await organization();
    const result = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: "BOB@EXAMPLE.COM", role: "member" });
    expect(result.token).toMatch(/^max-invite-v1\.[a-f0-9]{64}$/);
    expect(result.invitation).not.toHaveProperty("tokenHash");
    const persisted = JSON.stringify(fixture.store.inspect());
    expect(persisted).not.toContain(result.token);
    expect(fixture.store.inspect().invitations[0].tokenHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(fixture.service.acceptInvitation(carol, { token: result.token })).rejects.toMatchObject(denied);
    await expect(fixture.service.acceptInvitation({ ...bob, verifiedEmail: null }, { token: result.token })).rejects.toMatchObject(denied);
    const accepted = await fixture.service.acceptInvitation({ ...bob, verifiedEmail: "BOB@EXAMPLE.COM" }, { token: result.token });
    expect(accepted).toMatchObject({ joined: true, membership: { userId: "bob", role: "member", state: "active" } });
    const list = await fixture.service.listInvitations(alice, { workspaceId: fixture.workspaceId });
    expect(list.invitations).toEqual([]);
  });

  it("rejects single-use token replay and consumes it only once under concurrent acceptance", async () => {
    const fixture = await organization();
    const { token } = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail });
    const results = await Promise.allSettled([fixture.service.acceptInvitation(bob, { token }), fixture.service.acceptInvitation(bob, { token })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(fixture.store.inspect().memberships.filter((row) => row.userId === "bob")).toHaveLength(1);
    expect(fixture.store.inspect().audit.filter((event) => event.type === "invitation.accepted")).toHaveLength(1);
    await expect(fixture.service.acceptInvitation(bob, { token })).rejects.toMatchObject(denied);
  });

  it("expires at the exact boundary, permits replacement afterward and rejects cancelled tokens", async () => {
    const fixture = await organization();
    const first = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail, expiresInMs: 60_000 });
    await expect(fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: "BOB@EXAMPLE.COM" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    fixture.advance(60_000);
    await expect(fixture.service.acceptInvitation(bob, { token: first.token })).rejects.toMatchObject(denied);
    const replacement = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail });
    expect(replacement.token).not.toBe(first.token);
    await fixture.service.revokeInvitation(alice, { workspaceId: fixture.workspaceId, invitationId: replacement.invitation.id });
    expect(await fixture.service.revokeInvitation(alice, { workspaceId: fixture.workspaceId, invitationId: replacement.invitation.id })).toEqual({
      revoked: false,
    });
    await expect(fixture.service.acceptInvitation(bob, { token: replacement.token })).rejects.toMatchObject(denied);
  });

  it("rechecks the issuer's current authority instead of trusting the issuance role", async () => {
    const fixture = await organization();
    await join(fixture, bob, "admin");
    const { token } = await fixture.service.createInvitation(bob, { workspaceId: fixture.workspaceId, email: carol.verifiedEmail, role: "admin" });
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "active", role: "member" } });
    await expect(fixture.service.acceptInvitation(carol, { token })).rejects.toMatchObject(denied);
    expect(fixture.store.inspect().invitations.find((row) => row.recipientEmail === carol.verifiedEmail)?.state).toBe("revoked");
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "active", role: "admin" } });
    await expect(fixture.service.acceptInvitation(carol, { token })).rejects.toMatchObject(denied);
  });

  it("never changes the role of an already-active recipient from an invitation", async () => {
    const fixture = await organization();
    await join(fixture, bob, "member");
    const { token } = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail, role: "admin" });
    const accepted = await fixture.service.acceptInvitation(bob, { token });
    expect(accepted).toMatchObject({ joined: false, membership: { role: "member" } });
  });

  it("never accepts an owner role or caller-supplied recipient/role overrides", async () => {
    const fixture = await organization();
    await expect(fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail, role: "owner" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const { token } = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail });
    await expect(fixture.service.acceptInvitation(bob, { token, role: "owner", userId: "alice" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(fixture.service.acceptInvitation(bob, { token: "invented" })).rejects.toMatchObject(denied);
  });

  it("rolls back invitation consumption and membership insertion on audit failure", async () => {
    const fixture = await organization();
    const { token } = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail });
    const before = fixture.store.inspect();
    fixture.store.failAudit = true;
    await expect(fixture.service.acceptInvitation(bob, { token })).rejects.toThrow("audit persistence");
    expect(fixture.store.inspect()).toEqual(before);
    fixture.store.failAudit = false;
    expect((await fixture.service.acceptInvitation(bob, { token })).joined).toBe(true);
  });

  it("protects invitation administration from foreign selectors and nonmanagers", async () => {
    const fixture = await organization();
    await join(fixture, bob);
    const foreign = await fixture.service.createOrganization(carol, { name: "Foreign" });
    const invitation = await fixture.service.createInvitation(carol, { workspaceId: foreign.workspace.id, email: dave.verifiedEmail });
    await expect(fixture.service.revokeInvitation(alice, { workspaceId: fixture.workspaceId, invitationId: invitation.invitation.id })).rejects.toMatchObject(
      denied,
    );
    await expect(fixture.service.listInvitations(bob, { workspaceId: fixture.workspaceId })).rejects.toMatchObject(denied);
    await expect(fixture.service.revokeInvitation(bob, { workspaceId: foreign.workspace.id, invitationId: invitation.invitation.id })).rejects.toMatchObject(
      denied,
    );
  });
});

describe("groups and teamspace boundaries", () => {
  it("keeps group membership in the current workspace and active workspace members only", async () => {
    const fixture = await organization();
    await join(fixture, bob);
    const { group } = await fixture.service.createGroup(alice, { workspaceId: fixture.workspaceId, name: "Editors" });
    const foreign = await fixture.service.createOrganization(carol, { name: "Foreign" });
    const { group: foreignGroup } = await fixture.service.createGroup(carol, { workspaceId: foreign.workspace.id, name: "Foreign group" });
    await expect(
      fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: foreignGroup.id, userId: "bob", state: "active" }),
    ).rejects.toMatchObject(denied);
    await expect(
      fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "carol", state: "active" }),
    ).rejects.toMatchObject(denied);
    expect(await fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "bob", state: "active" })).toEqual({
      changed: true,
    });
    const before = fixture.store.inspect().audit.length;
    expect(await fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "bob", state: "active" })).toEqual({
      changed: false,
    });
    expect(fixture.store.inspect().audit).toHaveLength(before);
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "revoked" } });
    await expect(
      fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "bob", state: "active" }),
    ).rejects.toMatchObject(denied);
    expect(fixture.store.inspect().groupMemberships[0].state).toBe("revoked");
  });

  it("requires explicit closed/private admission and never reveals private teamspace summaries", async () => {
    const fixture = await organization();
    await join(fixture, bob, "admin");
    const { teamspace: open } = await fixture.service.createTeamspace(alice, { workspaceId: fixture.workspaceId, name: "Open", visibility: "open" });
    const { teamspace: closed } = await fixture.service.createTeamspace(alice, { workspaceId: fixture.workspaceId, name: "Closed", visibility: "closed" });
    const { teamspace: secret } = await fixture.service.createTeamspace(alice, { workspaceId: fixture.workspaceId, name: "Secret", visibility: "private" });
    const listed = await fixture.service.listTeamspaces(bob, { workspaceId: fixture.workspaceId });
    expect(listed.teamspaces).toEqual([
      { id: open.id, name: "Open", visibility: "open", admitted: true, canManage: false },
      { id: closed.id, name: "Closed", visibility: "closed", admitted: false, canManage: false },
    ]);
    await expect(fixture.service.getTeamspace(bob, { workspaceId: fixture.workspaceId, teamspaceId: closed.id })).rejects.toMatchObject(denied);
    await expect(fixture.service.getTeamspace(bob, { workspaceId: fixture.workspaceId, teamspaceId: secret.id })).rejects.toMatchObject(denied);
    expect((await fixture.service.getTeamspace(bob, { workspaceId: fixture.workspaceId, teamspaceId: open.id })).teamspace.id).toBe(open.id);
  });

  it.each(["closed", "private"] satisfies CollaborationTeamspace["visibility"][])(
    "prevents owner/admin group governance from indirectly joining an unadmitted %s teamspace",
    async (visibility) => {
      const fixture = await organization();
      await join(fixture, bob, "admin");
      await join(fixture, carol, "admin");
      await join(fixture, dave);
      const { group } = await fixture.service.createGroup(alice, { workspaceId: fixture.workspaceId, name: "Restricted" });
      const { teamspace } = await fixture.service.createTeamspace(bob, {
        workspaceId: fixture.workspaceId,
        name: "Restricted teamspace",
        visibility,
        memberGroupIds: [group.id],
      });
      for (const actor of [alice, carol])
        for (const userId of [actor.userId, "dave"]) {
          await expect(
            fixture.service.setGroupMember(actor, { workspaceId: fixture.workspaceId, groupId: group.id, userId, state: "active" }),
          ).rejects.toMatchObject(denied);
        }
      expect(fixture.store.inspect().groupMemberships).toEqual([]);
      await fixture.service.setGroupMember(bob, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "carol", state: "active" });
      expect((await fixture.service.getTeamspace(carol, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).teamspace.id).toBe(teamspace.id);
      await expect(
        fixture.service.setGroupMember(carol, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "dave", state: "active" }),
      ).rejects.toMatchObject(denied);
      await fixture.service.setGroupMember(bob, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "dave", state: "active" });
      expect((await fixture.service.getTeamspace(dave, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).teamspace.id).toBe(teamspace.id);
      // Removing admission never grants content; workspace governance can still revoke it.
      await fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "carol", state: "revoked" });
      await expect(fixture.service.getTeamspace(carol, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).rejects.toMatchObject(denied);
    },
  );

  it("requires admission to every restricted teamspace sharing an access-bearing group", async () => {
    const fixture = await organization();
    await join(fixture, bob, "admin");
    await join(fixture, carol);
    const { group } = await fixture.service.createGroup(alice, { workspaceId: fixture.workspaceId, name: "Shared group" });
    await fixture.service.createTeamspace(alice, {
      workspaceId: fixture.workspaceId,
      name: "First",
      visibility: "private",
      memberGroupIds: [group.id],
      memberUserIds: ["bob"],
    });
    await fixture.service.createTeamspace(alice, { workspaceId: fixture.workspaceId, name: "Second", visibility: "private", memberGroupIds: [group.id] });
    await expect(
      fixture.service.setGroupMember(bob, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "carol", state: "active" }),
    ).rejects.toMatchObject(denied);
  });

  it("keeps guests out of open teamspaces unless explicitly admitted", async () => {
    const fixture = await organization();
    await join(fixture, bob, "guest");
    const { teamspace } = await fixture.service.createTeamspace(alice, { workspaceId: fixture.workspaceId, name: "Open", visibility: "open" });
    expect((await fixture.service.listTeamspaces(bob, { workspaceId: fixture.workspaceId })).teamspaces).toEqual([]);
    await expect(fixture.service.getTeamspace(bob, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).rejects.toMatchObject(denied);
    await fixture.service.updateTeamspace(alice, {
      workspaceId: fixture.workspaceId,
      teamspaceId: teamspace.id,
      name: teamspace.name,
      visibility: teamspace.visibility,
      defaultGrant: teamspace.defaultGrant,
      memberUserIds: ["alice", "bob"],
      managerUserIds: ["alice"],
      memberGroupIds: [],
    });
    expect((await fixture.service.getTeamspace(bob, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).teamspace.id).toBe(teamspace.id);
    await expect(fixture.service.archiveTeamspace(bob, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).rejects.toMatchObject(denied);
  });

  it("validates teamspace managers and all user/group references without changing anything on rejection", async () => {
    const fixture = await organization();
    await join(fixture, bob, "guest");
    const { teamspace } = await fixture.service.createTeamspace(alice, { workspaceId: fixture.workspaceId, name: "Private", visibility: "private" });
    const base = {
      workspaceId: fixture.workspaceId,
      teamspaceId: teamspace.id,
      name: teamspace.name,
      visibility: teamspace.visibility,
      defaultGrant: teamspace.defaultGrant,
      memberUserIds: ["alice", "bob"],
      managerUserIds: ["alice"],
      memberGroupIds: [],
    };
    const before = fixture.store.inspect();
    await expect(fixture.service.updateTeamspace(alice, { ...base, managerUserIds: [] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(fixture.service.updateTeamspace(alice, { ...base, managerUserIds: ["bob"] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(fixture.service.updateTeamspace(alice, { ...base, memberUserIds: ["alice", "outsider"] })).rejects.toMatchObject(denied);
    await expect(fixture.service.updateTeamspace(alice, { ...base, memberGroupIds: ["foreign-group"] })).rejects.toMatchObject(denied);
    expect(fixture.store.inspect()).toEqual(before);
  });

  it("removes stale admission on revocation and does not resurrect it when the account rejoins", async () => {
    const fixture = await organization();
    await join(fixture, bob);
    const { group } = await fixture.service.createGroup(alice, { workspaceId: fixture.workspaceId, name: "Editors" });
    await fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "bob", state: "active" });
    const { teamspace } = await fixture.service.createTeamspace(alice, {
      workspaceId: fixture.workspaceId,
      name: "Private",
      visibility: "private",
      memberUserIds: ["bob"],
      memberGroupIds: [group.id],
    });
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "revoked" } });
    await join(fixture, bob, "guest");
    await expect(fixture.service.getTeamspace(bob, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).rejects.toMatchObject(denied);
    expect(fixture.store.inspect().groupMemberships.find((row) => row.userId === "bob")?.state).toBe("revoked");
  });

  it("allows an explicit audited owner recovery only when no active teamspace manager remains", async () => {
    const fixture = await organization();
    await join(fixture, bob, "admin");
    await join(fixture, carol, "admin");
    const { teamspace } = await fixture.service.createTeamspace(bob, { workspaceId: fixture.workspaceId, name: "Private", visibility: "private" });
    await expect(fixture.service.recoverTeamspace(alice, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await fixture.service.changeMembership(alice, { workspaceId: fixture.workspaceId, userId: "bob", next: { state: "revoked" } });
    await expect(fixture.service.recoverTeamspace(carol, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).rejects.toMatchObject(denied);
    await fixture.service.recoverTeamspace(alice, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id });
    expect((await fixture.service.getTeamspace(alice, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).teamspace.managerUserIds).toEqual([
      "alice",
    ]);
    expect(fixture.store.inspect().audit.at(-1)?.type).toBe("teamspace.recovered");
  });

  it("archives groups and teamspaces without leaving active group admission", async () => {
    const fixture = await organization();
    await join(fixture, bob);
    const { group } = await fixture.service.createGroup(alice, { workspaceId: fixture.workspaceId, name: "Editors" });
    await fixture.service.setGroupMember(alice, { workspaceId: fixture.workspaceId, groupId: group.id, userId: "bob", state: "active" });
    const { teamspace } = await fixture.service.createTeamspace(alice, {
      workspaceId: fixture.workspaceId,
      name: "Private",
      visibility: "private",
      memberGroupIds: [group.id],
    });
    await fixture.service.updateGroup(alice, { workspaceId: fixture.workspaceId, groupId: group.id, change: { kind: "rename", name: "Writers" } });
    await fixture.service.updateGroup(alice, { workspaceId: fixture.workspaceId, groupId: group.id, change: { kind: "archive" } });
    expect((await fixture.service.listGroups(alice, { workspaceId: fixture.workspaceId })).groups).toEqual([]);
    await expect(fixture.service.getTeamspace(bob, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id })).rejects.toMatchObject(denied);
    await fixture.service.archiveTeamspace(alice, { workspaceId: fixture.workspaceId, teamspaceId: teamspace.id });
    expect((await fixture.service.listTeamspaces(alice, { workspaceId: fixture.workspaceId })).teamspaces).toEqual([]);
  });
});

describe("validation and storage bounds", () => {
  it("rejects unknown actor claims and request fields at the boundary", async () => {
    const fixture = setup();
    await expect(fixture.service.createOrganization(alice, { name: "", ownerId: "bob" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(fixture.service.createOrganization(alice, { name: "Name", workspaceId: "chosen-id" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(fixture.service.createOrganization({ ...alice, userId: "" }, { name: "Name" })).rejects.toMatchObject({ code: "VALIDATION" });
    const forgedActor = { ...alice, role: "owner" };
    await expect(fixture.service.createOrganization(forgedActor, { name: "Name" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(fixture.store.inspect().workspaces).toEqual([]);
  });

  it("refuses new memberships at the supported workspace bound without consuming the invitation", async () => {
    const fixture = await organization();
    const invitation = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail });
    await fixture.store.transaction(async (tx) => {
      for (let index = 1; index < COLLABORATION_LIMITS.membersPerWorkspace; index++) {
        await tx.putMembership({ workspaceId: fixture.workspaceId, userId: `fixture-${index}`, role: "member", state: "active", joinedAt: 1, updatedAt: 1 });
      }
    });
    await expect(fixture.service.acceptInvitation(bob, { token: invitation.token })).rejects.toMatchObject({ code: "LIMIT" });
    expect(fixture.store.inspect().invitations[0].state).toBe("pending");
  });

  it("uses the shared audit vocabulary and never writes token material or recipient emails into audit", async () => {
    const fixture = await organization();
    const { token } = await fixture.service.createInvitation(alice, { workspaceId: fixture.workspaceId, email: bob.verifiedEmail });
    await fixture.service.acceptInvitation(bob, { token });
    for (const event of fixture.store.inspect().audit) expect(COLLABORATION_AUDIT_TYPES).toContain(event.type);
    const audit = JSON.stringify(fixture.store.inspect().audit);
    expect(audit).not.toContain(token);
    expect(audit).not.toContain("tokenHash");
    expect(audit).not.toContain("bob@example.com");
  });
});
