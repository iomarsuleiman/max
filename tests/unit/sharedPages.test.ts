import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, it, expect } from "vitest";
import schema from "@/convex/schema";
import { sharedHistory } from "@/lib/domain/collaboration/sharedContract";

const modules = { "../../convex/_generated/server.ts": async () => ({}), "../../convex/sharedPages.ts": () => import("@/convex/sharedPages"), "../../convex/ops.ts": () => import("@/convex/ops") };
const create = makeFunctionReference<"mutation">("sharedPages:create");
const get = makeFunctionReference<"query">("sharedPages:get");
const list = makeFunctionReference<"query">("sharedPages:list");
const share = makeFunctionReference<"mutation">("sharedPages:setMemberGrant");
const save = makeFunctionReference<"mutation">("sharedPages:save");
const legacy = makeFunctionReference<"query">("ops:query");
const blocks = (text: string) => [{ id: "a", type: "paragraph", props: {}, content: [{ type: "text", text, styles: {} }], children: [] }];

describe("shared text pages", () => {
  it("pages through bounded history and retains the latest hundred saved revisions", async () => {
    const t = convexTest(schema, modules), alice = t.withIdentity({ subject: "alice" });
    await t.run(async ctx => {
      await ctx.db.insert("collabWorkspaces", { logicalId: "w", kind: "organization", name: "Team", state: "active", createdAt: 1, updatedAt: 1 });
      await ctx.db.insert("collabMemberships", { workspaceId: "w", userId: "alice", role: "owner", state: "active", joinedAt: 1, updatedAt: 1 });
      await ctx.db.insert("collabTeamspaces", { logicalId: "t", workspaceId: "w", name: "Team", state: "active", visibility: "open", defaultGrant: "edit", memberUserIds: [], memberGroupIds: [], managerUserIds: ["alice"], createdAt: 1, updatedAt: 1 });
    });
    const { pageId } = await alice.mutation(create, { workspaceId: "w", teamspaceId: "t", title: "History" });
    for (let revision = 1; revision <= 105; revision++) await alice.mutation(save, { workspaceId: "w", pageId, blocks: blocks(`Edit ${revision}`), baseRevision: revision });
    const history = makeFunctionReference<"query">("sharedPages:history");
    const revisions: number[] = [];
    let cursor: string | null = null;
    do {
      const result = sharedHistory.parse(await alice.query(history, { workspaceId: "w", pageId, cursor }));
      expect(result.versions.length).toBeLessThanOrEqual(5);
      expect(result.versions.every((version: object) => !("content" in version))).toBe(true);
      revisions.push(...result.versions.map((version: { revision: number }) => version.revision));
      cursor = result.nextCursor;
    } while (cursor);
    expect(revisions).toEqual(Array.from({ length: 100 }, (_, index) => 105 - index));
    expect((await alice.query(get, { workspaceId: "w", pageId })).document.revision).toBe(106);
  });
  it("enforces fresh grants, revisions, membership and legacy isolation for two identities", async () => {
    const t = convexTest(schema, modules), alice = t.withIdentity({ subject: "alice" }), bob = t.withIdentity({ subject: "bob" });
    await t.run(async ctx => {
      await ctx.db.insert("collabWorkspaces", { logicalId: "w", kind: "organization", name: "Team", state: "active", createdAt: 1, updatedAt: 1 });
      for (const userId of ["alice", "bob"]) await ctx.db.insert("collabMemberships", { workspaceId: "w", userId, role: userId === "alice" ? "owner" : "member", state: "active", joinedAt: 1, updatedAt: 1 });
      await ctx.db.insert("collabTeamspaces", { logicalId: "t", workspaceId: "w", name: "Team", state: "active", visibility: "open", defaultGrant: "edit", memberUserIds: [], memberGroupIds: [], managerUserIds: ["alice"], createdAt: 1, updatedAt: 1 });
    });
    const { pageId } = await alice.mutation(create, { workspaceId: "w", teamspaceId: "t", title: "Private" });
    await expect(bob.query(get, { workspaceId: "w", pageId })).rejects.toThrow();
    expect((await bob.query(list, { workspaceId: "w" })).pages).toEqual([]);
    await expect(alice.query(get, { workspaceId: "other", pageId })).rejects.toThrow();
    await expect(alice.query(legacy, { op: "pages.get", args: { id: pageId } })).rejects.toThrow();
    await alice.mutation(share, { workspaceId: "w", pageId, userId: "bob", grant: "view", baseRevision: 1 });
    expect((await bob.query(get, { workspaceId: "w", pageId })).canEdit).toBe(false);
    await expect(bob.mutation(save, { workspaceId: "w", pageId, blocks: blocks("blocked"), baseRevision: 1 })).rejects.toThrow();
    await alice.mutation(share, { workspaceId: "w", pageId, userId: "bob", grant: "edit", baseRevision: 2 });
    expect((await bob.mutation(save, { workspaceId: "w", pageId, blocks: blocks("bob"), baseRevision: 1 })).revision).toBe(2);
    expect((await alice.mutation(save, { workspaceId: "w", pageId, blocks: blocks("alice"), baseRevision: 2 })).revision).toBe(3);
    await expect(bob.mutation(save, { workspaceId: "w", pageId, blocks: blocks("stale"), baseRevision: 2 })).rejects.toThrow();
    expect((await alice.query(get, { workspaceId: "w", pageId })).document.content).toContain("alice");
    await alice.mutation(share, { workspaceId: "w", pageId, userId: "bob", grant: null, baseRevision: 3 });
    await expect(bob.query(get, { workspaceId: "w", pageId })).rejects.toThrow();
    await alice.mutation(share, { workspaceId: "w", pageId, userId: "bob", grant: "edit", baseRevision: 4 });
    await t.run(async ctx => { const m = await ctx.db.query("collabMemberships").withIndex("by_workspaceId_userId", q => q.eq("workspaceId", "w").eq("userId", "bob")).unique(); if (m) await ctx.db.patch(m._id, { state: "revoked" }); });
    await expect(bob.query(get, { workspaceId: "w", pageId })).rejects.toThrow();
  });
});
