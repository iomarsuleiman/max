import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { convexCollaborationStore } from "@/convex/collaborationStore";
import { readPageGrantSet, replaceStoredPageAccess, listPrincipalGrantPageIds } from "@/convex/pageGrantStore";
import { convexPagePolicies } from "@/convex/pagePolicyStore";
import { newPageRow } from "@/lib/domain/ops/helpers";
import { convexDb } from "@/convex/convexDb";
import { COLLABORATION_LIMITS } from "@/lib/domain/collaboration/collaborationStore";
import type { AccessGrant } from "@/lib/domain/collaboration/policy";

const groupPrincipal = { kind: "group", groupId: "group" } as const;
const allow: AccessGrant = { principal: groupPrincipal, effect: "allow", grant: "view", expiresAt: null };
const deny: AccessGrant = { principal: groupPrincipal, effect: "deny" };
async function fixture() {
  const t = convexTest(schema, { "../../convex/_generated/server.ts": async () => ({}) });
  const ids = await t.run(async (ctx) => {
    await ctx.db.insert("collabWorkspaces", { logicalId: "workspace", kind: "organization", state: "active", name: "Workspace", createdAt: 0, updatedAt: 0 });
    await ctx.db.insert("collabGroups", { logicalId: "group", workspaceId: "workspace", name: "Group", state: "active", createdAt: 0, updatedAt: 0 });
    const context = { db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 0, source: "ui" } as const;
    const first = await ctx.db.insert("pages", newPageRow(context, { rank: "a", workspaceId: "workspace" }));
    const second = await ctx.db.insert("pages", newPageRow(context, { rank: "b", workspaceId: "workspace" }));
    return { first, second };
  });
  return { t, ...ids };
}

describe("canonical native page grants", () => {
  it("uses the same canonical rows for forward and effect-scoped reverse reads", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      await replaceStoredPageAccess(ctx.db, {
        pageId: f.first,
        workspaceId: "workspace",
        mode: "replace",
        grants: [allow, deny],
        baseRevision: 0,
        updatedBy: "alice",
        now: 1,
      });
      await replaceStoredPageAccess(ctx.db, {
        pageId: f.second,
        workspaceId: "workspace",
        mode: "inherit",
        grants: [allow],
        baseRevision: 0,
        updatedBy: "alice",
        now: 1,
      });
      const tx = convexCollaborationStore(ctx.db);
      await tx.transaction(async (metadata) => {
        expect(new Set(await metadata.listPrincipalGrantPageIds("workspace", groupPrincipal))).toEqual(new Set([f.first, f.second]));
        expect(await metadata.listPrincipalGrantPageIds("workspace", groupPrincipal, "deny")).toEqual([f.first]);
        expect((await metadata.getPolicyPage(f.first))?.access).toEqual({ mode: "replace", grants: [allow, deny] });
        expect(await metadata.listPrincipalGrantPageIds("foreign", groupPrincipal)).toEqual([]);
      });
    });
  });

  it("replaces the entire grant set atomically and refuses stale revisions", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      expect(
        await replaceStoredPageAccess(ctx.db, {
          pageId: f.first,
          workspaceId: "workspace",
          mode: "inherit",
          grants: [allow],
          baseRevision: 0,
          updatedBy: "alice",
          now: 1,
        }),
      ).toBe(1);
      const input = { pageId: f.first, workspaceId: "workspace", mode: "replace", grants: [deny], baseRevision: 1, updatedBy: "alice", now: 2 } as const;
      expect(await replaceStoredPageAccess(ctx.db, input)).toBe(2);
      await expect(replaceStoredPageAccess(ctx.db, input)).rejects.toMatchObject({ code: "CONFLICT" });
      const current = await readPageGrantSet(ctx.db, f.first, "workspace");
      expect(current.rows).toHaveLength(1);
      expect(current.rows[0]).toMatchObject({ aclRevision: 2, value: deny });
      expect(await listPrincipalGrantPageIds(ctx.db, "workspace", groupPrincipal, "allow")).toEqual([]);
    });
    await expect(
      f.t.run(async (ctx) => {
        await replaceStoredPageAccess(ctx.db, {
          pageId: f.first,
          workspaceId: "workspace",
          mode: "inherit",
          grants: [],
          baseRevision: 2,
          updatedBy: "alice",
          now: 3,
        });
        throw new Error("Later failure");
      }),
    ).rejects.toThrow("Later failure");
    expect(await f.t.run(async (ctx) => (await readPageGrantSet(ctx.db, f.first, "workspace")).rows.map((row) => row.value))).toEqual([deny]);
  });

  it("rejects foreign and archived group principals before modifying existing permissions", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const input = { pageId: f.first, workspaceId: "workspace", mode: "inherit", grants: [allow], baseRevision: 0, updatedBy: "alice", now: 1 } as const;
      const group = (
        await ctx.db
          .query("collabGroups")
          .withIndex("by_logicalId", (q) => q.eq("logicalId", "group"))
          .take(1)
      )[0];
      await ctx.db.patch(group._id, { state: "archived" });
      await expect(replaceStoredPageAccess(ctx.db, input)).rejects.toMatchObject({ code: "INTERNAL" });
      await ctx.db.patch(group._id, { state: "active", workspaceId: "foreign" });
      await expect(replaceStoredPageAccess(ctx.db, input)).rejects.toMatchObject({ code: "INTERNAL" });
      expect(await ctx.db.query("collabPageAccess").take(1)).toEqual([]);
      expect(await ctx.db.query("collabPageGrants").take(1)).toEqual([]);
    });
  });

  it.each(["count", "revision", "key", "duplicate", "missing-header"])("fails closed on %s inconsistencies in forward and reverse reads", async (fault) => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      await replaceStoredPageAccess(ctx.db, {
        pageId: f.first,
        workspaceId: "workspace",
        mode: "inherit",
        grants: [allow],
        baseRevision: 0,
        updatedBy: "alice",
        now: 1,
      });
      const set = await readPageGrantSet(ctx.db, f.first, "workspace");
      const row = set.rows[0];
      if (!set.header) throw new Error("Missing fixture header");
      if (fault === "count") await ctx.db.patch(set.header._id, { grantCount: 2 });
      if (fault === "revision") await ctx.db.patch(row._id, { aclRevision: 2 });
      if (fault === "key") await ctx.db.patch(row._id, { value: { ...allow, principal: { kind: "user", userId: "alice" } } });
      if (fault === "duplicate") {
        const { _id: _id, _creationTime: _at, ...fields } = row;
        await ctx.db.insert("collabPageGrants", fields);
        await ctx.db.patch(set.header._id, { grantCount: 2 });
      }
      if (fault === "missing-header") await ctx.db.delete(set.header._id);
      await expect(convexPagePolicies(ctx.db).getPolicyPage(f.first)).rejects.toMatchObject({ code: "INTERNAL" });
      await expect(listPrincipalGrantPageIds(ctx.db, "workspace", groupPrincipal)).rejects.toMatchObject({ code: "INTERNAL" });
    });
  });

  it("throws on reverse overflow instead of silently omitting protected anchors", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      for (let index = 0; index <= COLLABORATION_LIMITS.grantAnchorsPerPrincipal; index++)
        await ctx.db.insert("collabPageGrants", {
          logicalId: `oversized-${index}`,
          workspaceId: "workspace",
          pageId: f.first,
          aclRevision: 1,
          principalKey: "group:group",
          value: allow,
        });
      await expect(listPrincipalGrantPageIds(ctx.db, "workspace", groupPrincipal)).rejects.toMatchObject({ code: "LIMIT" });
    });
  });

  it("lets only one concurrent replacement consume a permissions revision", async () => {
    const f = await fixture();
    const input = { pageId: f.first, workspaceId: "workspace", mode: "inherit", baseRevision: 0, updatedBy: "alice", now: 1 } as const;
    const settled = await Promise.allSettled([
      f.t.run((ctx) => replaceStoredPageAccess(ctx.db, { ...input, grants: [allow] })),
      f.t.run((ctx) => replaceStoredPageAccess(ctx.db, { ...input, grants: [deny] })),
    ]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((result) => result.status === "rejected")).toHaveLength(1);
    const set = await f.t.run((ctx) => readPageGrantSet(ctx.db, f.first, "workspace"));
    expect(set.header?.aclRevision).toBe(1);
    expect(set.rows).toHaveLength(1);
  });
});
