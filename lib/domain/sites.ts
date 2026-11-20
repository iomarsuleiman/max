import { MaxError, notFound } from "./errors";
import { accountOf } from "./workspaces";
import type { Db, Storage } from "./db";
import { execute } from "./ops";
import type { PageRow, SiteRow } from "./types";

/**
 * Reading a published website (lib/domain/ops/sites.ts publishes one). Visitors need no account:
 * everything is read through the site's address, and only pages inside the published page are
 * reachable. Comments, history and the rest of the workspace never are.
 */

const SITE_OPS = new Set(["pages.get", "pages.children", "documents.get", "databases.get", "databases.query", "assets.getUrl"]);
const MAX_PAGES = 2000;

export async function siteBySlug(db: Db, slug: string): Promise<SiteRow> {
  const site = (await db.findBy("sites", "slug", slug.toLowerCase()))[0];
  if (!site) throw notFound("site");
  // Sites of banned accounts go offline.
  if ((await db.list("moderation", accountOf(site.ownerId))).some((m) => m.status === "banned")) throw notFound("site");
  return site;
}

/** The published page and everything inside it (not trashed, not templates). */
async function sitePages(db: Db, site: SiteRow) {
  const all = (await db.list("pages", site.ownerId)).filter((p) => !p.archivedAt && !p.isTemplate);
  const root = all.find((p) => p._id === site.pageId);
  if (!root) throw notFound("site");
  const inside = new Map<string, PageRow>([[root._id, root]]);
  for (let grew = true; grew && inside.size < MAX_PAGES; ) {
    grew = false;
    for (const p of all) {
      const up = p.parentId ?? p.databaseId;
      if (up && inside.has(up) && !inside.has(p._id)) {
        inside.set(p._id, p);
        grew = true;
      }
    }
  }
  return { root, inside };
}

const publicSite = (s: SiteRow) => ({ slug: s.slug, name: s.name, icon: s.icon, description: s.description, search: s.search, rootId: s.pageId });

/** The site's details and its navigation: every page (and database) inside it, without database rows. */
export async function siteNav(db: Db, slug: string) {
  const site = await siteBySlug(db, slug);
  const { inside } = await sitePages(db, site);
  const nav = [...inside.values()]
    .filter((p) => !p.databaseId)
    .map((p) => ({ _id: p._id, title: p.title, icon: p.icon, kind: p.kind, parentId: p._id === site.pageId ? null : p.parentId, rank: p.rank }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  return { site: publicSite(site), nav };
}

/** Runs one read-only operation for a visitor, on a page inside the site. */
export async function siteRead(db: Db, storage: Storage | null, slug: string, op: string, rawArgs: unknown, now: number) {
  if (!SITE_OPS.has(op)) throw new MaxError("FORBIDDEN", "That isn't available on a website.");
  const site = await siteBySlug(db, slug);
  const { inside } = await sitePages(db, site);
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.length > 0 ? v : "");
  let target = "";
  let cleanArgs: Record<string, unknown>;
  if (op === "pages.get") {
    target = str(args.id);
    cleanArgs = { id: target };
  } else if (op === "pages.children") {
    target = str(args.parentId);
    cleanArgs = { parentId: target };
  } else if (op === "documents.get") {
    target = str(args.pageId);
    cleanArgs = { pageId: target, format: args.format };
  } else if (op === "databases.get") {
    target = str(args.databaseId);
    cleanArgs = { databaseId: target };
  } else if (op === "databases.query") {
    target = str(args.databaseId);
    cleanArgs = {
      databaseId: target,
      ...(typeof args.viewId === "string" ? { viewId: args.viewId } : {}),
      ...(typeof args.search === "string" ? { search: args.search } : {}),
      ...(Array.isArray(args.filters) ? { filters: args.filters } : {}),
      ...(Array.isArray(args.sorts) ? { sorts: args.sorts } : {}),
      ...(typeof args.cursor === "number" ? { cursor: args.cursor } : {}),
      ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
    };
  } else if (op === "assets.getUrl") {
    const assetId = str(args.id);
    const asset = assetId ? await db.get("assets", assetId) : null;
    target = asset && asset.ownerId === site.ownerId && asset.pageId ? asset.pageId : "";
    cleanArgs = { id: assetId };
  } else {
    throw new MaxError("FORBIDDEN", "That isn't available on a website.");
  }
  if (!target || !inside.has(target)) throw notFound();
  const result = await execute(op, cleanArgs, { db, storage, ownerId: site.ownerId, now, source: "ui", publishedPages: inside }, "query");
  if (op !== "pages.get") return result;
  // Breadcrumbs start at the site's home page; nothing above it is revealed.
  const r = result as { breadcrumbs: { _id: string }[]; database: { _id: string } | null; trashedWith?: unknown };
  const at = r.breadcrumbs.findIndex((b) => b._id === site.pageId);
  return { ...r, breadcrumbs: at >= 0 ? r.breadcrumbs.slice(at) : [], database: r.database && inside.has(r.database._id) ? r.database : null, trashedWith: null };
}

/** Finds pages in the site by title or text, with a short excerpt around the first match. */
export async function siteSearch(db: Db, slug: string, query: string) {
  const site = await siteBySlug(db, slug);
  if (!site.search) throw new MaxError("FORBIDDEN", "Search is off for this site.");
  const q = query.trim().toLowerCase().slice(0, 100);
  if (q.length < 2) return { results: [] };
  const { inside } = await sitePages(db, site);
  const docs = new Map((await db.list("documents", site.ownerId)).map((d) => [d.pageId, d.text ?? ""]));
  const results: { _id: string; title: string; icon: string | null; excerpt: string }[] = [];
  for (const p of inside.values()) {
    const text = docs.get(p._id) ?? "";
    const inTitle = p.title.toLowerCase().includes(q);
    const at = text.toLowerCase().indexOf(q);
    if (!inTitle && at < 0) continue;
    const excerpt = at >= 0 ? `${at > 40 ? "…" : ""}${text.slice(Math.max(0, at - 40), at + q.length + 80).trim()}${at + q.length + 80 < text.length ? "…" : ""}` : text.slice(0, 120);
    results.push({ _id: p._id, title: p.title, icon: p.icon, excerpt });
    if (results.length >= 20) break;
  }
  results.sort((a, b) => Number(b.title.toLowerCase().includes(q)) - Number(a.title.toLowerCase().includes(q)));
  return { results };
}
