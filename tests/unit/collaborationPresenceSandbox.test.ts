import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../experiments/max-v2-pr17/convex/schema";
const modules = {
  "./_generated/api.ts": async () => ({}),
  "./provider.ts": () => import("../../experiments/max-v2-pr17/convex/provider"),
};
const m = (name: string) => makeFunctionReference<"mutation">("provider:" + name);
const q = (name: string) => makeFunctionReference<"query">("provider:" + name);
const join = m("join"), publish = m("publishPresence"), stop = m("stopPresence");
const leave = m("leave"), downgrade = m("downgradeMemberEdit"), revoke = m("revokeMember");
const list = q("listPresence");
const ws = "lab-workspace", page = "lab-page";
const selection = { blockId: "block-1", anchor: 1, head: 10 };
let previous: string | undefined;
beforeEach(() => {
  previous = process.env.MAX_V2_PR17_PROVIDER_SANDBOX;
  process.env.MAX_V2_PR17_PROVIDER_SANDBOX = "true";
});
afterEach(() => {
  if (previous === undefined) delete process.env.MAX_V2_PR17_PROVIDER_SANDBOX;
  else process.env.MAX_V2_PR17_PROVIDER_SANDBOX = previous;
});
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    await ctx.db.insert("workspaces", { workspaceId: ws, ownerId: "alice", status: "active" });
    for (const [accountId, role] of [
      ["alice", "owner"], ["bob", "member"], ["carol", "guest"],
    ] as const) await ctx.db.insert("workspaceMemberships", { workspaceId: ws, accountId, role, status: "active" });
    await ctx.db.insert("workspacePageScopes", { workspaceId: ws, pageId: page, parentId: null, teamspaceId: null });
    for (const [subjectId, level] of [["bob", "edit_content"], ["carol", "view"]] as const)
      await ctx.db.insert("workspacePageGrants", {
        workspaceId: ws, pageId: page, subjectType: "account", subjectId, effect: "allow", level,
      });
  });
  const alice = t.withIdentity({ subject: "alice", tokenIdentifier: "pr24|alice" });
  const bob = t.withIdentity({ subject: "bob", tokenIdentifier: "pr24|bob" });
  const carol = t.withIdentity({ subject: "carol", tokenIdentifier: "pr24|carol" });
  const outsider = t.withIdentity({ subject: "outsider", tokenIdentifier: "pr24|outsider" });
  const a = await alice.mutation(join, { workspaceId: ws, pageId: page });
  const b = await bob.mutation(join, { workspaceId: ws, pageId: page });
  const c = await carol.mutation(join, { workspaceId: ws, pageId: page });
  return { t, alice, bob, carol, outsider, a, b, c };
}
describe("PR24 sandbox-only ephemeral presence", () => {
  it("shares scoped status only with authorized users and never trusts a stolen lease", async () => {
    const { alice, bob, carol, outsider, a, b, c } = await setup();
    await alice.mutation(publish, { sessionId: a.sessionId, visible: true, state: "editing", selection });
    await bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "viewing", selection: null });
    await carol.mutation(publish, { sessionId: c.sessionId, visible: true, state: "viewing", selection: null });
    const participants = await bob.query(list, { sessionId: b.sessionId });
    expect(participants.map((p: { accountId: string }) => p.accountId)).toEqual(["alice", "bob", "carol"]);
    expect(participants[0]).toMatchObject({ state: "editing", blockId: "block-1" });
    await expect(outsider.query(list, { sessionId: b.sessionId })).rejects.toThrow();
    await expect(bob.mutation(publish, { sessionId: a.sessionId, visible: true, state: "editing", selection })).rejects.toThrow();
  });
  it("rejects guest editing and malformed text offsets without storing content", async () => {
    const { carol, bob, c, b, t } = await setup();
    await expect(carol.mutation(publish, { sessionId: c.sessionId, visible: true, state: "editing", selection })).rejects.toThrow();
    for (const s of [{ ...selection, anchor: -1 }, { ...selection, head: 1_000_001 },
      { ...selection, head: 1.5 }, { ...selection, blockId: "invalid block" }])
      await expect(bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "viewing", selection: s })).rejects.toThrow();
    expect(await t.run(async ctx => ctx.db.query("labPresence").collect())).toEqual([]);
  });
  it("hides privacy mode and explicitly deleted presence", async () => {
    const { alice, a, t } = await setup();
    await alice.mutation(publish, { sessionId: a.sessionId, visible: true, state: "viewing", selection: null });
    expect(await alice.mutation(publish, { sessionId: a.sessionId, visible: false, state: "viewing", selection: null })).toBeNull();
    await alice.mutation(publish, { sessionId: a.sessionId, visible: true, state: "editing", selection });
    expect(await alice.mutation(stop, { sessionId: a.sessionId })).toBe(true);
    expect(await t.run(async ctx => ctx.db.query("labPresence").collect())).toEqual([]);
  });
  it("filters expired heartbeats and prunes on the next write", async () => {
    const { t, alice, bob, a, b } = await setup();
    await alice.mutation(publish, { sessionId: a.sessionId, visible: true, state: "viewing", selection: null });
    await t.run(async ctx => {
      const [row] = await ctx.db.query("labPresence").collect();
      await ctx.db.patch(row._id, { updatedAt: Date.now() - 21_000, expiresAt: Date.now() - 1_000 });
    });
    expect(await bob.query(list, { sessionId: b.sessionId })).toEqual([]);
    await bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "viewing", selection: null });
    expect((await t.run(async ctx => ctx.db.query("labPresence").collect())).map(r => r.accountId)).toEqual(["bob"]);
  });
  it("live revocation hides stale identity and fences outgoing status", async () => {
    const { alice, bob, a, b } = await setup();
    await bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "editing", selection });
    await alice.mutation(revoke, { workspaceId: ws, pageId: page, targetAccountId: "bob" });
    expect(await alice.query(list, { sessionId: a.sessionId })).toEqual([]);
    await expect(bob.query(list, { sessionId: b.sessionId })).rejects.toThrow();
    await expect(bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "viewing", selection: null })).rejects.toThrow();
  });
  it("live downgrade immediately redacts stale editing; invisible mode still works", async () => {
    const { alice, bob, a, b } = await setup();
    await bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "editing", selection });
    await alice.mutation(downgrade, { workspaceId: ws, pageId: page, targetAccountId: "bob" });
    expect(await alice.query(list, { sessionId: a.sessionId }))
      .toMatchObject([{ accountId: "bob", state: "viewing", blockId: null, anchor: null, head: null }]);
    await expect(bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "editing", selection })).rejects.toThrow();
    expect(await bob.mutation(publish, { sessionId: b.sessionId, visible: false, state: "editing", selection })).toBeNull();
    expect(await alice.query(list, { sessionId: a.sessionId })).toEqual([]);
    await bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "viewing", selection: null });
    expect(await alice.query(list, { sessionId: a.sessionId })).toMatchObject([{ accountId: "bob", state: "viewing" }]);
  });
  it("filters closed sessions and remains disabled when private sandbox flag is off", async () => {
    const { alice, bob, a, b } = await setup();
    await bob.mutation(publish, { sessionId: b.sessionId, visible: true, state: "viewing", selection: null });
    await bob.mutation(leave, { sessionId: b.sessionId });
    expect(await alice.query(list, { sessionId: a.sessionId })).toEqual([]);
    process.env.MAX_V2_PR17_PROVIDER_SANDBOX = "false";
    await expect(alice.query(list, { sessionId: a.sessionId })).rejects.toThrow();
  });
});
