import { z } from "zod";
import { MaxError } from "../errors";
import { findBlock, parseContent, blockText } from "../blocks";
import type { CommentRow } from "../types";
import { confirm, defineOp, id, type OpContext } from "./define";
import { actorOf, requirePage } from "./helpers";
import { people } from "./people";
import { notify } from "../notifications";
import { isOrgNamespace } from "../organizations";
import { accountOf } from "../workspaces";

/** Personal comments on pages and blocks: notes to yourself, resolvable like Notion's. */
const body = z.string().trim().min(1, "Write something first.").max(5000);

async function requireComment(ctx: OpContext, commentId: string): Promise<CommentRow> {
  const c = await ctx.db.get("comments", commentId);
  if (!c || c.ownerId !== ctx.ownerId) throw new MaxError("NOT_FOUND", "That comment doesn't exist anymore.");
  return c;
}

export const commentsList = defineOp({
  name: "comments.list",
  kind: "query",
  title: "List comments",
  description: "Comments on a page and its blocks, oldest first. Each block comment includes a short excerpt of the block it's on. Resolved comments are included only when asked.",
  input: z.object({ pageId: id, includeResolved: z.boolean().optional() }),
  async run(ctx, { pageId, includeResolved = false }) {
    await requirePage(ctx, pageId, { allowArchived: true });
    const rows = (await ctx.db.list("comments", ctx.ownerId, { field: "pageId", value: pageId })).sort((a, b) => a.createdAt - b.createdAt);
    const open = rows.filter((c) => !c.resolvedAt).length;
    const visible = rows.filter((c) => includeResolved || !c.resolvedAt);
    // Avoid reading and JSON-parsing the entire document on every autosave when there are no block comments.
    const needsDoc = visible.some((c) => !!c.blockId);
    const blocks = needsDoc ? parseContent((await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0]?.content ?? "[]") : [];
    return {
      openCount: open,
      resolvedCount: rows.length - open,
      comments: visible.map(({ ownerId: _o, ...c }) => {
        const hit = c.blockId ? findBlock(blocks, c.blockId) : null;
        return { ...c, blockExcerpt: hit ? blockText(hit.block).slice(0, 120) : null, blockMissing: !!c.blockId && !hit };
      }),
    };
  },
});

export const commentsAdd = defineOp({
  name: "comments.add",
  kind: "mutation",
  title: "Add comment",
  description: "Adds a comment to a page, or to one block when blockId is given.",
  input: z.object({
    pageId: id,
    blockId: z.string().max(64).nullable().optional(),
    body,
    parentId: id.nullable().optional().describe("Reply to this comment (a thread)."),
    mentions: z.array(z.string().max(256)).max(20).optional().describe("Ids of people @mentioned (from people.list); they're notified."),
  }),
  async run(ctx, { pageId, blockId = null, body: text, parentId = null, mentions = [] }) {
    const page = await requirePage(ctx, pageId);
    let parent: CommentRow | null = null;
    if (parentId) {
      parent = await requireComment(ctx, parentId);
      if (parent.pageId !== pageId) throw new MaxError("VALIDATION", "You can only reply to a comment on the same page.");
      // Threads are one level deep: a reply to a reply joins the same thread.
      if (parent.parentId) parent = await requireComment(ctx, parent.parentId);
      blockId = parent.blockId;
    }
    const existing = await ctx.db.list("comments", ctx.ownerId, { field: "pageId", value: pageId });
    const allowed = new Set([...(await people(ctx)).map((p) => p.id), ...existing.map((c) => c.authorId).filter((x): x is string => !!x)]);
    const mentioned = [...new Set(mentions)].filter((m) => allowed.has(m));
    if (blockId) {
      const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
      if (!findBlock(parseContent(doc?.content ?? "[]"), blockId)) throw new MaxError("NOT_FOUND", "That block isn't on this page anymore.");
    }
    const row = {
      ownerId: ctx.ownerId,
      pageId,
      blockId,
      body: text,
      resolvedAt: null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
      source: ctx.source,
      // Comments by people the page is shared with carry their name; the owner's stay unsigned as before.
      authorId: ctx.actor?.id ?? null,
      authorName: ctx.actor?.name ?? null,
      authorImage: ctx.actor?.image ?? null,
      parentId: parent?._id ?? null,
      reactions: {},
      mentions: mentioned,
    };
    const commentId = await ctx.db.insert("comments", row);
    // Mentioned people, then everyone else in the conversation (the thread, or the page's
    // commenters), and the page's owner in a personal workspace.
    const actor = { id: actorOf(ctx) ?? "", name: ctx.actor?.name ?? null };
    const where = page.title || "Untitled";
    await notify(ctx.db, mentioned, { kind: "mention", ownerId: ctx.ownerId, pageId, actor, title: `${actor.name ?? "Someone"} mentioned you on “${where}”`, body: text }, ctx.now);
    const thread = parent ? existing.filter((c) => c._id === parent!._id || c.parentId === parent!._id) : existing;
    const others = new Set(thread.map((c) => c.authorId ?? (isOrgNamespace(ctx.ownerId) ? null : accountOf(ctx.ownerId))).filter((x): x is string => !!x));
    if (!isOrgNamespace(ctx.ownerId)) others.add(accountOf(ctx.ownerId));
    for (const m of mentioned) others.delete(m);
    await notify(ctx.db, others, { kind: "comment", ownerId: ctx.ownerId, pageId, actor, title: `${actor.name ?? "Someone"} ${parent ? "replied" : "commented"} on “${where}”`, body: text, key: `comment:${pageId}:${parent?._id ?? "page"}` }, ctx.now);
    return { comment: { _id: commentId, ...row } };
  },
});

export const commentsUpdate = defineOp({
  name: "comments.update",
  kind: "mutation",
  title: "Edit comment",
  description: "Changes a comment's text.",
  input: z.object({ id, body }),
  async run(ctx, { id: commentId, body: text }) {
    const c = await requireComment(ctx, commentId);
    await ctx.db.patch("comments", c._id, { body: text, updatedAt: ctx.now });
    return { comment: { ...c, body: text, updatedAt: ctx.now } };
  },
});

export const commentsReact = defineOp({
  name: "comments.react",
  kind: "mutation",
  title: "React to a comment",
  description: "Adds your emoji reaction to a comment, or removes it if you already reacted with that emoji.",
  input: z.object({ id, emoji: z.string().min(1).max(16) }),
  async run(ctx, { id: commentId, emoji }) {
    const c = await requireComment(ctx, commentId);
    const me = actorOf(ctx);
    if (!me) throw new MaxError("FORBIDDEN", "Sign in to react.");
    const reactions = { ...(c.reactions ?? {}) };
    const list = reactions[emoji] ?? [];
    reactions[emoji] = list.includes(me) ? list.filter((x) => x !== me) : [...list, me];
    if (!reactions[emoji].length) delete reactions[emoji];
    if (Object.keys(reactions).length > 20) throw new MaxError("LIMIT", "That comment has enough kinds of reactions.");
    await ctx.db.patch("comments", c._id, { reactions });
    return { reactions };
  },
});

export const commentsResolve = defineOp({
  name: "comments.resolve",
  kind: "mutation",
  title: "Resolve or reopen comment",
  description: "Marks a comment as resolved (hidden by default) or reopens it.",
  input: z.object({ id, resolved: z.boolean() }),
  async run(ctx, { id: commentId, resolved }) {
    const c = await requireComment(ctx, commentId);
    await ctx.db.patch("comments", c._id, { resolvedAt: resolved ? ctx.now : null, updatedAt: ctx.now });
    return { resolved };
  },
});

export const commentsDelete = defineOp({
  name: "comments.delete",
  kind: "mutation",
  title: "Delete comment",
  destructive: true,
  description: "Permanently deletes a comment. Resolving keeps it instead.",
  input: z.object({ id, confirm }),
  async run(ctx, { id: commentId }) {
    const c = await requireComment(ctx, commentId);
    await ctx.db.delete("comments", c._id);
    // Deleting a thread's first comment removes its replies with it.
    for (const r of await ctx.db.list("comments", ctx.ownerId, { field: "pageId", value: c.pageId })) if (r.parentId === c._id) await ctx.db.delete("comments", r._id);
    return { deleted: true };
  },
});
