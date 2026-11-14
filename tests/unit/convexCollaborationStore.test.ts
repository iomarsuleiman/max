import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { convexCollaborationStore } from "@/convex/collaborationStore";
import { WorkspaceService } from "@/lib/domain/collaboration/workspaces";
import { COLLABORATION_LIMITS, type CollaborationRuntime, type CollaborationWorkspace } from "@/lib/domain/collaboration/collaborationStore";

function setup() {
  const t = convexTest(schema, { "../../convex/_generated/server.ts": async () => ({}) });
  let counter = 0;
  const runtime: CollaborationRuntime = {
    now: () => Date.UTC(2026, 10, 13),
    newId: () => `fixture-${++counter}`,
    createInvitationToken: () => `max-invite-v1.${(++counter).toString(16).padStart(64, "0")}`,
    hashInvitationToken: async (token) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
  const run = <T>(body: (service: WorkspaceService) => Promise<T>) => t.run((ctx) => body(new WorkspaceService(convexCollaborationStore(ctx.db), runtime)));
  return { t, run };
}
const alice = { userId: "alice", verifiedEmail: "alice@example.com" };
const bob = { userId: "bob", verifiedEmail: "bob@example.com" };

describe("native Convex collaboration storage adapter", () => {
  it("bootstraps one personal workspace and atomically creates organization membership/audit", async () => {
    const { t, run } = setup();
    const first = await run((service) => service.ensurePersonalWorkspace(alice));
    const retry = await run((service) => service.ensurePersonalWorkspace(alice));
    expect(retry.workspace).toEqual(first.workspace);
    expect(retry.created).toBe(false);
    const { workspace } = await run((service) => service.createOrganization(alice, { name: "Organization العربية" }));
    await t.run(async (ctx) => {
      const store = convexCollaborationStore(ctx.db);
      await store.transaction(async (tx) => {
        expect(await tx.listUserMemberships("alice")).toHaveLength(2);
        expect(await tx.getMembership(workspace.id, "alice")).toMatchObject({ role: "owner", state: "active" });
        expect(await tx.getPersonalWorkspace("bob")).toBeNull();
      });
      const audit = await ctx.db
        .query("collabAudit")
        .withIndex("by_workspaceId_at", (q) => q.eq("workspaceId", workspace.id))
        .take(10);
      expect(audit.map((event) => event.type)).toEqual(["workspace.created"]);
    });
    await expect(run((service) => service.listMembers(bob, { workspaceId: workspace.id }))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("persists hash-only recipient-bound invites, consumes once, and protects the last owner", async () => {
    const { t, run } = setup();
    const { workspace } = await run((service) => service.createOrganization(alice, { name: "Team" }));
    const invitation = await run((service) => service.createInvitation(alice, { workspaceId: workspace.id, email: bob.verifiedEmail, role: "member" }));
    await expect(run((service) => service.acceptInvitation({ ...bob, verifiedEmail: "other@example.com" }, { token: invitation.token }))).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    const accepted = await run((service) => service.acceptInvitation(bob, { token: invitation.token }));
    expect(accepted.membership).toMatchObject({ role: "member", state: "active" });
    await expect(run((service) => service.acceptInvitation(bob, { token: invitation.token }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      run((service) => service.changeMembership(alice, { workspaceId: workspace.id, userId: "alice", next: { state: "revoked" } })),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("collabInvitations")
        .withIndex("by_workspaceId_state_expiresAt", (q) => q.eq("workspaceId", workspace.id))
        .take(10);
      expect(rows[0]).toMatchObject({ state: "accepted", acceptedBy: "bob" });
      expect(JSON.stringify(rows)).not.toContain(invitation.token);
      expect(await convexCollaborationStore(ctx.db).transaction((tx) => tx.listOpenInvitations(workspace.id, Date.UTC(2026, 10, 13)))).toEqual([]);
    });
  });

  it("rolls back metadata, memberships and audit together when the outer mutation fails", async () => {
    const { t, run } = setup();
    await expect(
      run(async (service) => {
        await service.createOrganization(alice, { name: "Must roll back" });
        throw new Error("Injected outer failure");
      }),
    ).rejects.toThrow("Injected outer failure");
    await t.run(async (ctx) => {
      expect(await ctx.db.query("collabWorkspaces").take(10)).toEqual([]);
      expect(await ctx.db.query("collabMemberships").take(10)).toEqual([]);
      expect(await ctx.db.query("collabAudit").take(10)).toEqual([]);
    });
  });

  it("rejects duplicate logical/personal-owner keys and fails closed on preexisting duplicate metadata", async () => {
    const { t } = setup();
    const value: CollaborationWorkspace = { id: "personal", kind: "personal", ownerId: "alice", name: "Personal", state: "active", createdAt: 0, updatedAt: 0 };
    await t.run((ctx) => convexCollaborationStore(ctx.db).transaction((tx) => tx.insertWorkspace(value)));
    await expect(t.run((ctx) => convexCollaborationStore(ctx.db).transaction((tx) => tx.insertWorkspace({ ...value, id: "second" })))).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await t.run(async (ctx) => {
      const { id, ...rest } = value;
      await ctx.db.insert("collabWorkspaces", { ...rest, logicalId: id });
    });
    await expect(t.run((ctx) => convexCollaborationStore(ctx.db).transaction((tx) => tx.getWorkspace("personal")))).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("never silently truncates membership lists used for last-owner or account limits", async () => {
    const { t } = setup();
    await t.run(async (ctx) => {
      for (let index = 0; index <= COLLABORATION_LIMITS.membersPerWorkspace; index++)
        await ctx.db.insert("collabMemberships", {
          workspaceId: "large",
          userId: `member-${index}`,
          role: "member",
          state: "active",
          joinedAt: 0,
          updatedAt: 0,
        });
    });
    await expect(t.run((ctx) => convexCollaborationStore(ctx.db).transaction((tx) => tx.listWorkspaceMemberships("large")))).rejects.toMatchObject({
      code: "LIMIT",
    });
  });

  it("fails closed on contradictory duplicate memberships rather than choosing a role", async () => {
    const { t } = setup();
    await t.run(async (ctx) => {
      const common = { workspaceId: "team", userId: "alice", joinedAt: 0, updatedAt: 0 };
      await ctx.db.insert("collabMemberships", { ...common, role: "owner", state: "active" });
      await ctx.db.insert("collabMemberships", { ...common, role: "member", state: "revoked" });
      await ctx.db.insert("collabGroupMemberships", { workspaceId: "team", groupId: "group", userId: "alice", state: "active", createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("collabGroupMemberships", { workspaceId: "team", groupId: "group", userId: "alice", state: "revoked", createdAt: 0, updatedAt: 0 });
    });
    for (const check of [
      (store: ReturnType<typeof convexCollaborationStore>) => store.transaction((tx) => tx.listUserMemberships("alice")),
      (store: ReturnType<typeof convexCollaborationStore>) => store.transaction((tx) => tx.listWorkspaceMemberships("team")),
      (store: ReturnType<typeof convexCollaborationStore>) => store.transaction((tx) => tx.listUserGroupMemberships("team", "alice")),
      (store: ReturnType<typeof convexCollaborationStore>) => store.transaction((tx) => tx.listGroupMemberships("team", "group")),
    ])
      await expect(
        t.run(async (ctx) => {
          await check(convexCollaborationStore(ctx.db));
        }),
      ).rejects.toMatchObject({ code: "INTERNAL" });
  });

  it("can revoke a member after more than the active group limit of archived-group history", async () => {
    const { t, run } = setup();
    const { workspace } = await run((service) => service.createOrganization(alice, { name: "Long-lived team" }));
    await t.run(async (ctx) => {
      await ctx.db.insert("collabMemberships", { workspaceId: workspace.id, userId: "bob", role: "member", state: "active", joinedAt: 0, updatedAt: 0 });
      for (let index = 0; index <= COLLABORATION_LIMITS.groupsPerWorkspace; index++) {
        const groupId = `historical-${index}`;
        await ctx.db.insert("collabGroups", { logicalId: groupId, workspaceId: workspace.id, name: groupId, state: "archived", createdAt: 0, updatedAt: 0 });
        await ctx.db.insert("collabGroupMemberships", { workspaceId: workspace.id, groupId, userId: "bob", state: "revoked", createdAt: 0, updatedAt: 0 });
      }
      await ctx.db.insert("collabGroups", { logicalId: "current", workspaceId: workspace.id, name: "Current", state: "active", createdAt: 0, updatedAt: 0 });
      await ctx.db.insert("collabGroupMemberships", {
        workspaceId: workspace.id,
        groupId: "current",
        userId: "bob",
        state: "active",
        createdAt: 0,
        updatedAt: 0,
      });
    });
    const revoked = await run((service) => service.changeMembership(alice, { workspaceId: workspace.id, userId: "bob", next: { state: "revoked" } }));
    expect(revoked.membership.state).toBe("revoked");
    await t.run(async (ctx) => {
      expect(await convexCollaborationStore(ctx.db).transaction((tx) => tx.listUserGroupMemberships(workspace.id, "bob"))).toEqual([]);
      const historical = await ctx.db
        .query("collabGroups")
        .withIndex("by_workspaceId_state", (q) => q.eq("workspaceId", workspace.id).eq("state", "archived"))
        .take(COLLABORATION_LIMITS.groupsPerWorkspace + 2);
      expect(historical).toHaveLength(COLLABORATION_LIMITS.groupsPerWorkspace + 1);
    });
  });

  it("does not allow terminal invitations to change identity or return to pending", async () => {
    const { t, run } = setup();
    const { workspace } = await run((service) => service.createOrganization(alice, { name: "Team" }));
    const invitation = await run((service) => service.createInvitation(alice, { workspaceId: workspace.id, email: bob.verifiedEmail }));
    await run((service) => service.acceptInvitation(bob, { token: invitation.token }));
    await t.run(async (ctx) => {
      await convexCollaborationStore(ctx.db).transaction(async (tx) => {
        const row = await tx.getInvitation(invitation.invitation.id);
        if (!row) throw new Error("Missing fixture invite");
        await expect(tx.putInvitation({ ...row, tokenHash: "different" })).rejects.toMatchObject({ code: "VALIDATION" });
        if (row.state !== "accepted") throw new Error("Expected an accepted fixture invite");
        const { acceptedBy: _actor, acceptedAt: _at, ...base } = row;
        await expect(tx.putInvitation({ ...base, state: "pending" })).rejects.toMatchObject({ code: "CONFLICT" });
      });
    });
  });
});
