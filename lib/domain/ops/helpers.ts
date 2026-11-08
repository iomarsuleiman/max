import { MaxError, notFound } from "../errors";
import { compareRank, rankBetween } from "../rank";
import type { PageRow, SettingsRow, SidebarSectionId } from "../types";
import type { OpContext } from "./define";

export const LIMITS = {
  pagesPerAccount: 20_000,
  titleLength: 500,
  depth: 40,
  propertiesPerDatabase: 60,
  viewsPerDatabase: 30,
  optionsPerProperty: 200,
  searchResults: 50,
  queryPage: 200,
  batchOperations: 50,
  uploadBytes: 20 * 1024 * 1024,
  tokens: 20,
};

export const UPLOAD_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"];

export async function allPages(ctx: OpContext): Promise<PageRow[]> {
  return ctx.db.list("pages", ctx.ownerId);
}

/** Returns an owned page. Another account's id gets the same answer as a missing one. */
export async function requirePage(ctx: OpContext, pageId: string, opts: { allowArchived?: boolean } = {}): Promise<PageRow> {
  const page = await ctx.db.get("pages", pageId);
  if (!page || page.ownerId !== ctx.ownerId) throw notFound();
  if (page.archivedAt && !opts.allowArchived) {
    throw new MaxError("READ_ONLY", "This page is in the trash. Restore it before editing.", { pageId });
  }
  return page;
}

export async function requireDatabase(ctx: OpContext, databaseId: string): Promise<PageRow> {
  const page = await requirePage(ctx, databaseId);
  if (page.kind !== "database") throw new MaxError("VALIDATION", "That page isn't a database.", { databaseId });
  return page;
}

export function assertWritable(page: PageRow) {
  if (page.locked) throw new MaxError("READ_ONLY", "This page is locked. Unlock it from the page menu to edit.", { pageId: page._id });
}

export const byRank = (a: { rank: string }, b: { rank: string }) => compareRank(a.rank, b.rank);

/** Live (not archived) tree children of a parent, sorted. Database records are never tree children. */
export function treeChildren(pages: PageRow[], parentId: string | null): PageRow[] {
  return pages.filter((p) => p.parentId === parentId && !p.databaseId && !p.archivedAt && !p.isTemplate).sort(byRank);
}

export function descendants(pages: PageRow[], rootId: string): PageRow[] {
  const byParent = new Map<string, PageRow[]>();
  for (const p of pages) {
    const parentKey = p.parentId ?? p.databaseId;
    if (!parentKey) continue;
    if (!byParent.has(parentKey)) byParent.set(parentKey, []);
    byParent.get(parentKey)!.push(p);
  }
  const out: PageRow[] = [];
  const stack = [rootId];
  const seen = new Set<string>([rootId]);
  while (stack.length) {
    const next = stack.pop()!;
    for (const child of byParent.get(next) ?? []) {
      if (seen.has(child._id)) continue;
      seen.add(child._id);
      out.push(child);
      stack.push(child._id);
    }
  }
  return out;
}

/** Rank for inserting at `index` among `siblings` (already sorted, excluding the moved page). */
export function rankAt(siblings: { rank: string }[], index: number | undefined): string {
  const i = index === undefined ? siblings.length : Math.max(0, Math.min(siblings.length, index));
  return rankBetween(siblings[i - 1]?.rank ?? null, siblings[i]?.rank ?? null);
}

export function breadcrumbs(pages: PageRow[], page: PageRow): { _id: string; title: string; icon: string | null; kind: string }[] {
  const byId = new Map(pages.map((p) => [p._id, p]));
  const trail: PageRow[] = [];
  let cursor: PageRow | undefined = page;
  let guard = 0;
  while (cursor && guard++ < LIMITS.depth + 2) {
    trail.unshift(cursor);
    const parentKey: string | null = cursor.parentId ?? cursor.databaseId;
    cursor = parentKey ? byId.get(parentKey) : undefined;
  }
  return trail.map((p) => ({ _id: p._id, title: p.title, icon: p.icon, kind: p.kind }));
}

export function depthOf(pages: PageRow[], pageId: string | null): number {
  const byId = new Map(pages.map((p) => [p._id, p]));
  let depth = 0;
  let cursor = pageId ? byId.get(pageId) : undefined;
  while (cursor && depth < 1000) {
    depth++;
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return depth;
}

export function summary(p: PageRow) {
  return {
    _id: p._id,
    kind: p.kind,
    parentId: p.parentId,
    databaseId: p.databaseId,
    title: p.title,
    icon: p.icon,
    cover: p.cover,
    rank: p.rank,
    favoriteRank: p.favoriteRank,
    lastOpenedAt: p.lastOpenedAt,
    updatedAt: p.updatedAt,
    createdAt: p.createdAt,
  };
}
export type PageSummary = ReturnType<typeof summary>;

export const DEFAULT_SIDEBAR: SidebarSectionId[] = ["favorites", "recents", "pages", "databases"];

export function defaultSettings(ownerId: string, now: number): Omit<SettingsRow, "_id"> {
  return {
    ownerId,
    theme: "system",
    font: "default",
    defaultFullWidth: false,
    density: "comfortable",
    startPage: "home",
    textDirection: "auto",
    spellcheck: true,
    showRecents: true,
    reduceMotion: "system",
    sidebarWidth: 248,
    sidebarSections: [...DEFAULT_SIDEBAR],
    collapsedSections: [],
    expandedPageIds: [],
    lastPageId: null,
    displayName: null,
    onboarded: false,
    updatedAt: now,
  };
}

export async function getSettingsRow(ctx: OpContext): Promise<SettingsRow | null> {
  const rows = await ctx.db.list("settings", ctx.ownerId);
  return rows[0] ?? null;
}

export async function upsertSettings(ctx: OpContext, patch: Partial<Omit<SettingsRow, "_id" | "ownerId">>): Promise<SettingsRow> {
  const existing = await getSettingsRow(ctx);
  if (existing) {
    await ctx.db.patch("settings", existing._id, { ...patch, updatedAt: ctx.now });
    return { ...existing, ...patch, updatedAt: ctx.now };
  }
  const row = { ...defaultSettings(ctx.ownerId, ctx.now), ...patch };
  const _id = await ctx.db.insert("settings", row);
  return { _id, ...row };
}

export function cleanTitle(value: string | undefined): string {
  return (value ?? "").replace(/[\r\n\t]+/g, " ").slice(0, LIMITS.titleLength);
}

export function newPageRow(ctx: OpContext, fields: Partial<PageRow> & { rank: string }): Omit<PageRow, "_id"> {
  return {
    ownerId: ctx.ownerId,
    kind: "page",
    parentId: null,
    databaseId: null,
    title: "",
    icon: null,
    cover: null,
    favoriteRank: null,
    archivedAt: null,
    archivedRootId: null,
    lastOpenedAt: null,
    fullWidth: false,
    smallText: false,
    locked: false,
    isTemplate: false,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    ...fields,
  };
}

export async function randomToken(bytes = 24): Promise<string> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const buf = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => alphabet[b % alphabet.length]).join("");
}

export async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
