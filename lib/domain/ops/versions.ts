import { z } from "zod";
import { MaxError } from "../errors";
import { blocksToMarkdown, countWords, documentText, parseContent } from "../blocks";
import type { DocumentRow, PageRow, VersionRow } from "../types";
import { defineOp, id, type OpContext } from "./define";
import { allPages, requirePage } from "./helpers";

/**
 * Page history. Before content is replaced, the previous state is kept as a version when:
 *  - the last version of that page is at least 10 minutes old (so autosaves don't flood history),
 *  - the change comes from an assistant (every assistant edit can be undone), or
 *  - a version is being restored (the state you're leaving is always kept).
 * Up to 100 versions are kept per page; the oldest are removed first.
 */
export const VERSION_INTERVAL_MS = 10 * 60_000;
export const MAX_VERSIONS_PER_PAGE = 100;

export async function pageVersions(ctx: OpContext, pageId: string): Promise<VersionRow[]> {
  return (await ctx.db.list("versions", ctx.ownerId, { field: "pageId", value: pageId })).sort((a, b) => b.at - a.at || b.revision - a.revision);
}

/** Keeps `doc` (the state about to be replaced) in history when the policy says so. */
export async function snapshotBeforeWrite(ctx: OpContext, page: PageRow, doc: DocumentRow, reason?: VersionRow["reason"]) {
  if (!doc.content || doc.content === "[]") return;
  const versions = await pageVersions(ctx, page._id);
  const latest = versions[0];
  if (latest?.revision === doc.revision) return;
  const due = !latest || ctx.now - latest.at >= VERSION_INTERVAL_MS;
  const why: VersionRow["reason"] | null = reason ?? (ctx.source === "mcp" ? "assistant" : due ? "edit" : null);
  if (!why) return;
  await ctx.db.insert("versions", {
    ownerId: ctx.ownerId,
    pageId: page._id,
    revision: doc.revision,
    title: page.title,
    content: doc.content,
    wordCount: doc.wordCount ?? 0,
    at: doc.updatedAt,
    source: ctx.source,
    reason: why,
  });
  for (const old of versions.slice(MAX_VERSIONS_PER_PAGE - 1)) await ctx.db.delete("versions", old._id);
}

async function requireVersion(ctx: OpContext, versionId: string): Promise<VersionRow> {
  const v = await ctx.db.get("versions", versionId);
  if (!v || v.ownerId !== ctx.ownerId) throw new MaxError("NOT_FOUND", "That version doesn't exist anymore. Versions are kept for the last 100 changes of each page.");
  return v;
}

export const versionsList = defineOp({
  name: "versions.list",
  kind: "query",
  title: "List page history",
  description: "Earlier versions of a page's content, newest first (time, revision, title, word count and whether an assistant made the change). The current content isn't included.",
  input: z.object({ pageId: id }),
  async run(ctx, { pageId }) {
    const page = await requirePage(ctx, pageId, { allowArchived: true });
    const versions = await pageVersions(ctx, pageId);
    const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
    return {
      current: { revision: doc?.revision ?? 0, at: doc?.updatedAt ?? page.updatedAt, title: page.title, wordCount: doc?.wordCount ?? 0 },
      versions: versions.map(({ content: _c, ownerId: _o, ...v }) => v),
    };
  },
});

export const versionsGet = defineOp({
  name: "versions.get",
  kind: "query",
  title: "Get a page version",
  description: "Returns one earlier version's content as blocks and/or Markdown, to compare with the current page.",
  input: z.object({ id, format: z.enum(["blocks", "markdown", "both"]).optional() }),
  async run(ctx, { id: versionId, format = "blocks" }) {
    const v = await requireVersion(ctx, versionId);
    await requirePage(ctx, v.pageId, { allowArchived: true });
    const blocks = parseContent(v.content);
    const { content: _c, ownerId: _o, ...meta } = v;
    const out: Record<string, unknown> = { version: meta };
    if (format !== "markdown") out.blocks = blocks;
    if (format !== "blocks") {
      const titles = new Map((await allPages(ctx)).map((p) => [p._id, p.title || "Untitled"]));
      out.markdown = blocksToMarkdown(blocks, (pid) => titles.get(pid));
    }
    return out;
  },
});

export const versionsCreate = defineOp({
  name: "versions.create",
  kind: "mutation",
  title: "Save a version now",
  description: "Keeps the page's current content in its history right away (for example before a big rewrite).",
  input: z.object({ pageId: id }),
  async run(ctx, { pageId }) {
    const page = await requirePage(ctx, pageId, { allowArchived: true });
    const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
    if (!doc || doc.content === "[]") throw new MaxError("VALIDATION", "This page is empty, so there's nothing to save yet.");
    const latest = (await pageVersions(ctx, pageId))[0];
    if (latest?.revision === doc.revision) return { saved: false, versionId: latest._id };
    await snapshotBeforeWrite(ctx, page, doc, "manual");
    return { saved: true, versionId: (await pageVersions(ctx, pageId))[0]._id };
  },
});

export const versionsRestore = defineOp({
  name: "versions.restore",
  kind: "mutation",
  title: "Restore a page version",
  description:
    "Replaces the page's content with an earlier version. The current content is kept in history first, so a restore can itself be undone. Optionally restores the title too.",
  input: z.object({ id, restoreTitle: z.boolean().optional() }),
  async run(ctx, { id: versionId, restoreTitle = false }) {
    const v = await requireVersion(ctx, versionId);
    const page = await requirePage(ctx, v.pageId);
    if (page.locked) throw new MaxError("READ_ONLY", "This page is locked. Unlock it from the page menu to restore a version.");
    const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: v.pageId }))[0];
    if (!doc) throw new MaxError("NOT_FOUND", "This page has no content to replace.");
    await snapshotBeforeWrite(ctx, page, doc, "before-restore");
    const revision = doc.revision + 1;
    const blocks = parseContent(v.content);
    const text = documentText(blocks);
    await ctx.db.patch("documents", doc._id, { content: v.content, text, wordCount: countWords(text), revision, updatedAt: ctx.now });
    await ctx.db.patch("pages", page._id, { updatedAt: ctx.now, ...(restoreTitle ? { title: v.title } : {}) });
    return { pageId: page._id, revision, restoredFrom: v.revision };
  },
});
