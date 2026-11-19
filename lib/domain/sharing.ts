/**
 * Page sharing, like Notion: a page can be shared with people (by account) at one of four levels,
 * and the share covers the page and everything inside it. "Anyone with the link" gives signed-in
 * people holding the link a level too.
 *
 * Someone a page is shared with reaches it through `executeShared`, which:
 *  1. resolves their level on the page from shares and links (the highest one wins),
 *  2. checks the operation is allowed at that level and that every page it touches is inside the share,
 *  3. runs the ordinary operation as the page's owner, recording who acted.
 * So the editor, comments, history and databases behave the same for everyone, with one code path.
 */
import { MaxError, notFound } from "./errors";
import type { Db, Storage } from "./db";
import { execute } from "./ops";
import type { PageRow, ShareLevel, Source } from "./types";
import { LIMITS, depthOf, descendants } from "./ops/helpers";
import { compareRank, rankBetween } from "./rank";

export const LEVELS: ShareLevel[] = ["view", "comment", "edit", "full_access"];
const rank = (level: ShareLevel | "owner" | null) => (level === "owner" ? 99 : level ? LEVELS.indexOf(level) : -1);
export const atLeast = (level: ShareLevel | "owner" | null, min: ShareLevel) => rank(level) >= rank(min);
const best = (a: ShareLevel | null, b: ShareLevel | null): ShareLevel | null => (rank(a) >= rank(b) ? a : b);

export const LEVEL_LABEL: Record<ShareLevel, string> = { full_access: "Full access", edit: "Can edit", comment: "Can comment", view: "Can view" };

export interface Actor {
  id: string;
  name: string;
  image: string | null;
}

export interface Access {
  level: ShareLevel | "owner" | null;
  ownerId: string;
  page: PageRow;
  /** The highest page in the chain that grants access (where the breadcrumb starts). */
  rootId: string | null;
}

/** The page and its ancestors, nearest first (pages, database rows and databases alike). */
async function chain(db: Db, page: PageRow): Promise<PageRow[]> {
  const out = [page];
  let cur: PageRow | null = page;
  for (let guard = 0; cur && guard < 60; guard++) {
    const up: string | null = cur.parentId ?? cur.databaseId;
    if (!up) break;
    const next: PageRow | null = await db.get("pages", up);
    if (!next || next.ownerId !== page.ownerId) break;
    out.push(next);
    cur = next;
  }
  return out;
}

/** What `callerId` may do on `pageId`. Trashed pages aren't reachable through shares. */
/** Visitors without an account (pages published to the web) act as this id. */
export const ANONYMOUS = "anon";

export async function resolveAccess(db: Db, callerId: string, pageId: string, linkToken?: string | null): Promise<Access> {
  const page = await db.get("pages", pageId);
  if (!page) throw notFound();
  const anonymous = callerId === ANONYMOUS;
  if (!anonymous && page.ownerId === callerId) return { level: "owner", ownerId: page.ownerId, page, rootId: null };
  if (page.archivedAt) throw notFound();
  const ancestors = await chain(db, page);
  const ids = new Set(ancestors.map((p) => p._id));
  let level: ShareLevel | null = null;
  let rootId: string | null = null;
  const depth = (id: string) => ancestors.findIndex((p) => p._id === id);
  const consider = (lvl: ShareLevel, at: string) => {
    level = best(level, lvl);
    if (rootId === null || depth(at) > depth(rootId)) rootId = at;
  };
  if (!anonymous) {
    for (const share of await db.findBy("shares", "granteeId", callerId)) {
      if (share.ownerId === page.ownerId && ids.has(share.pageId)) consider(share.level, share.pageId);
    }
  }
  if (!anonymous) {
    // "Anyone in Max with the link": the page's own address is the link, like Notion. Anyone signed
    // in who opens it gets the link's level, with or without the token in the URL (sign-in
    // redirects and copied addresses often drop it).
    for (const p of ancestors) {
      for (const link of await db.findBy("shareLinks", "pageId", p._id)) {
        if (link.ownerId === page.ownerId) consider(link.public ? "view" : link.level, link.pageId);
      }
    }
  }
  if (linkToken) {
    for (const link of await db.findBy("shareLinks", "token", linkToken)) {
      // Visitors without an account only get in through links published to the web, and only to view.
      if (anonymous && !link.public) continue;
      if (link.ownerId === page.ownerId && ids.has(link.pageId)) consider(anonymous ? "view" : link.level, link.pageId);
    }
  }
  if (!level) throw notFound();
  return { level, ownerId: page.ownerId, page, rootId };
}

type Targets = (args: Record<string, unknown>, db: Db) => Promise<(string | null | undefined)[]>;
const arg = (name: string): Targets => async (args) => [args[name] as string];
const viaRow = (table: "versions" | "comments" | "assets", key = "id"): Targets => async (args, db) => {
  const row = await db.get(table, String(args[key] ?? ""));
  return [row?.pageId ?? "\0missing"];
};

/**
 * Every operation a shared page may use, the level it needs, and the pages it touches.
 * Anything not listed is refused (account settings, trash, tokens, search across the workspace…).
 */
const POLICY: Record<string, { min: ShareLevel; targets: Targets }> = {
  "pages.get": { min: "view", targets: arg("id") },
  "pages.children": { min: "view", targets: arg("parentId") },
  "pages.backlinks": { min: "view", targets: arg("id") },
  "pages.touch": { min: "view", targets: arg("id") },
  "documents.get": { min: "view", targets: arg("pageId") },
  "databases.get": { min: "view", targets: arg("databaseId") },
  "databases.query": { min: "view", targets: arg("databaseId") },
  "comments.list": { min: "view", targets: arg("pageId") },
  "versions.list": { min: "view", targets: arg("pageId") },
  "versions.get": { min: "view", targets: viaRow("versions") },
  "assets.getUrl": { min: "view", targets: viaRow("assets") },
  "export.page": { min: "view", targets: arg("id") },
  "comments.add": { min: "comment", targets: arg("pageId") },
  "comments.resolve": { min: "comment", targets: viaRow("comments") },
  "comments.update": { min: "comment", targets: viaRow("comments") },
  "comments.delete": { min: "comment", targets: viaRow("comments") },
  "documents.save": { min: "edit", targets: arg("pageId") },
  "pages.update": { min: "edit", targets: arg("id") },
  "pages.create": { min: "edit", targets: arg("parentId") },
  "versions.create": { min: "edit", targets: arg("pageId") },
  "versions.restore": { min: "edit", targets: viaRow("versions") },
  "records.create": { min: "edit", targets: arg("databaseId") },
  "records.update": { min: "edit", targets: arg("id") },
  "records.move": { min: "edit", targets: arg("id") },
  "records.delete": { min: "edit", targets: async (args) => (Array.isArray(args.ids) ? (args.ids as string[]) : ["\0missing"]) },
  "views.create": { min: "edit", targets: arg("databaseId") },
  "views.update": { min: "edit", targets: arg("databaseId") },
  "views.delete": { min: "edit", targets: arg("databaseId") },
  "properties.add": { min: "edit", targets: arg("databaseId") },
  "properties.update": { min: "edit", targets: arg("databaseId") },
  "properties.delete": { min: "edit", targets: arg("databaseId") },
  "assets.createUploadUrl": { min: "edit", targets: async () => [] },
  "assets.register": { min: "edit", targets: arg("pageId") },
  "shares.list": { min: "full_access", targets: arg("pageId") },
  "shares.invite": { min: "full_access", targets: arg("pageId") },
  "shares.update": { min: "full_access", targets: async (args, db) => [(await db.get("shares", String(args.id ?? "")))?.pageId ?? "\0missing"] },
  "shares.remove": { min: "full_access", targets: async (args, db) => [(await db.get("shares", String(args.id ?? "")))?.pageId ?? "\0missing"] },
  "shares.setLink": { min: "full_access", targets: arg("pageId") },
};

export const SHAREABLE_OPS = Object.freeze(Object.keys(POLICY));

/** What a visitor without an account may read on a page published to the web. No comments or history. */
const PUBLIC_OPS = new Set(["pages.get", "pages.children", "documents.get", "databases.get", "databases.query", "assets.getUrl"]);

export interface SharedContext {
  db: Db;
  storage: Storage | null;
  actor: Actor;
  now: number;
  source?: Source;
  /** The page whose share the caller is using (any page they opened through it). */
  scopePageId: string;
  linkToken?: string | null;
}

/** Runs `op` for someone a page is shared with, as described at the top of this file. */
export async function executeShared(op: string, rawArgs: unknown, ctx: SharedContext, kind?: "query" | "mutation") {
  const policy = POLICY[op];
  if (!policy) throw new MaxError("FORBIDDEN", "That isn't available on a shared page.");
  if (ctx.actor.id === ANONYMOUS && (!PUBLIC_OPS.has(op) || kind === "mutation")) throw new MaxError("FORBIDDEN", "That isn't available on a published page.");
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const scope = await resolveAccess(ctx.db, ctx.actor.id, ctx.scopePageId, ctx.linkToken);
  if (!atLeast(scope.level, policy.min)) throw new MaxError("FORBIDDEN", `You need “${LEVEL_LABEL[policy.min]}” access to do that.`);
  // Every page the operation touches must be reachable at the required level too.
  for (const target of await policy.targets(args, ctx.db)) {
    if (!target) continue;
    let access: Access;
    try {
      access = await resolveAccess(ctx.db, ctx.actor.id, target, ctx.linkToken);
    } catch {
      throw new MaxError("FORBIDDEN", "That page isn't shared with you.");
    }
    if (access.ownerId !== scope.ownerId || !atLeast(access.level, policy.min)) throw new MaxError("FORBIDDEN", "That page isn't shared with you.");
  }
  // Comment text belongs to its author; resolving is open to commenters, deleting to authors and full access.
  if (op === "comments.update" || op === "comments.delete") {
    const comment = await ctx.db.get("comments", String(args.id ?? ""));
    const mine = comment?.authorId === ctx.actor.id;
    if (!mine && !(op === "comments.delete" && atLeast(scope.level, "full_access"))) throw new MaxError("FORBIDDEN", "Only the person who wrote a comment can change it.");
  }
  if (op === "pages.update" && args.teamspace !== undefined && scope.level !== "owner") {
    throw new MaxError("FORBIDDEN", "Only the owner can turn a page into a teamspace.");
  }
  if (op === "pages.update" && args.locked !== undefined && !atLeast(scope.level, "full_access")) {
    throw new MaxError("FORBIDDEN", "Only people with full access can lock a page.");
  }
  if (op === "shares.invite" && args.level === "full_access" && scope.level !== "owner" && !atLeast(scope.level, "full_access")) {
    throw new MaxError("FORBIDDEN", "You can't give more access than you have.");
  }
  const result = await execute(op, args, { db: ctx.db, storage: ctx.storage, ownerId: scope.ownerId, now: ctx.now, source: ctx.source ?? "ui", actor: ctx.actor }, kind);
  return op === "pages.get" ? trimBreadcrumbs(result, scope) : result;
}

/** Breadcrumbs stop at the shared page: people never see the titles of pages above it. */
function trimBreadcrumbs(result: unknown, scope: Access) {
  const r = result as { breadcrumbs?: { _id: string }[]; database?: { _id: string } | null; trashedWith?: unknown } | null;
  if (!r?.breadcrumbs || scope.level === "owner" || !scope.rootId) return result;
  const at = r.breadcrumbs.findIndex((b) => b._id === scope.rootId);
  const breadcrumbs = at >= 0 ? r.breadcrumbs.slice(at) : r.breadcrumbs.slice(-1);
  // A row shared on its own doesn't reveal the database it lives in.
  const database = r.database && breadcrumbs.some((b) => b._id === r.database!._id) ? r.database : null;
  return { ...r, breadcrumbs, database, trashedWith: null };
}

/** What the signed-in person sees in the share menu header and the page chrome. */
export async function accessInfo(db: Db, callerId: string, pageId: string, linkToken?: string | null) {
  const a = await resolveAccess(db, callerId, pageId, linkToken);
  const owner = a.level === "owner" ? null : (await db.list("settings", a.ownerId))[0];
  return { you: callerId, level: a.level, ownerId: a.ownerId, ownerName: owner?.displayName ?? null, rootId: a.rootId, pageId: a.page._id, title: a.page.title, icon: a.page.icon, kind: a.page.kind };
}

/** Pages other people shared with the caller (the share roots), newest first. */
export async function sharedWithMe(db: Db, callerId: string) {
  const out: { _id: string; title: string; icon: string | null; kind: PageRow["kind"]; level: ShareLevel; ownerId: string; ownerName: string | null; sharedAt: number; teamspace: boolean }[] = [];
  const seen = new Set<string>();
  const shares = (await db.findBy("shares", "granteeId", callerId)).sort((a, b) => b.createdAt - a.createdAt);
  for (const share of shares) {
    if (seen.has(share.pageId)) continue;
    const page = await db.get("pages", share.pageId);
    if (!page || page.archivedAt || page.ownerId !== share.ownerId) continue;
    seen.add(page._id);
    const owner = (await db.list("settings", share.ownerId))[0];
    out.push({ _id: page._id, title: page.title, icon: page.icon, kind: page.kind, level: share.level, ownerId: share.ownerId, ownerName: owner?.displayName ?? null, sharedAt: share.createdAt, teamspace: !!page.teamspace });
  }
  return out;
}

/* ── Presence: who has a page open ─────────────────────────────────────── */

export const PRESENCE_TTL_MS = 45_000;

export async function heartbeat(db: Db, actor: Actor, pageId: string, now: number, linkToken?: string | null) {
  const access = await resolveAccess(db, actor.id, pageId, linkToken);
  const rows = (await db.findBy("presence", "pageId", pageId)).filter((r) => r.accountId === actor.id);
  if (rows[0]) await db.patch("presence", rows[0]._id, { at: now, name: actor.name, image: actor.image });
  else await db.insert("presence", { ownerId: access.ownerId, pageId, accountId: actor.id, name: actor.name, image: actor.image, at: now });
  for (const extra of rows.slice(1)) await db.delete("presence", extra._id);
  // Tidy: forget anyone who left long ago.
  for (const stale of (await db.findBy("presence", "pageId", pageId)).filter((r) => now - r.at > PRESENCE_TTL_MS * 20)) await db.delete("presence", stale._id);
}

export async function present(db: Db, callerId: string, pageId: string, now: number, linkToken?: string | null) {
  await resolveAccess(db, callerId, pageId, linkToken);
  const people = (await db.findBy("presence", "pageId", pageId))
    .filter((r) => now - r.at < PRESENCE_TTL_MS)
    .map((r) => ({ accountId: r.accountId, name: r.name, image: r.image, at: r.at }));
  return { you: callerId, people };
}

/* ── Duplicate a shared or published page into your own workspace ─────────── */

/**
 * Copies a page you can open (and the sub-pages and rows inside it) into your workspace as a new
 * top-level page, like Notion's "Duplicate" on shared and published pages. Links between the copied
 * pages point at the copies; files stay where they are and are referenced, never deleted by you.
 */
export async function duplicateShared(db: Db, actor: Actor, pageId: string, now: number, linkToken?: string | null) {
  if (actor.id === ANONYMOUS) throw new MaxError("UNAUTHENTICATED", "Sign in to Max to duplicate this page into your workspace.");
  const access = await resolveAccess(db, actor.id, pageId, linkToken);
  if (access.level === "owner") throw new MaxError("VALIDATION", "This page is already yours. Use Duplicate in its ⋯ menu.");
  const source = access.page;
  const ownerPages = await db.list("pages", access.ownerId);
  const subtree = descendants(ownerPages, pageId).filter((p) => !p.archivedAt);
  const mine = await db.list("pages", actor.id);
  if (mine.length + subtree.length + 1 > LIMITS.pagesPerAccount) throw new MaxError("LIMIT", "Duplicating this would go past your page limit.");
  const lastTop = mine.filter((p) => !p.parentId && !p.databaseId && !p.archivedAt && !p.isTemplate).sort((a, b) => compareRank(a.rank, b.rank)).at(-1);
  const idMap = new Map<string, string>();
  const copied: { from: PageRow; to: string }[] = [];
  const copy = async (from: PageRow, overrides: Partial<PageRow>) => {
    const { _id, ...rest } = from;
    const to = await db.insert("pages", {
      ...rest,
      ownerId: actor.id,
      favoriteRank: null,
      lastOpenedAt: null,
      archivedAt: null,
      archivedRootId: null,
      isTemplate: false,
      locked: false,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    } as never);
    idMap.set(_id, to);
    copied.push({ from, to });
    return to;
  };
  // A database row copied on its own becomes an ordinary page (its property values stay with the database).
  const rootId = await copy(source, { parentId: null, databaseId: null, rank: rankBetween(lastTop?.rank ?? null, null), ...(source.databaseId ? { values: {} } : {}) });
  for (const child of [...subtree].sort((a, b) => depthOf(ownerPages, a._id) - depthOf(ownerPages, b._id))) {
    await copy(child, { parentId: child.parentId ? (idMap.get(child.parentId) ?? null) : null, databaseId: child.databaseId ? (idMap.get(child.databaseId) ?? null) : null });
  }
  // Point links, mentions and relations between copied pages at the copies.
  const remap = (text: string) => {
    let out = text;
    for (const [from, to] of idMap) out = out.split(from).join(to);
    return out;
  };
  const borrowed = new Map<string, string>();
  const borrow = async (text: string) => {
    let out = text;
    for (const m of new Set(text.match(/max-asset:\/\/[A-Za-z0-9_]+/g) ?? [])) {
      const assetId = m.slice("max-asset://".length);
      let next = borrowed.get(assetId);
      if (!next) {
        const asset = await db.get("assets", assetId);
        if (!asset || asset.ownerId !== access.ownerId) continue;
        const { _id, ...rest } = asset;
        next = await db.insert("assets", { ...rest, ownerId: actor.id, pageId: rest.pageId ? (idMap.get(rest.pageId) ?? null) : null, borrowed: true, createdAt: now });
        borrowed.set(assetId, next);
      }
      out = out.split(m).join(`max-asset://${next}`);
    }
    return out;
  };
  for (const { from, to } of copied) {
    const doc = (await db.list("documents", access.ownerId, { field: "pageId", value: from._id }))[0];
    if (doc) {
      const { _id, ...rest } = doc;
      await db.insert("documents", { ...rest, ownerId: actor.id, pageId: to, content: await borrow(remap(rest.content)), revision: 1, updatedAt: now });
    }
    const patch: Partial<PageRow> = {};
    if (from.values) patch.values = JSON.parse(remap(JSON.stringify(from.values)));
    if (from.icon?.startsWith("max-asset://")) patch.icon = await borrow(from.icon);
    if (from.cover?.startsWith("max-asset://")) patch.cover = await borrow(from.cover);
    if (from.properties) patch.properties = JSON.parse(remap(JSON.stringify(from.properties)));
    if (Object.keys(patch).length) await db.patch("pages", to, patch as never);
  }
  return { id: rootId, title: source.title, copied: idMap.size };
}
