import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../experiments/max-v2-pr17/convex/schema";

const modules = {
  "./_generated/api.ts": async () => ({}),
  "./provider.ts": () => import("../../experiments/max-v2-pr17/convex/provider"),
};
const mutation = (name: string) => makeFunctionReference<"mutation">("provider:" + name);
const query = (name: string) => makeFunctionReference<"query">("provider:" + name);
const join = mutation("join");
const createThread = mutation("createCommentThread");
const reply = mutation("replyToCommentThread");
const propose = mutation("createSuggestion");
const decide = mutation("reviewSuggestion");
const revoke = mutation("revokeMember");
const read = mutation("markInboxRead");
const inbox = query("listInbox");
const workspaceId = "lab-workspace", pageId = "lab-page";
let oldFlag: string | undefined;

beforeEach(() => {
  oldFlag = process.env.MAX_V2_PR17_PROVIDER_SANDBOX;
  process.env.MAX_V2_PR17_PROVIDER_SANDBOX = "true";
});
afterEach(() => {
  if (oldFlag === undefined) delete process.env.MAX_V2_PR17_PROVIDER_SANDBOX;
  else process.env.MAX_V2_PR17_PROVIDER_SANDBOX = oldFlag;
});

async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    await ctx.db.insert("workspaces", { workspaceId, ownerId: "alice", status: "active" });
    for (const [accountId, role] of [
      ["alice", "owner"], ["bob", "member"],
      ["carol", "guest"], ["dave", "member"],
    ] as const)
      await ctx.db.insert("workspaceMemberships", { workspaceId, accountId, role, status: "active" });
    await ctx.db.insert("workspacePageScopes", { workspaceId, pageId, parentId: null, teamspaceId: null });
    await ctx.db.insert("workspacePageScopes", { workspaceId, pageId: "another-page", parentId: null, teamspaceId: null });
    for (const [subjectId, level] of [
      ["bob", "edit_content"], ["carol", "view"], ["dave", "comment"],
    ] as const)
      await ctx.db.insert("workspacePageGrants", {
        workspaceId, pageId, subjectType: "account", subjectId, effect: "allow", level,
      });
  });
  const alice = t.withIdentity({ subject: "alice", tokenIdentifier: "pr28|alice" });
  const bob = t.withIdentity({ subject: "bob", tokenIdentifier: "pr28|bob" });
  const carol = t.withIdentity({ subject: "carol", tokenIdentifier: "pr28|carol" });
  const dave = t.withIdentity({ subject: "dave", tokenIdentifier: "pr28|dave" });
  const outsider = t.withIdentity({ subject: "outsider", tokenIdentifier: "pr28|outsider" });
  const a = await alice.mutation(join, { workspaceId, pageId });
  const b = await bob.mutation(join, { workspaceId, pageId });
  const c = await carol.mutation(join, { workspaceId, pageId });
  const d = await dave.mutation(join, { workspaceId, pageId });
  const another = await alice.mutation(join, { workspaceId, pageId: "another-page" });
  return { t, alice, bob, carol, dave, outsider, a, b, c, d, another };
}
const comment = (sessionId: any, operationId = "commentpr28one", mentions = ["bob"]) =>
  ({ sessionId, blockId: "block-28", body: "مرحبا", mentions, operationId });
const suggestion = (sessionId: any) => ({
  sessionId, blockId: "block-28", originalText: "Original",
  replacementText: "New paragraph", note: "", expectedHeadSeq: 0,
  operationId: "proposepr28one",
});

describe("PR28 private collaboration inbox", () => {
  it("delivers mention metadata only, excluding source bodies and the author", async () => {
    const { t, dave, bob, carol, d, b, c } = await setup();
    const source = await dave.mutation(createThread, comment(d.sessionId));
    const result = await bob.query(inbox, { sessionId: b.sessionId });
    expect(result).toMatchObject({
      unreadCount: 1, notifications: [{ kind: "mention", actorId: "dave", readAt: null }],
    });
    expect(result.notifications[0].targetId).toBe(source.commentId);
    expect(JSON.stringify(result)).not.toContain("مرحبا");
    expect((await dave.query(inbox, { sessionId: d.sessionId })).unreadCount).toBe(0);
    expect((await carol.query(inbox, { sessionId: c.sessionId })).unreadCount).toBe(0);
    expect(await t.run(ctx => ctx.db.query("labNotifications").collect())).toHaveLength(1);
  });
  it("retries are idempotent and read acknowledgments are repeatable", async () => {
    const { dave, bob, d, b } = await setup();
    await dave.mutation(createThread, comment(d.sessionId));
    await dave.mutation(createThread, comment(d.sessionId));
    const before = await bob.query(inbox, { sessionId: b.sessionId });
    expect(before.notifications).toHaveLength(1);
    const item = before.notifications[0];
    const first = await bob.mutation(read, { sessionId: b.sessionId, notificationId: item.notificationId });
    expect(first.duplicate).toBe(false);
    expect(await bob.mutation(read, { sessionId: b.sessionId, notificationId: item.notificationId }))
      .toEqual({ ...first, duplicate: true });
    expect((await bob.query(inbox, { sessionId: b.sessionId })).unreadCount).toBe(0);
  });
  it("reply author notification is deduplicated against an explicit mention", async () => {
    const { bob, dave, b, d } = await setup();
    const thread = await dave.mutation(createThread, comment(d.sessionId, "threadpr28one", []));
    await bob.mutation(reply, {
      sessionId: b.sessionId, threadId: thread.threadId,
      operationId: "replypr28one", body: "Reply", mentions: ["dave"],
    });
    const result = await dave.query(inbox, { sessionId: d.sessionId });
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].kind).toBe("mention");
    await bob.mutation(reply, {
      sessionId: b.sessionId, threadId: thread.threadId,
      operationId: "replypr28two", body: "Another reply", mentions: [],
    });
    const after = await dave.query(inbox, { sessionId: d.sessionId });
    expect(after.notifications.map((n: {kind:string}) => n.kind)).toEqual(["thread_reply", "mention"]);
  });
  it("inbox records suggestion decisions without applying document updates", async () => {
    const { t, dave, bob, d, b } = await setup();
    const made = await dave.mutation(propose, suggestion(d.sessionId));
    await bob.mutation(decide, {
      sessionId: b.sessionId, suggestionId: made.suggestionId,
      expectedRevision: 1, expectedHeadSeq: 0, decision: "accept",
      operationId: "decidepr28one",
    });
    const result = await dave.query(inbox, { sessionId: d.sessionId });
    expect(result.notifications).toHaveLength(1);
    expect(result.notifications[0].kind).toBe("suggestion_decision");
    expect(result.notifications[0].targetId).toBe(made.suggestionId);
    await bob.mutation(decide, {
      sessionId: b.sessionId, suggestionId: made.suggestionId,
      expectedRevision: 1, expectedHeadSeq: 0, decision: "accept",
      operationId: "decidepr28one",
    });
    expect((await dave.query(inbox, { sessionId: d.sessionId })).notifications).toHaveLength(1);
    expect(await t.run(ctx => ctx.db.query("labUpdates").collect())).toHaveLength(0);
  });
  it("cross-account, cross-room, expired sessions and revoked users cannot read or acknowledge", async () => {
    const { t, alice, bob, dave, outsider, a, b, d, another } = await setup();
    await dave.mutation(createThread, comment(d.sessionId));
    const item = (await bob.query(inbox, { sessionId: b.sessionId })).notifications[0];
    await expect(dave.query(inbox, { sessionId: b.sessionId })).rejects.toThrow();
    await expect(outsider.query(inbox, { sessionId: b.sessionId })).rejects.toThrow();
    await expect(alice.mutation(read, {
      sessionId: a.sessionId, notificationId: item.notificationId,
    })).rejects.toThrow();
    await expect(alice.mutation(read, {
      sessionId: another.sessionId, notificationId: item.notificationId,
    })).rejects.toThrow();
    await alice.mutation(revoke, { workspaceId, pageId, targetAccountId: "bob" });
    await expect(bob.query(inbox, { sessionId: b.sessionId })).rejects.toThrow();
    await expect(bob.mutation(read, {
      sessionId: b.sessionId, notificationId: item.notificationId,
    })).rejects.toThrow();
    await t.run(async ctx => {
      const sessions = await ctx.db.query("labSessions").collect();
      for (const row of sessions) await ctx.db.patch(row._id, { expiresAt: Date.now() - 1000 });
    });
    await expect(alice.query(inbox, { sessionId: a.sessionId })).rejects.toThrow();
  });
  it("revoked actors are redacted, and disabled lab gate fails closed", async () => {
    const { alice, bob, dave, b, d } = await setup();
    await dave.mutation(createThread, comment(d.sessionId));
    await alice.mutation(revoke, { workspaceId, pageId, targetAccountId: "dave" });
    const items = (await bob.query(inbox, { sessionId: b.sessionId })).notifications;
    expect(items[0].actorId).toBeNull();
    process.env.MAX_V2_PR17_PROVIDER_SANDBOX = "false";
    await expect(bob.query(inbox, { sessionId: b.sessionId })).rejects.toThrow();
  });
  it("evicts only the recipient's oldest event at the bounded 64-item limit", async () => {
    const { t, dave, bob, b, d } = await setup();
    await t.run(async ctx => {
      const room = (await ctx.db.query("labRooms").collect())[0];
      for (let i = 0; i < 64; i++)
        await ctx.db.insert("labNotifications", {
          roomId: room._id, recipientId: "bob", actorId: "dave",
          kind: "mention", targetId: "historical" + i,
          createdAt: i, readAt: null,
        });
      await ctx.db.insert("labNotifications", {
        roomId: room._id, recipientId: "dave", actorId: "bob",
        kind: "thread_reply", targetId: "independent",
        createdAt: 1, readAt: null,
      });
    });
    expect((await bob.query(inbox, { sessionId: b.sessionId })).notifications).toHaveLength(64);
    await dave.mutation(createThread, comment(d.sessionId));
    const result = await bob.query(inbox, { sessionId: b.sessionId });
    expect(result.notifications).toHaveLength(64);
    expect(result.notifications.some((n: {targetId:string}) => n.targetId === "historical0")).toBe(false);
    expect((await dave.query(inbox, { sessionId: d.sessionId })).notifications).toHaveLength(1);
  });
});
