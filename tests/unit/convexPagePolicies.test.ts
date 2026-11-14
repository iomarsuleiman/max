import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { convexCollaborationStore } from "@/convex/collaborationStore";
import { convexPagePolicies } from "@/convex/pagePolicyStore";
import { convexDb } from "@/convex/convexDb";
import { authorizeCollaborationPage, filterAuthorizedCollaborationPages } from "@/lib/domain/collaboration/authorization";
import { WorkspaceService } from "@/lib/domain/collaboration/workspaces";
import { COLLABORATION_LIMITS, type CollaborationRuntime } from "@/lib/domain/collaboration/collaborationStore";
import { newPageRow } from "@/lib/domain/ops/helpers";

const alice = { userId: "alice", verifiedEmail: "alice@example.com" };
const bob = { userId: "bob", verifiedEmail: "bob@example.com" };
function setup() {
  const t = convexTest(schema, { "../../convex/_generated/server.ts": async () => ({}) });
  let sequence = 0;
  const runtime: CollaborationRuntime = {
    now: () => 1000,
    newId: () => `fixture-${++sequence}`,
    createInvitationToken: () => `max-invite-v1.${(++sequence).toString(16).padStart(64, "0")}`,
    hashInvitationToken: async (token) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
  return { t, runtime };
}

describe("native page policy reader and authorization composition", () => {
  it.each(["direct", "group"] as const)("invalidates private %s admission through revocation/rejoin and requires explicit readmission", async (admission) => {
    const { t, runtime } = setup();
    await t.run(async (ctx) => {
      const metadata = convexCollaborationStore(ctx.db);
      const service = new WorkspaceService(metadata, runtime);
      const { workspace } = await service.createOrganization(alice, { name: "Private collaboration" });
      const join = async () => {
        const invitation = await service.createInvitation(alice, { workspaceId: workspace.id, email: bob.verifiedEmail });
        await service.acceptInvitation(bob, { token: invitation.token });
      };
      await join();
      const { group } = await service.createGroup(alice, { workspaceId: workspace.id, name: "Private readers" });
      if (admission === "group") await service.setGroupMember(alice, { workspaceId: workspace.id, groupId: group.id, userId: "bob", state: "active" });
      const { teamspace } = await service.createTeamspace(alice, {
        workspaceId: workspace.id,
        name: "Private teamspace",
        visibility: "private",
        defaultGrant: "view",
        memberUserIds: admission === "direct" ? ["bob"] : [],
        memberGroupIds: admission === "group" ? [group.id] : [],
      });
      const pageContext = { db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" } as const;
      const parent = await ctx.db.insert("pages", newPageRow(pageContext, { rank: "a", workspaceId: workspace.id, teamspaceId: teamspace.id }));
      const child = await ctx.db.insert(
        "pages",
        newPageRow(pageContext, { rank: "b", parentId: parent, workspaceId: workspace.id, teamspaceId: teamspace.id }),
      );
      await metadata.transaction(async (transaction) => {
        // Reuse the real reader across changes to prove no stale admission cache.
        const input = {
          transaction,
          pages: convexPagePolicies(ctx.db),
          actor: bob,
          workspaceId: workspace.id,
          pageId: child,
          capability: "page.read",
          now: 1000,
        } as const;
        expect((await authorizeCollaborationPage(input)).grant).toBe("view");
        await expect(authorizeCollaborationPage({ ...input, capability: "page.edit_content" })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await service.changeMembership(alice, { workspaceId: workspace.id, userId: "bob", next: { state: "revoked" } });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await join();
        expect(await transaction.getMembership(workspace.id, "bob")).toMatchObject({ state: "active", role: "member" });
        const revokedTeamspace = await transaction.getTeamspace(teamspace.id);
        expect(revokedTeamspace?.memberUserIds).not.toContain("bob");
        if (admission === "group")
          expect((await transaction.listGroupMemberships(workspace.id, group.id)).find((member) => member.userId === "bob")?.state).toBe("revoked");
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        if (admission === "direct") {
          await service.updateTeamspace(alice, {
            workspaceId: workspace.id,
            teamspaceId: teamspace.id,
            name: teamspace.name,
            visibility: "private",
            defaultGrant: "view",
            memberUserIds: ["alice", "bob"],
            memberGroupIds: [],
            managerUserIds: ["alice"],
          });
        } else {
          await service.setGroupMember(alice, { workspaceId: workspace.id, groupId: group.id, userId: "bob", state: "active" });
        }
        expect((await authorizeCollaborationPage(input)).grant).toBe("view");
        if (admission === "direct") {
          await service.updateTeamspace(alice, {
            workspaceId: workspace.id,
            teamspaceId: teamspace.id,
            name: teamspace.name,
            visibility: "private",
            defaultGrant: "view",
            memberUserIds: ["alice"],
            memberGroupIds: [],
            managerUserIds: ["alice"],
          });
        } else {
          // Simulate a stale active membership left behind by a group archive.
          await transaction.patchGroup(group.id, { state: "archived", updatedAt: 1000 });
          expect((await transaction.listGroupMemberships(workspace.id, group.id)).find((member) => member.userId === "bob")?.state).toBe("active");
        }
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });

  it("rejects actual mixed, missing and foreign teamspace markers throughout stored ancestry", async () => {
    const { t, runtime } = setup();
    await t.run(async (ctx) => {
      const metadata = convexCollaborationStore(ctx.db);
      const service = new WorkspaceService(metadata, runtime);
      const { workspace } = await service.createOrganization(alice, { name: "Workspace" });
      await metadata.transaction((tx) =>
        tx.putMembership({ workspaceId: workspace.id, userId: "bob", role: "member", state: "active", joinedAt: 0, updatedAt: 0 }),
      );
      const first = await service.createTeamspace(alice, {
        workspaceId: workspace.id,
        name: "First",
        visibility: "private",
        defaultGrant: "view",
        memberUserIds: ["bob"],
      });
      const second = await service.createTeamspace(alice, {
        workspaceId: workspace.id,
        name: "Second",
        visibility: "private",
        defaultGrant: "view",
        memberUserIds: ["bob"],
      });
      const foreign = await service.createOrganization(alice, { name: "Foreign" });
      const foreignTeam = await service.createTeamspace(alice, {
        workspaceId: foreign.workspace.id,
        name: "Foreign team",
        visibility: "open",
        defaultGrant: "full",
      });
      const pageContext = { db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" } as const;
      const parent = await ctx.db.insert("pages", newPageRow(pageContext, { rank: "a", workspaceId: workspace.id, teamspaceId: first.teamspace.id }));
      const child = await ctx.db.insert(
        "pages",
        newPageRow(pageContext, { rank: "b", workspaceId: workspace.id, teamspaceId: first.teamspace.id, parentId: parent }),
      );
      await metadata.transaction(async (transaction) => {
        const input = {
          transaction,
          pages: convexPagePolicies(ctx.db),
          actor: bob,
          workspaceId: workspace.id,
          pageId: child,
          capability: "page.read",
          now: 1000,
        } as const;
        await authorizeCollaborationPage(input);
        // Bob belongs to both teamspaces; denial must come from mixed ancestry.
        await ctx.db.patch(child, { teamspaceId: second.teamspace.id });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await ctx.db.patch(child, { teamspaceId: null });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await ctx.db.patch(parent, { teamspaceId: second.teamspace.id });
        await ctx.db.patch(child, { teamspaceId: second.teamspace.id });
        await authorizeCollaborationPage(input);
        await transaction.patchTeamspace(second.teamspace.id, { state: "archived", updatedAt: 1000 });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        for (const teamspaceId of [foreignTeam.teamspace.id, "missing-teamspace"]) {
          await ctx.db.patch(parent, { teamspaceId });
          await ctx.db.patch(child, { teamspaceId });
          await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        }
      });
    });
  });

  it("resolves stored databaseId parents and enforces inherited grants, denial, dual-parent and foreign-scope checks", async () => {
    const { t, runtime } = setup();
    await t.run(async (ctx) => {
      const metadata = convexCollaborationStore(ctx.db);
      const service = new WorkspaceService(metadata, runtime);
      const { workspace } = await service.createOrganization(alice, { name: "Database workspace" });
      const foreign = await service.createOrganization(alice, { name: "Foreign workspace" });
      await metadata.transaction((tx) =>
        tx.putMembership({ workspaceId: workspace.id, userId: "bob", role: "member", state: "active", joinedAt: 0, updatedAt: 0 }),
      );
      const pageContext = { db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" } as const;
      const database = await ctx.db.insert("pages", newPageRow(pageContext, { rank: "a", kind: "database", workspaceId: workspace.id }));
      const record = await ctx.db.insert("pages", newPageRow(pageContext, { rank: "b", databaseId: database, workspaceId: workspace.id }));
      const foreignDatabase = await ctx.db.insert("pages", newPageRow(pageContext, { rank: "c", kind: "database", workspaceId: foreign.workspace.id }));
      const ordinaryPage = await ctx.db.insert("pages", newPageRow(pageContext, { rank: "d", kind: "page", workspaceId: workspace.id }));
      const databaseRule = await ctx.db.insert("collabPageAccess", {
        pageId: database,
        workspaceId: workspace.id,
        mode: "inherit",
        grants: [{ principal: { kind: "user", userId: "bob" }, effect: "allow", grant: "comment", expiresAt: null }],
        updatedAt: 0,
        updatedBy: "alice",
      });
      await metadata.transaction(async (transaction) => {
        const reader = convexPagePolicies(ctx.db);
        const input = { transaction, pages: reader, actor: bob, workspaceId: workspace.id, pageId: record, capability: "page.read", now: 1000 } as const;
        expect((await reader.getPolicyPage(record))?.parentId).toBe(database);
        expect((await authorizeCollaborationPage(input)).grant).toBe("comment");
        await authorizeCollaborationPage({ ...input, capability: "page.comment" });
        await expect(authorizeCollaborationPage({ ...input, capability: "database.edit_values" })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await ctx.db.insert("collabPageAccess", {
          pageId: record,
          workspaceId: workspace.id,
          mode: "replace",
          grants: [{ principal: { kind: "user", userId: "bob" }, effect: "allow", grant: "full", expiresAt: null }],
          updatedAt: 0,
          updatedBy: "alice",
        });
        await authorizeCollaborationPage({ ...input, capability: "database.edit_values" });
        await ctx.db.patch(databaseRule, { grants: [{ principal: { kind: "user", userId: "bob" }, effect: "deny" }] });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await ctx.db.patch(record, { databaseId: foreignDatabase });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        // The record has its own full grant. A normal same-workspace page must
        // still not become a database parent merely because its ID was stored.
        await ctx.db.patch(record, { databaseId: ordinaryPage, parentId: null });
        expect(await reader.getPolicyPage(record)).toBeNull();
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await ctx.db.patch(record, { databaseId: database, parentId: database });
        expect(await reader.getPolicyPage(record)).toBeNull();
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });

  it("resolves legacy personal pages without modifying their IDs or stored rows", async () => {
    const { t, runtime } = setup();
    await t.run(async (ctx) => {
      const metadata = convexCollaborationStore(ctx.db);
      const { workspace } = await new WorkspaceService(metadata, runtime).ensurePersonalWorkspace(alice);
      const id = await ctx.db.insert(
        "pages",
        newPageRow(
          { db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" },
          { rank: "a", title: "Personal العربية", archivedAt: 900, isTemplate: true },
        ),
      );
      const before = await ctx.db.get(id);
      await metadata.transaction(async (transaction) => {
        const input = {
          transaction,
          pages: convexPagePolicies(ctx.db),
          actor: alice,
          workspaceId: workspace.id,
          pageId: id,
          capability: "page.read",
          now: 1000,
        } as const;
        expect((await authorizeCollaborationPage(input)).grant).toBe("full");
        await expect(authorizeCollaborationPage({ ...input, actor: bob })).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
      expect(await ctx.db.get(id)).toEqual(before);
      expect(await ctx.db.query("collabPageAccess").take(1)).toEqual([]);
    });
  });

  it("uses stored page grants instead of creator/owner shortcuts and observes membership revocation", async () => {
    const { t, runtime } = setup();
    await t.run(async (ctx) => {
      const metadata = convexCollaborationStore(ctx.db);
      const { workspace } = await new WorkspaceService(metadata, runtime).createOrganization(alice, { name: "Team" });
      await metadata.transaction((tx) =>
        tx.putMembership({ workspaceId: workspace.id, userId: "bob", role: "member", state: "active", joinedAt: 0, updatedAt: 0 }),
      );
      const id = await ctx.db.insert(
        "pages",
        newPageRow({ db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" }, { rank: "a", workspaceId: workspace.id }),
      );
      await ctx.db.insert("collabPageAccess", {
        pageId: id,
        workspaceId: workspace.id,
        mode: "inherit",
        grants: [{ principal: { kind: "user", userId: "bob" }, effect: "allow", grant: "comment", expiresAt: null }],
        updatedAt: 0,
        updatedBy: "alice",
      });
      await metadata.transaction(async (transaction) => {
        const input = {
          transaction,
          pages: convexPagePolicies(ctx.db),
          actor: bob,
          workspaceId: workspace.id,
          pageId: id,
          capability: "page.comment",
          now: 1000,
        } as const;
        expect((await authorizeCollaborationPage(input)).grant).toBe("comment");
        await expect(authorizeCollaborationPage({ ...input, capability: "page.edit_content" })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await expect(authorizeCollaborationPage({ ...input, actor: alice, capability: "page.read" })).rejects.toMatchObject({ code: "NOT_FOUND" });
        await transaction.putMembership({ workspaceId: workspace.id, userId: "bob", role: "member", state: "revoked", joinedAt: 0, updatedAt: 1000 });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });

  it("rejects contradictory scope mappings, foreign ancestry, cycles and duplicate ACL rows", async () => {
    const { t, runtime } = setup();
    await t.run(async (ctx) => {
      const metadata = convexCollaborationStore(ctx.db);
      const service = new WorkspaceService(metadata, runtime);
      const { workspace: own } = await service.ensurePersonalWorkspace(alice);
      const { workspace: foreign } = await service.ensurePersonalWorkspace(bob);
      const pageCtx = { db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" } as const;
      const parent = await ctx.db.insert("pages", newPageRow(pageCtx, { rank: "a", workspaceId: foreign.id }));
      const child = await ctx.db.insert("pages", newPageRow(pageCtx, { rank: "b", parentId: parent }));
      const reader = convexPagePolicies(ctx.db);
      expect(await reader.getPolicyPage(parent)).toBeNull();
      await metadata.transaction(async (transaction) => {
        const input = { transaction, pages: reader, actor: alice, workspaceId: own.id, pageId: child, capability: "page.read", now: 1000 } as const;
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await ctx.db.patch(child, { parentId: child });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
        await ctx.db.patch(child, { parentId: null });
        for (let index = 0; index < 2; index++)
          await ctx.db.insert("collabPageAccess", { pageId: child, workspaceId: own.id, mode: "inherit", grants: [], updatedAt: index, updatedBy: "alice" });
        await expect(filterAuthorizedCollaborationPages({ ...input, pageIds: [child] })).rejects.toMatchObject({ code: "INTERNAL" });
      });
    });
  });

  it("invalidates a group grant when the group is archived even with a stale active membership", async () => {
    const { t, runtime } = setup();
    await t.run(async (ctx) => {
      const metadata = convexCollaborationStore(ctx.db);
      const { workspace } = await new WorkspaceService(metadata, runtime).createOrganization(alice, { name: "Team" });
      await metadata.transaction(async (tx) => {
        await tx.putMembership({ workspaceId: workspace.id, userId: "bob", role: "member", state: "active", joinedAt: 0, updatedAt: 0 });
        await tx.insertGroup({ id: "group", workspaceId: workspace.id, name: "Readers", state: "active", createdAt: 0, updatedAt: 0 });
        await tx.putGroupMembership({ workspaceId: workspace.id, groupId: "group", userId: "bob", state: "active", createdAt: 0, updatedAt: 0 });
      });
      const id = await ctx.db.insert(
        "pages",
        newPageRow({ db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" }, { rank: "a", workspaceId: workspace.id }),
      );
      await ctx.db.insert("collabPageAccess", {
        pageId: id,
        workspaceId: workspace.id,
        mode: "inherit",
        grants: [{ principal: { kind: "group", groupId: "group" }, effect: "allow", grant: "view", expiresAt: null }],
        updatedAt: 0,
        updatedBy: "alice",
      });
      await metadata.transaction(async (transaction) => {
        const input = {
          transaction,
          pages: convexPagePolicies(ctx.db),
          actor: bob,
          workspaceId: workspace.id,
          pageId: id,
          capability: "page.read",
          now: 1000,
        } as const;
        expect((await authorizeCollaborationPage(input)).grant).toBe("view");
        await transaction.patchGroup("group", { state: "archived", updatedAt: 1000 });
        await expect(authorizeCollaborationPage(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
      });
    });
  });

  it("fails closed on missing legacy mappings and oversized page grant lists", async () => {
    const { t, runtime } = setup();
    await t.run(async (ctx) => {
      const metadata = convexCollaborationStore(ctx.db);
      const id = await ctx.db.insert("pages", newPageRow({ db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" }, { rank: "a" }));
      const reader = convexPagePolicies(ctx.db);
      expect(await reader.getPolicyPage(id)).toBeNull();
      const { workspace } = await new WorkspaceService(metadata, runtime).ensurePersonalWorkspace(alice);
      await ctx.db.insert("collabPageAccess", {
        pageId: id,
        workspaceId: workspace.id,
        mode: "inherit",
        grants: Array.from({ length: COLLABORATION_LIMITS.grantsPerPage + 1 }, () => ({
          principal: { kind: "user", userId: "alice" } as const,
          effect: "allow" as const,
          grant: "view" as const,
          expiresAt: null,
        })),
        updatedAt: 0,
        updatedBy: "alice",
      });
      await expect(reader.getPolicyPage(id)).rejects.toMatchObject({ code: "LIMIT" });
    });
  });
});
