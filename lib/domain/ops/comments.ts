import { z } from "zod";
import { MaxError } from "../errors";
import { findBlock, parseContent, blockText } from "../blocks";
import type { CommentRow } from "../types";
import { confirm, defineOp, id, type OpContext } from "./define";
import { requirePage } from "./helpers";

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
    const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
    const blocks = parseContent(doc?.content ?? "[]");
    const open = rows.filter((c) => !c.resolvedAt).length;
    return {
      openCount: open,
      resolvedCount: rows.length - open,
      comments: rows
        .filter((c) => includeResolved || !c.resolvedAt)
        .map(({ ownerId: _o, ...c }) => {
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
  input: z.object({ pageId: id, blockId: z.string().max(64).nullable().optional(), body }),
  async run(ctx, { pageId, blockId = null, body: text }) {
    await requirePage(ctx, pageId);
    if (blockId) {
      const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
      if (!findBlock(parseContent(doc?.content ?? "[]"), blockId)) throw new MaxError("NOT_FOUND", "That block isn't on this page anymore.");
    }
    const row = { ownerId: ctx.ownerId, pageId, blockId, body: text, resolvedAt: null, createdAt: ctx.now, updatedAt: ctx.now, source: ctx.source };
    const commentId = await ctx.db.insert("comments", row);
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
    return { deleted: true };
  },
});
