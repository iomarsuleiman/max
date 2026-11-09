import { z } from "zod";
import { MaxError } from "../errors";
import {
  MAX_CONTENT_BYTES,
  blocksToMarkdown,
  cellInlines,
  countWords,
  documentText,
  findBlock,
  markdownToBlocks,
  normalizeBlocks,
  parseContent,
  type Block,
  type Inline,
  type TableContent,
} from "../blocks";
import type { DocumentRow } from "../types";
import { defineOp, id, type OpContext } from "./define";
import { allPages, assertWritable, breadcrumbs, descendants, LIMITS, requirePage, summary, templateMembers } from "./helpers";
import { insertDocument } from "./pages";
import { snapshotBeforeWrite } from "./versions";

async function loadDocument(ctx: OpContext, pageId: string): Promise<DocumentRow> {
  const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
  if (doc) return doc;
  // Pages always get a document on creation; recover gracefully if one is missing.
  await insertDocument(ctx, pageId, []);
  return (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
}

/** Validates and writes new content, bumping the revision. Enforces optimistic concurrency. */
async function writeContent(ctx: OpContext, pageId: string, blocks: Block[], baseRevision?: number) {
  const page = await requirePage(ctx, pageId);
  assertWritable(page);
  const doc = await loadDocument(ctx, pageId);
  if (baseRevision !== undefined && baseRevision !== doc.revision) {
    throw new MaxError("CONFLICT", "This page changed somewhere else since you loaded it. Reload the latest version, then apply your change again.", {
      pageId,
      currentRevision: doc.revision,
      baseRevision,
    });
  }
  const content = JSON.stringify(blocks);
  if (content.length > MAX_CONTENT_BYTES) {
    throw new MaxError("LIMIT", "This page is too large to save (about 900 KB of content). Split it into subpages.", { bytes: content.length });
  }
  if (content === doc.content) return { revision: doc.revision, updatedAt: doc.updatedAt, unchanged: true };
  await snapshotBeforeWrite(ctx, page, doc);
  const text = documentText(blocks);
  const revision = doc.revision + 1;
  await ctx.db.patch("documents", doc._id, { content, text, wordCount: countWords(text), revision, updatedAt: ctx.now });
  await ctx.db.patch("pages", pageId, { updatedAt: ctx.now });
  return { revision, updatedAt: ctx.now, unchanged: false };
}

const blockInput = z.record(z.string(), z.unknown()).describe("A block: { type, props?, content?, children? }. content may be a string, or inline items.");
const placement = z.enum(["before", "after", "firstChild", "lastChild", "start", "end"]);
const baseRevision = z.number().int().min(0).optional().describe("Revision you read. If the page changed since, the write fails with CONFLICT instead of overwriting.");

export const documentsGet = defineOp({
  name: "documents.get",
  kind: "query",
  title: "Get page content",
  description: "Returns a page's full content as blocks (with stable block ids), its revision, and optionally Markdown.",
  input: z.object({ pageId: id, format: z.enum(["blocks", "markdown", "both"]).optional() }),
  async run(ctx, { pageId, format = "blocks" }) {
    const page = await requirePage(ctx, pageId, { allowArchived: true });
    const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
    const blocks = parseContent(doc?.content ?? "[]");
    const result: Record<string, unknown> = {
      pageId,
      title: page.title,
      revision: doc?.revision ?? 0,
      updatedAt: doc?.updatedAt ?? page.updatedAt,
      wordCount: doc?.wordCount ?? 0,
      readOnly: !!page.archivedAt || page.locked,
    };
    if (format !== "markdown") result.blocks = blocks;
    if (format !== "blocks") {
      const pages = await allPages(ctx);
      const titles = new Map(pages.map((p) => [p._id, p.title || "Untitled"]));
      result.markdown = blocksToMarkdown(blocks, (pid) => titles.get(pid));
    }
    return result;
  },
});

export const documentsSave = defineOp({
  name: "documents.save",
  kind: "mutation",
  title: "Save page content",
  description:
    "Replaces a page's entire content with the given blocks. Pass baseRevision from documents.get to avoid overwriting newer changes; force skips that check.",
  input: z.object({
    pageId: id,
    blocks: z.array(blockInput).max(20_000),
    baseRevision,
    force: z.boolean().optional(),
  }),
  async run(ctx, { pageId, blocks, baseRevision: base, force }) {
    const normalized = normalizeBlocks(blocks);
    return writeContent(ctx, pageId, normalized, force ? undefined : base);
  },
});

export const documentsWriteMarkdown = defineOp({
  name: "documents.writeMarkdown",
  kind: "mutation",
  title: "Write page content as Markdown",
  description: "Replaces a page's content with Markdown, or appends Markdown to the end. Supports headings, lists, to-dos, quotes, callouts (> [!TIP]), code, math ($$), tables, images, dividers and links.",
  input: z.object({ pageId: id, markdown: z.string().max(400_000), mode: z.enum(["replace", "append"]).optional(), baseRevision }),
  async run(ctx, { pageId, markdown, mode = "replace", baseRevision: base }) {
    const incoming = markdownToBlocks(markdown);
    if (mode === "replace") return writeContent(ctx, pageId, incoming, base);
    const doc = await loadDocument(ctx, pageId);
    return writeContent(ctx, pageId, [...parseContent(doc.content), ...incoming], base);
  },
});

/** Loads blocks, applies `edit`, saves. Every block operation goes through here. */
async function editBlocks(ctx: OpContext, pageId: string, base: number | undefined, edit: (blocks: Block[]) => unknown) {
  const doc = await loadDocument(ctx, pageId);
  const blocks = parseContent(doc.content);
  const result = edit(blocks);
  const saved = await writeContent(ctx, pageId, blocks, base ?? doc.revision);
  return { ...saved, result };
}

function requireBlock(blocks: Block[], blockId: string) {
  const hit = findBlock(blocks, blockId);
  if (!hit) throw new MaxError("NOT_FOUND", `No block with id "${blockId}" on this page. Read the page again to get current block ids.`, { blockId });
  return hit;
}

function place(blocks: Block[], items: Block[], where: z.infer<typeof placement>, targetId?: string) {
  if (where === "start") return void blocks.unshift(...items);
  if (where === "end" || !targetId) return void blocks.push(...items);
  const target = requireBlock(blocks, targetId);
  if (where === "before") target.siblings.splice(target.index, 0, ...items);
  else if (where === "after") target.siblings.splice(target.index + 1, 0, ...items);
  else if (where === "firstChild") target.block.children.unshift(...items);
  else target.block.children.push(...items);
}

export const blocksGet = defineOp({
  name: "blocks.get",
  kind: "query",
  title: "Get block",
  description: "Returns one block (with children) by its id, plus its parent block id.",
  input: z.object({ pageId: id, blockId: z.string().min(1) }),
  async run(ctx, { pageId, blockId }) {
    await requirePage(ctx, pageId, { allowArchived: true });
    const doc = await loadDocument(ctx, pageId);
    const hit = requireBlock(parseContent(doc.content), blockId);
    return { block: hit.block, parentBlockId: hit.parent?.id ?? null, index: hit.index, revision: doc.revision };
  },
});

export const blocksInsert = defineOp({
  name: "blocks.insert",
  kind: "mutation",
  title: "Insert blocks",
  description:
    "Inserts blocks (or Markdown) before/after a block, as its first/last child, or at the start/end of the page. Returns the new block ids.",
  input: z.object({
    pageId: id,
    blocks: z.array(blockInput).max(2000).optional(),
    markdown: z.string().max(200_000).optional(),
    placement: placement.optional(),
    targetBlockId: z.string().optional(),
    baseRevision,
  }),
  async run(ctx, input) {
    if (!input.blocks?.length && !input.markdown) throw new MaxError("VALIDATION", "Pass blocks or markdown to insert.");
    return editBlocks(ctx, input.pageId, input.baseRevision, (blocks) => {
      const existing = new Set<string>();
      const collect = (list: Block[]) => list.forEach((b) => (existing.add(b.id), collect(b.children)));
      collect(blocks);
      const items = input.blocks?.length ? normalizeBlocks(input.blocks, existing) : normalizeBlocks(markdownToBlocks(input.markdown!), existing);
      place(blocks, items, input.placement ?? (input.targetBlockId ? "after" : "end"), input.targetBlockId);
      return { blockIds: items.map((b) => b.id) };
    });
  },
});

export const blocksUpdate = defineOp({
  name: "blocks.update",
  kind: "mutation",
  title: "Update block",
  description:
    "Changes a block's type (e.g. paragraph → heading), props (e.g. { level: 2 }, { checked: true }) and/or content (string or inline items with styles). Children are kept.",
  input: z.object({
    pageId: id,
    blockId: z.string().min(1),
    type: z.string().optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    content: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]).optional(),
    baseRevision,
  }),
  async run(ctx, input) {
    return editBlocks(ctx, input.pageId, input.baseRevision, (blocks) => {
      const { block } = requireBlock(blocks, input.blockId);
      if (input.type) block.type = input.type;
      if (input.props) block.props = { ...block.props, ...input.props };
      if (input.content !== undefined) {
        block.content = typeof input.content === "string" ? [{ type: "text", text: input.content, styles: {} }] : (input.content as Inline[]);
      }
      const [normalized] = normalizeBlocks([block], new Set());
      Object.assign(block, { props: normalized.props, content: normalized.content });
      return { blockId: block.id };
    });
  },
});

export const blocksDelete = defineOp({
  name: "blocks.delete",
  kind: "mutation",
  title: "Delete blocks",
  description: "Removes blocks (and their children) from a page. Page history isn't kept, so read the block first if you may need it.",
  input: z.object({ pageId: id, blockIds: z.array(z.string()).min(1).max(1000), baseRevision }),
  async run(ctx, { pageId, blockIds, baseRevision: base }) {
    return editBlocks(ctx, pageId, base, (blocks) => {
      for (const blockId of blockIds) {
        const hit = requireBlock(blocks, blockId);
        hit.siblings.splice(hit.index, 1);
      }
      return { deleted: blockIds.length };
    });
  },
});

export const blocksMove = defineOp({
  name: "blocks.move",
  kind: "mutation",
  title: "Move blocks",
  description: "Moves blocks (keeping ids and children) before/after another block or into it as first/last child.",
  input: z.object({
    pageId: id,
    blockIds: z.array(z.string()).min(1).max(1000),
    targetBlockId: z.string().optional(),
    placement,
    baseRevision,
  }),
  async run(ctx, { pageId, blockIds, targetBlockId, placement: where, baseRevision: base }) {
    return editBlocks(ctx, pageId, base, (blocks) => {
      if (targetBlockId) {
        for (const blockId of blockIds) {
          const moving = requireBlock(blocks, blockId).block;
          if (blockId === targetBlockId || findBlock(moving.children, targetBlockId)) {
            throw new MaxError("VALIDATION", "A block can't be moved inside itself.");
          }
        }
      }
      const moved = blockIds.map((bid) => {
        const hit = requireBlock(blocks, bid);
        hit.siblings.splice(hit.index, 1);
        return hit.block;
      });
      place(blocks, moved, where, targetBlockId);
      return { moved: moved.length };
    });
  },
});

export const blocksDuplicate = defineOp({
  name: "blocks.duplicate",
  kind: "mutation",
  title: "Duplicate block",
  description: "Copies a block (with children) right after itself, with new ids.",
  input: z.object({ pageId: id, blockId: z.string(), baseRevision }),
  async run(ctx, { pageId, blockId, baseRevision: base }) {
    return editBlocks(ctx, pageId, base, (blocks) => {
      const hit = requireBlock(blocks, blockId);
      const strip = (b: Block): Record<string, unknown> => ({ ...b, id: undefined, children: b.children.map(strip) });
      const existing = new Set<string>();
      const collect = (list: Block[]) => list.forEach((b) => (existing.add(b.id), collect(b.children)));
      collect(blocks);
      const [copy] = normalizeBlocks([strip(hit.block)], existing);
      hit.siblings.splice(hit.index + 1, 0, copy);
      return { blockId: copy.id };
    });
  },
});

export const blocksFormatText = defineOp({
  name: "blocks.formatText",
  kind: "mutation",
  title: "Format text in a block",
  description:
    "Applies inline styles (bold, italic, underline, strike, code, textColor, backgroundColor) or a link to every occurrence of `text` inside a block. Pass a style as false to remove it.",
  input: z.object({
    pageId: id,
    blockId: z.string(),
    text: z.string().min(1).max(2000),
    styles: z.record(z.string(), z.union([z.boolean(), z.string()])).optional(),
    href: z.string().url().optional(),
    baseRevision,
  }),
  async run(ctx, { pageId, blockId, text, styles = {}, href, baseRevision: base }) {
    if (href && !/^(https?:|mailto:|\/p\/)/.test(href)) throw new MaxError("VALIDATION", "Links must be http(s), mailto, or /p/<pageId>.");
    return editBlocks(ctx, pageId, base, (blocks) => {
      const { block } = requireBlock(blocks, blockId);
      if (!Array.isArray(block.content)) throw new MaxError("VALIDATION", "That block has no text to format.");
      let matches = 0;
      const out: Inline[] = [];
      for (const item of block.content) {
        if (item.type !== "text") {
          out.push(item);
          continue;
        }
        const t = item as { type: "text"; text: string; styles?: Record<string, boolean | string> };
        const parts = t.text.split(text);
        parts.forEach((part, i) => {
          if (part) out.push({ type: "text", text: part, styles: { ...t.styles } });
          if (i < parts.length - 1) {
            matches++;
            const merged = Object.fromEntries(Object.entries({ ...t.styles, ...styles }).filter(([, v]) => v !== false));
            const styled = { type: "text" as const, text, styles: merged };
            out.push(href ? { type: "link", href, content: [styled] } : styled);
          }
        });
      }
      if (!matches) throw new MaxError("NOT_FOUND", `"${text}" isn't in that block (formatting applies within one text run).`);
      block.content = out;
      return { matches };
    });
  },
});

export const tablesEdit = defineOp({
  name: "tables.edit",
  kind: "mutation",
  title: "Edit table",
  description: "Edits a table block: set a cell's text, or insert/delete a row or column at an index (0-based).",
  input: z.object({
    pageId: id,
    blockId: z.string(),
    action: z.enum(["set_cell", "insert_row", "delete_row", "insert_column", "delete_column"]),
    row: z.number().int().min(0).optional(),
    column: z.number().int().min(0).optional(),
    value: z.string().max(10_000).optional(),
    baseRevision,
  }),
  async run(ctx, { pageId, blockId, action, row = 0, column = 0, value = "", baseRevision: base }) {
    return editBlocks(ctx, pageId, base, (blocks) => {
      const { block } = requireBlock(blocks, blockId);
      const table = block.content as TableContent | undefined;
      if (block.type !== "table" || !table || table.type !== "tableContent") throw new MaxError("VALIDATION", "That block isn't a table.");
      const width = table.rows[0]?.cells.length ?? 0;
      const cell = (text: string) => ({ type: "tableCell" as const, content: text ? [{ type: "text", text, styles: {} }] : [], props: {} });
      const rangeError = () => new MaxError("VALIDATION", `That table has ${table.rows.length} rows and ${width} columns.`);
      switch (action) {
        case "set_cell": {
          const r = table.rows[row];
          if (!r || column >= r.cells.length) throw rangeError();
          const prev = r.cells[column];
          r.cells[column] = Array.isArray(prev) ? ([{ type: "text", text: value, styles: {} }] as Inline[]) : { ...cell(value), props: prev?.props ?? {} };
          break;
        }
        case "insert_row":
          if (row > table.rows.length) throw rangeError();
          table.rows.splice(row, 0, { cells: Array.from({ length: Math.max(1, width) }, () => cell("")) });
          break;
        case "delete_row":
          if (row >= table.rows.length || table.rows.length === 1) throw rangeError();
          table.rows.splice(row, 1);
          break;
        case "insert_column":
          if (column > width) throw rangeError();
          table.rows.forEach((r) => r.cells.splice(column, 0, cell("")));
          table.columnWidths?.splice(column, 0, null);
          break;
        case "delete_column":
          if (column >= width || width === 1) throw rangeError();
          table.rows.forEach((r) => r.cells.splice(column, 1));
          table.columnWidths?.splice(column, 1);
          break;
      }
      return { rows: table.rows.length, columns: table.rows[0]?.cells.length ?? 0, cellText: action === "set_cell" ? value : undefined, preview: table.rows.slice(0, 3).map((r) => r.cells.map((c) => cellInlines(c).length)) };
    });
  },
});

/* ── Search ──────────────────────────────────────────────────────────────── */

function snippet(text: string, q: string): string | null {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return null;
  const start = Math.max(0, i - 60);
  const end = Math.min(text.length, i + q.length + 90);
  return (start ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

export const searchQuery = defineOp({
  name: "search.query",
  kind: "query",
  title: "Search",
  description:
    "Searches page titles and content. Filters: kind (page, database, record), titleOnly, inside (a page id whose subpages to search). Results are ranked title-first and include a text snippet and breadcrumbs.",
  input: z.object({
    query: z.string().max(200),
    kind: z.enum(["all", "page", "database", "record"]).optional(),
    titleOnly: z.boolean().optional(),
    inside: id.optional(),
    limit: z.number().int().min(1).max(LIMITS.searchResults).optional(),
  }),
  async run(ctx, { query, kind = "all", titleOnly, inside, limit = 20 }) {
    const q = query.trim().toLowerCase();
    if (!q) return { results: [], total: 0 };
    const everything = await allPages(ctx);
    const hidden = templateMembers(everything);
    const pages = everything.filter((p) => !p.archivedAt && !hidden.has(p._id));
    const docs = titleOnly ? [] : await ctx.db.list("documents", ctx.ownerId);
    const textByPage = new Map(docs.map((d) => [d.pageId, d.text]));
    let scope: Set<string> | null = null;
    if (inside) {
      scope = new Set(descendants(pages, inside).map((p) => p._id));
    }
    const scored: { score: number; page: (typeof pages)[number]; snippet: string | null }[] = [];
    for (const page of pages) {
      if (scope && !scope.has(page._id)) continue;
      const pageKind = page.databaseId ? "record" : page.kind;
      if (kind !== "all" && kind !== pageKind) continue;
      const t = (page.title || "Untitled").toLowerCase();
      let score = t === q ? 0 : t.startsWith(q) ? 1 : t.split(/\s+/).some((w) => w.startsWith(q)) ? 2 : t.includes(q) ? 3 : -1;
      let snip: string | null = null;
      if (!titleOnly) {
        const body = textByPage.get(page._id) ?? "";
        snip = snippet(body, q);
        if (score < 0 && snip) score = 4;
        if (!snip && page.values) {
          const valueText = Object.values(page.values).flat().filter((v) => typeof v === "string").join(" ");
          snip = snippet(valueText, q);
          if (score < 0 && snip) score = 5;
        }
      }
      if (score >= 0) scored.push({ score, page, snippet: snip });
    }
    scored.sort((a, b) => a.score - b.score || (b.page.lastOpenedAt ?? b.page.updatedAt) - (a.page.lastOpenedAt ?? a.page.updatedAt));
    return {
      total: scored.length,
      results: scored.slice(0, limit).map((s) => ({
        ...summary(s.page),
        matchedIn: s.score <= 3 ? "title" : "content",
        snippet: s.snippet,
        breadcrumbs: breadcrumbs(pages, s.page).slice(0, -1).map((b) => b.title || "Untitled"),
      })),
    };
  },
});
