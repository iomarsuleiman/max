import { z } from "zod";
import { MaxError } from "../errors";
import { rankBetween } from "../rank";
import { DOCUMENT_SCHEMA_VERSION, countWords, documentText, markdownToBlocks, parseContent, referencedPageIds } from "../blocks";
import type { PageRow } from "../types";
import { confirm, defineOp, icon, id, title } from "./define";
import {
  LIMITS,
  allPages,
  assertWritable,
  breadcrumbs,
  byRank,
  cleanTitle,
  depthOf,
  descendants,
  newPageRow,
  rankAt,
  requirePage,
  summary,
  templateMembers,
  treeChildren,
  upsertSettings,
} from "./helpers";
import type { OpContext } from "./define";
import { defaultDatabaseFields } from "./databaseDefaults";

export const pagesTree = defineOp({
  name: "pages.tree",
  kind: "query",
  title: "List page tree",
  description:
    "Lists every live page and database in the sidebar hierarchy (lightweight metadata only, no content). Use parentId to rebuild nesting; siblings sort by rank.",
  input: z.object({}),
  async run(ctx) {
    const pages = await allPages(ctx);
    const hidden = templateMembers(pages);
    const live = pages.filter((p) => !p.archivedAt && !p.databaseId && !hidden.has(p._id));
    return { pages: live.sort(byRank).map(summary) };
  },
});

export const pagesChildren = defineOp({
  name: "pages.children",
  kind: "query",
  title: "List child pages",
  description: "Lists the direct child pages of a page (or root pages when parentId is null), in sidebar order.",
  input: z.object({ parentId: id.nullable() }),
  async run(ctx, { parentId }) {
    if (parentId) await requirePage(ctx, parentId, { allowArchived: true });
    const pages = await allPages(ctx);
    return { pages: treeChildren(pages, parentId).map(summary) };
  },
});

export const pagesGet = defineOp({
  name: "pages.get",
  kind: "query",
  title: "Get page",
  description: "Returns a page's metadata, breadcrumbs, child pages and backlinks. Use documents.get for the content.",
  input: z.object({ id }),
  async run(ctx, { id: pageId }) {
    const page = await requirePage(ctx, pageId, { allowArchived: true });
    const pages = await allPages(ctx);
    const byId = new Map(pages.map((p) => [p._id, p]));
    const archivedRoot = page.archivedRootId ? byId.get(page.archivedRootId) : undefined;
    return {
      page,
      breadcrumbs: breadcrumbs(pages, page),
      children: treeChildren(pages, page._id).map(summary),
      database: page.databaseId ? summary(byId.get(page.databaseId) ?? page) : null,
      inTrash: !!page.archivedAt,
      trashedWith: archivedRoot && archivedRoot._id !== page._id ? summary(archivedRoot) : null,
    };
  },
});

export const pagesBacklinks = defineOp({
  name: "pages.backlinks",
  kind: "query",
  title: "List backlinks",
  description: "Lists live pages whose content links to or mentions this page.",
  input: z.object({ id }),
  async run(ctx, { id: pageId }) {
    await requirePage(ctx, pageId, { allowArchived: true });
    const [pages, docs] = await Promise.all([allPages(ctx), ctx.db.list("documents", ctx.ownerId)]);
    const live = new Map(pages.filter((p) => !p.archivedAt).map((p) => [p._id, p]));
    const out = docs
      .filter((d) => d.pageId !== pageId && live.has(d.pageId) && d.content.includes(pageId))
      .filter((d) => referencedPageIds(parseContent(d.content)).includes(pageId))
      .map((d) => summary(live.get(d.pageId)!));
    return { pages: out };
  },
});

export const pagesRecents = defineOp({
  name: "pages.recents",
  kind: "query",
  title: "List recent pages",
  description: "Pages and records most recently opened, newest first.",
  input: z.object({ limit: z.number().int().min(1).max(50).optional() }),
  async run(ctx, { limit = 10 }) {
    const pages = await allPages(ctx);
    return {
      pages: pages
        .filter((p) => p.lastOpenedAt && !p.archivedAt && !templateMembers(pages).has(p._id))
        .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
        .slice(0, limit)
        .map(summary),
    };
  },
});

export const pagesFavorites = defineOp({
  name: "pages.favorites",
  kind: "query",
  title: "List favorites",
  description: "Favorite pages in their saved order.",
  input: z.object({}),
  async run(ctx) {
    const pages = await allPages(ctx);
    return {
      pages: pages
        .filter((p) => p.favoriteRank && !p.archivedAt)
        .sort((a, b) => (a.favoriteRank! < b.favoriteRank! ? -1 : 1))
        .map(summary),
    };
  },
});

export const pagesCreate = defineOp({
  name: "pages.create",
  kind: "mutation",
  title: "Create page",
  description:
    "Creates a page at the root or inside a parent page. Optional `index` places it among siblings (default: last). Optional `markdown` sets initial content.",
  input: z.object({
    parentId: id.nullable().optional(),
    title: title.optional(),
    icon: icon.optional(),
    index: z.number().int().min(0).optional(),
    markdown: z.string().max(400_000).optional(),
    kind: z.enum(["page", "database"]).optional(),
  }),
  async run(ctx, input) {
    const pages = await allPages(ctx);
    if (pages.length >= LIMITS.pagesPerAccount) {
      throw new MaxError("LIMIT", `You've reached the limit of ${LIMITS.pagesPerAccount.toLocaleString("en")} pages. Empty the trash or delete pages you no longer need.`);
    }
    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await requirePage(ctx, parentId);
      if (parent.kind === "database") throw new MaxError("VALIDATION", "Add rows to a database with records.create instead of nesting pages under it.");
      if (depthOf(pages, parentId) >= LIMITS.depth) throw new MaxError("LIMIT", `Pages can be nested up to ${LIMITS.depth} levels deep.`);
    }
    const siblings = treeChildren(pages, parentId);
    const settings = (await ctx.db.list("settings", ctx.ownerId))[0];
    const row = newPageRow(ctx, {
      parentId,
      kind: input.kind ?? "page",
      title: cleanTitle(input.title),
      icon: input.icon ?? null,
      rank: rankAt(siblings, input.index),
      fullWidth: input.kind === "database" ? true : (settings?.defaultFullWidth ?? false),
      ...(input.kind === "database" ? defaultDatabaseFields() : {}),
    });
    const pageId = await ctx.db.insert("pages", row);
    let blocks: unknown[] = [];
    if (input.markdown) blocks = markdownToBlocks(input.markdown);
    await insertDocument(ctx, pageId, blocks);
    return { page: { _id: pageId, ...row } };
  },
});

export async function insertDocument(ctx: OpContext, pageId: string, blocks: unknown[]) {
  const content = JSON.stringify(blocks);
  const text = documentText(blocks as never);
  await ctx.db.insert("documents", {
    ownerId: ctx.ownerId,
    pageId,
    content,
    text,
    revision: 1,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    wordCount: countWords(text),
    updatedAt: ctx.now,
  });
}

export const pagesUpdate = defineOp({
  name: "pages.update",
  kind: "mutation",
  title: "Update page",
  description: "Renames a page or changes its icon, cover, width, text size or lock. Only the fields you pass change.",
  input: z.object({
    id,
    title: title.optional(),
    icon: icon.optional(),
    cover: z.string().max(2000).nullable().optional(),
    fullWidth: z.boolean().optional(),
    smallText: z.boolean().optional(),
    locked: z.boolean().optional(),
  }),
  async run(ctx, { id: pageId, ...patch }) {
    const page = await requirePage(ctx, pageId);
    if (page.locked && patch.locked !== false && (patch.title !== undefined || patch.icon !== undefined || patch.cover !== undefined)) assertWritable(page);
    if (patch.cover && !/^(https:\/\/|max-asset:\/\/|gradient:\d+$|color:[a-z]+$|cover:[a-z0-9-]+$)/.test(patch.cover)) {
      throw new MaxError("VALIDATION", "Covers must be an https image link, an uploaded image, or a built-in gradient.");
    }
    const clean = Object.fromEntries(Object.entries({ ...patch, title: patch.title === undefined ? undefined : cleanTitle(patch.title) }).filter(([, v]) => v !== undefined));
    await ctx.db.patch("pages", pageId, { ...clean, updatedAt: ctx.now });
    return { page: { ...page, ...clean, updatedAt: ctx.now } };
  },
});

export const pagesMove = defineOp({
  name: "pages.move",
  kind: "mutation",
  title: "Move page",
  description:
    "Moves a page to a new parent (null for the top level) and position. `index` is the position among the new siblings, not counting the page itself. A page can't move inside itself or its own subpages.",
  input: z.object({ id, parentId: id.nullable(), index: z.number().int().min(0).optional() }),
  async run(ctx, { id: pageId, parentId, index }) {
    const page = await requirePage(ctx, pageId);
    if (page.databaseId) throw new MaxError("VALIDATION", "Database rows stay in their database. Reorder them with a view sort instead.");
    const pages = await allPages(ctx);
    if (parentId) {
      if (parentId === pageId || descendants(pages, pageId).some((p) => p._id === parentId)) {
        throw new MaxError("VALIDATION", "A page can't be moved inside itself or one of its subpages.");
      }
      const parent = await requirePage(ctx, parentId);
      if (parent.kind === "database") throw new MaxError("VALIDATION", "Pages can't be nested inside a database.");
      const subtreeDepth = Math.max(0, ...descendants(pages, pageId).map((d) => depthOf(pages, d._id) - depthOf(pages, pageId)));
      if (depthOf(pages, parentId) + 1 + subtreeDepth > LIMITS.depth) throw new MaxError("LIMIT", `Pages can be nested up to ${LIMITS.depth} levels deep.`);
    }
    const siblings = treeChildren(pages, parentId).filter((p) => p._id !== pageId);
    const rank = rankAt(siblings, index);
    await ctx.db.patch("pages", pageId, { parentId, rank, updatedAt: ctx.now });
    return { page: { ...page, parentId, rank } };
  },
});

export const pagesDuplicate = defineOp({
  name: "pages.duplicate",
  kind: "mutation",
  title: "Duplicate page",
  description: "Copies a page with its content, placed right after the original. Subpages (and database rows) are copied too unless includeChildren is false.",
  input: z.object({ id, includeChildren: z.boolean().optional() }),
  async run(ctx, { id: pageId, includeChildren = true }) {
    const page = await requirePage(ctx, pageId);
    const pages = await allPages(ctx);
    const subtree = includeChildren ? descendants(pages, pageId) : [];
    if (pages.length + subtree.length + 1 > LIMITS.pagesPerAccount) throw new MaxError("LIMIT", "Duplicating this would go past your page limit.");
    const idMap = new Map<string, string>();
    const siblings = page.databaseId
      ? pages.filter((p) => p.databaseId === page.databaseId && !p.parentId && !p.archivedAt).sort(byRank)
      : treeChildren(pages, page.parentId);
    const at = siblings.findIndex((p) => p._id === pageId);
    const rank = rankBetween(page.rank, siblings[at + 1]?.rank ?? null);
    const copy = async (source: PageRow, overrides: Partial<PageRow>) => {
      const { _id, ...rest } = source;
      const newId = await ctx.db.insert("pages", {
        ...rest,
        favoriteRank: null,
        lastOpenedAt: null,
        createdAt: ctx.now,
        updatedAt: ctx.now,
        ...overrides,
      });
      idMap.set(_id, newId);
      const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: _id }))[0];
      if (doc) {
        const { _id: _doc, ...docRest } = doc;
        await ctx.db.insert("documents", { ...docRest, pageId: newId, revision: 1, updatedAt: ctx.now });
      }
      return newId;
    };
    const newId = await copy(page, { title: page.title ? `${page.title} (copy)` : "", rank });
    // Parents before children so their new ids exist.
    const ordered = [...subtree].sort((a, b) => depthOf(pages, a._id) - depthOf(pages, b._id));
    for (const child of ordered) {
      await copy(child, {
        parentId: child.parentId ? (idMap.get(child.parentId) ?? null) : null,
        databaseId: child.databaseId ? (idMap.get(child.databaseId) ?? child.databaseId) : null,
      });
    }
    // Relations inside a duplicated database point at the copied rows.
    if (page.kind === "database") {
      for (const [oldId, nid] of idMap) {
        const source = pages.find((p) => p._id === oldId);
        if (!source?.values) continue;
        const values = Object.fromEntries(
          Object.entries(source.values).map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => idMap.get(x) ?? x) : v]),
        );
        await ctx.db.patch("pages", nid, { values });
      }
    }
    return { id: newId, copied: idMap.size };
  },
});

export const pagesTouch = defineOp({
  name: "pages.touch",
  kind: "mutation",
  title: "Mark page as opened",
  description: "Records that a page was opened so it appears in Recents.",
  input: z.object({ id }),
  async run(ctx, { id: pageId }) {
    const page = await requirePage(ctx, pageId, { allowArchived: true });
    if (page.archivedAt) return { ok: true };
    await ctx.db.patch("pages", pageId, { lastOpenedAt: ctx.now });
    if (ctx.source === "ui") await upsertSettings(ctx, { lastPageId: pageId });
    return { ok: true };
  },
});

export const pagesForget = defineOp({
  name: "pages.forgetRecent",
  kind: "mutation",
  title: "Remove from recents",
  description: "Removes a page from Recents without changing the page.",
  input: z.object({ id }),
  async run(ctx, { id: pageId }) {
    await requirePage(ctx, pageId, { allowArchived: true });
    await ctx.db.patch("pages", pageId, { lastOpenedAt: null });
    return { ok: true };
  },
});

export const pagesSetFavorite = defineOp({
  name: "pages.setFavorite",
  kind: "mutation",
  title: "Add or remove favorite",
  description: "Adds a page to Favorites (at the end) or removes it.",
  input: z.object({ id, favorite: z.boolean() }),
  async run(ctx, { id: pageId, favorite }) {
    const page = await requirePage(ctx, pageId);
    if (!favorite) {
      await ctx.db.patch("pages", pageId, { favoriteRank: null });
      return { favorite: false };
    }
    if (page.favoriteRank) return { favorite: true };
    const pages = await allPages(ctx);
    const last = pages.map((p) => p.favoriteRank).filter((r): r is string => !!r).sort().at(-1) ?? null;
    await ctx.db.patch("pages", pageId, { favoriteRank: rankBetween(last, null) });
    return { favorite: true };
  },
});

export const pagesMoveFavorite = defineOp({
  name: "pages.moveFavorite",
  kind: "mutation",
  title: "Reorder favorite",
  description: "Moves a favorite to a new position in the Favorites list.",
  input: z.object({ id, index: z.number().int().min(0) }),
  async run(ctx, { id: pageId, index }) {
    const page = await requirePage(ctx, pageId);
    if (!page.favoriteRank) throw new MaxError("VALIDATION", "Add this page to Favorites first.");
    const pages = await allPages(ctx);
    const favs = pages
      .filter((p) => p.favoriteRank && !p.archivedAt && p._id !== pageId)
      .map((p) => ({ rank: p.favoriteRank! }))
      .sort((a, b) => (a.rank < b.rank ? -1 : 1));
    const favoriteRank = rankAt(favs, index);
    await ctx.db.patch("pages", pageId, { favoriteRank });
    return { favoriteRank };
  },
});

export const pagesArchive = defineOp({
  name: "pages.archive",
  kind: "mutation",
  title: "Move page to trash",
  description:
    "Moves a page, its subpages and (for databases) its rows to the trash. Reversible with pages.restore until the trash is emptied.",
  input: z.object({ id }),
  async run(ctx, { id: pageId }) {
    const page = await requirePage(ctx, pageId);
    const pages = await allPages(ctx);
    const subtree = descendants(pages, pageId).filter((p) => !p.archivedAt);
    for (const p of [page, ...subtree]) {
      await ctx.db.patch("pages", p._id, { archivedAt: ctx.now, archivedRootId: pageId });
    }
    return { archived: subtree.length + 1, id: pageId };
  },
});

export const pagesRestore = defineOp({
  name: "pages.restore",
  kind: "mutation",
  title: "Restore page from trash",
  description:
    "Restores a trashed page and everything trashed with it. If its original parent is gone or still in the trash, it returns to the top level.",
  input: z.object({ id }),
  async run(ctx, { id: pageId }) {
    const page = await requirePage(ctx, pageId, { allowArchived: true });
    if (!page.archivedAt) return { restored: 0, parentId: page.parentId };
    const pages = await allPages(ctx);
    const byId = new Map(pages.map((p) => [p._id, p]));
    const rootId = page.archivedRootId ?? pageId;
    // Restoring a page that was trashed together with its parent restores just that branch.
    const branchRoot = rootId === pageId ? page : page;
    const members = [branchRoot, ...descendants(pages, branchRoot._id)].filter((p) => p.archivedAt && p.archivedRootId === rootId);
    let parentId = branchRoot.parentId;
    const databaseId = branchRoot.databaseId;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parentId && (!parent || parent.archivedAt)) parentId = null;
    if (databaseId) {
      const db = byId.get(databaseId);
      if (!db || db.archivedAt) {
        throw new MaxError("VALIDATION", "This row's database is in the trash. Restore the database first.", { databaseId });
      }
    }
    const siblings = databaseId ? [] : treeChildren(pages, parentId);
    const rank = parentId !== branchRoot.parentId ? rankAt(siblings, undefined) : branchRoot.rank;
    for (const p of members) {
      const patch: Partial<PageRow> = { archivedAt: null, archivedRootId: null };
      if (p._id === branchRoot._id) Object.assign(patch, { parentId, rank, databaseId });
      await ctx.db.patch("pages", p._id, patch);
    }
    return { restored: members.length, parentId };
  },
});

export const trashList = defineOp({
  name: "trash.list",
  kind: "query",
  title: "List trash",
  description: "Pages in the trash (only the pages you trashed directly; their subpages come back with them).",
  input: z.object({ query: z.string().max(200).optional() }),
  async run(ctx, { query }) {
    const pages = await allPages(ctx);
    const q = query?.trim().toLowerCase();
    const roots = pages
      .filter((p) => p.archivedAt && (p.archivedRootId === p._id || !p.archivedRootId))
      .filter((p) => !q || (p.title || "untitled").toLowerCase().includes(q))
      .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
    const byId = new Map(pages.map((p) => [p._id, p]));
    return {
      pages: roots.map((p) => ({
        ...summary(p),
        archivedAt: p.archivedAt,
        contains: pages.filter((x) => x.archivedRootId === p._id && x._id !== p._id).length,
        parentTitle: p.parentId ? (byId.get(p.parentId)?.title ?? null) : p.databaseId ? (byId.get(p.databaseId)?.title ?? null) : null,
      })),
    };
  },
});

async function removePageCompletely(ctx: OpContext, page: PageRow) {
  const docs = await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: page._id });
  for (const d of docs) await ctx.db.delete("documents", d._id);
  for (const v of await ctx.db.list("versions", ctx.ownerId, { field: "pageId", value: page._id })) await ctx.db.delete("versions", v._id);
  const assets = await ctx.db.list("assets", ctx.ownerId, { field: "pageId", value: page._id });
  for (const a of assets) {
    await ctx.storage?.remove(a.storageId).catch(() => undefined);
    await ctx.db.delete("assets", a._id);
  }
  await ctx.db.delete("pages", page._id);
}

export const pagesDeletePermanently = defineOp({
  name: "pages.deletePermanently",
  kind: "mutation",
  title: "Delete page permanently",
  destructive: true,
  description: "Permanently deletes a page that is already in the trash, with everything trashed with it and its uploaded files. This cannot be undone.",
  input: z.object({ id, confirm }),
  async run(ctx, { id: pageId }) {
    const page = await requirePage(ctx, pageId, { allowArchived: true });
    if (!page.archivedAt) throw new MaxError("VALIDATION", "Move the page to the trash first; only trashed pages can be deleted permanently.");
    const pages = await allPages(ctx);
    const members = [page, ...descendants(pages, pageId)];
    for (const p of members) await removePageCompletely(ctx, p);
    return { deleted: members.length };
  },
});

export const trashEmpty = defineOp({
  name: "trash.empty",
  kind: "mutation",
  title: "Empty trash",
  destructive: true,
  description: "Permanently deletes every page in the trash and its uploaded files. This cannot be undone.",
  input: z.object({ confirm }),
  async run(ctx) {
    const pages = await allPages(ctx);
    const trashed = pages.filter((p) => p.archivedAt);
    for (const p of trashed) await removePageCompletely(ctx, p);
    return { deleted: trashed.length };
  },
});

export { removePageCompletely };
