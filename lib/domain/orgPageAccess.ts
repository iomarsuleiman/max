/**
 * Private pages inside an organization (Notion's private teamspaces and restricted pages).
 *
 * Any page in an organization can be limited to chosen people and teams; the limit covers
 * everything inside it. Owners and admins always see everything. For everyone else, a hidden
 * page doesn't exist: the request's database handle is wrapped (restrictedDb) so every
 * operation, search, graph, backlinks, files, history, comments, live rooms and MCP included,
 * reads and writes through the same check. There is no per-operation list to forget.
 */
import { MaxError, notFound } from "./errors";
import type { CrossField, CrossTable, Db, IndexedField, NewRow } from "./db";
import type { OrgRole, PageRow, TableName, Tables } from "./types";
import { atLeastRole, getOrg, logEvent, memberOf, type OrgActor } from "./organizations";

export const MAX_RESTRICTIONS = 500;

/** Tables whose rows belong to a page through their `pageId`. */
const BY_PAGE = new Set<TableName>(["documents", "versions", "comments", "assets", "shares", "shareLinks", "presence", "collabRooms", "collabAwareness", "collabUpdates", "sites", "orgPageAccess", "approvals"]);

export type Level = "none" | "view" | "comment" | "full";
const RANK: Record<Level, number> = { none: 0, view: 1, comment: 2, full: 3 };

/** What one member may do on each page of the organization, memoized for one request. */
export interface Visibility {
  level(pageId: string): Promise<Level>;
  hidden(pageId: string): Promise<boolean>;
}

/**
 * Null when nothing is limited for this member (owners, admins, or an organization without
 * private pages: the common, zero-cost case). Otherwise the most restrictive rule on a page's
 * chain wins: hidden beats view-only beats comment-only.
 */
export async function hiddenFor(db: Db, ns: string, accountId: string, role: OrgRole): Promise<Visibility | null> {
  if (atLeastRole(role, "admin")) return null;
  const rules = await db.list("orgPageAccess", ns);
  if (!rules.length) return null;
  const teams = (await db.list("orgTeams", ns)).filter((t) => !t.archivedAt && t.memberIds.includes(accountId)).map((t) => t._id);
  const limits = new Map<string, Level>();
  for (const r of rules) if (!r.memberIds.includes(accountId) && !r.teamIds.some((t) => teams.includes(t))) limits.set(r.pageId, r.othersLevel ?? "none");
  if (!limits.size) return null;
  const memo = new Map<string, Promise<Level>>();
  const walk = async (pageId: string, depth: number): Promise<Level> => {
    const own = limits.get(pageId) ?? "full";
    if (own === "none" || depth > 60) return "none"; // fail closed on cycles or absurd depth
    const page = (await db.get("pages", pageId)) as PageRow | null;
    const up = page && page.ownerId === ns ? (page.parentId ?? page.databaseId) : null;
    const above = up ? await level(up, depth + 1) : "full";
    return RANK[above] < RANK[own] ? above : own;
  };
  const level = (pageId: string, depth = 0): Promise<Level> => {
    let p = memo.get(pageId);
    if (!p) memo.set(pageId, (p = walk(pageId, depth)));
    return p;
  };
  return { level: (id) => level(id), hidden: async (id) => (await level(id)) === "none" };
}

function pageOf(table: TableName, row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  if (table === "pages") return String(row._id);
  return BY_PAGE.has(table) && typeof row.pageId === "string" && row.pageId ? row.pageId : null;
}

/**
 * A Db that behaves as if hidden pages (and everything belonging to them) don't exist, and
 * refuses changes to view-only pages (comment-only pages accept comments).
 */
export function restrictedDb(inner: Db, v: Visibility): Db {
  const rowHidden = async (table: TableName, row: Record<string, unknown> | null) => {
    const page = pageOf(table, row);
    return page ? v.hidden(page) : false;
  };
  const visible = async <T,>(table: TableName, rows: T[]) => {
    const drop = await Promise.all(rows.map((r) => rowHidden(table, r as Record<string, unknown>)));
    return rows.filter((_, i) => !drop[i]);
  };
  const writable = async (table: TableName, pageId: string | null) => {
    if (!pageId) return;
    const level = await v.level(pageId);
    if (level === "none") throw notFound();
    if (level === "full" || (level === "comment" && table === "comments")) return;
    // Opening a page (recents) isn't a change to it.
    throw new MaxError("FORBIDDEN", level === "comment" ? "You can comment on this page, but not edit it." : "You can view this page, but not change it.");
  };
  return {
    ...inner,
    async get<T extends TableName>(table: T, id: string) {
      const row = await inner.get(table, id);
      return (await rowHidden(table, row as Record<string, unknown> | null)) ? null : row;
    },
    async list<T extends TableName>(table: T, ownerId: string, where?: { field: IndexedField<T>; value: string | null }) {
      return visible(table, await inner.list(table, ownerId, where));
    },
    async findBy<T extends CrossTable>(table: T, field: CrossField<T>, value: string) {
      return visible(table, await inner.findBy(table, field, value));
    },
    async insert<T extends TableName>(table: T, row: NewRow<T>) {
      const r = row as Record<string, unknown>;
      await writable(table, table === "pages" ? ((r.parentId ?? r.databaseId) as string | null) : pageOf(table, { ...r, _id: "" }));
      return inner.insert(table, row);
    },
    async patch<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>) {
      const row = (await inner.get(table, id)) as Record<string, unknown> | null;
      const p = patch as Record<string, unknown>;
      const onlyOpened = table === "pages" && Object.keys(p).every((k) => k === "lastOpenedAt");
      if (onlyOpened) {
        if (await rowHidden(table, row)) throw notFound();
      } else await writable(table, pageOf(table, row));
      // Moving a page under one you can't change would hand it to people you can't see.
      if (table === "pages") for (const k of ["parentId", "databaseId"]) if (typeof p[k] === "string") await writable("pages", p[k] as string);
      return inner.patch(table, id, patch);
    },
    async delete(table: TableName, id: string) {
      await writable(table, pageOf(table, (await inner.get(table, id)) as Record<string, unknown> | null));
      return inner.delete(table, id);
    },
    async updatesAfter(roomId: string, afterSeq: number, limit: number) {
      const room = await inner.get("collabRooms", roomId);
      if (room && (await v.hidden(room.pageId))) return [];
      return inner.updatesAfter(roomId, afterSeq, limit);
    },
  };
}

/** A member's level on one page: "full" unless a private-page rule limits it. */
export async function memberLevel(db: Db, ns: string, accountId: string, role: OrgRole, pageId: string): Promise<Level> {
  const v = await hiddenFor(db, ns, accountId, role);
  return v ? v.level(pageId) : "full";
}

/** Whether a member can see one page (for the live-room and share-link paths). */
export async function memberCanSee(db: Db, ns: string, accountId: string, role: OrgRole, pageId: string): Promise<boolean> {
  return (await memberLevel(db, ns, accountId, role, pageId)) !== "none";
}

/* ── Managing restrictions ───────────────────────────────────────────────── */

async function managerFor(db: Db, actor: OrgActor, ns: string, pageId: string) {
  const [org, member] = await Promise.all([getOrg(db, ns), memberOf(db, ns, actor.id)]);
  if (!org || !member || member.status !== "active" || member.role === "guest") throw notFound("organization");
  const page = await db.get("pages", pageId);
  if (!page || page.ownerId !== ns) throw notFound();
  if (!(await memberCanSee(db, ns, actor.id, member.role, pageId))) throw notFound();
  return { org, member, page };
}

/** Who can see a page: everyone in the organization, or the people and teams on its nearest restriction. */
export async function pageAccess(db: Db, actor: OrgActor, ns: string, pageId: string) {
  const { member, page } = await managerFor(db, actor, ns, pageId);
  const rules = new Map((await db.list("orgPageAccess", ns)).map((r) => [r.pageId, r]));
  let cur: PageRow | null = page;
  for (let i = 0; cur && i < 60; i++) {
    const rule = rules.get(cur._id);
    if (rule) return { restricted: true, pageId: cur._id, inheritedFrom: cur._id === page._id ? null : { id: cur._id, title: cur.title }, memberIds: rule.memberIds, teamIds: rule.teamIds, othersLevel: rule.othersLevel ?? "none", listed: !!rule.listed, canManage: atLeastRole(member.role, "admin") || rule.memberIds.includes(actor.id) };
    const up: string | null = cur.parentId ?? cur.databaseId;
    cur = up ? await db.get("pages", up) : null;
  }
  return { restricted: false, pageId: page._id, inheritedFrom: null, memberIds: [], teamIds: [], othersLevel: "none" as const, listed: false, canManage: true };
}

/**
 * Limits a page (and everything inside it) to chosen members and teams, or opens it to the
 * whole organization again (`null`). Members may restrict pages they can see but must keep
 * themselves in; admins and the owner always keep access.
 */
export async function setPageAccess(db: Db, actor: OrgActor, ns: string, pageId: string, access: { memberIds: string[]; teamIds: string[]; othersLevel?: "none" | "view" | "comment"; listed?: boolean } | null, now: number) {
  const { member, page } = await managerFor(db, actor, ns, pageId);
  const admin = atLeastRole(member.role, "admin");
  const existing = (await db.list("orgPageAccess", ns, { field: "pageId", value: pageId }))[0] ?? null;
  if (existing && !admin && !existing.memberIds.includes(actor.id)) throw new MaxError("FORBIDDEN", "Only the people on this page's list, or an admin, can change who sees it.");
  if (!access) {
    if (existing) await db.delete("orgPageAccess", existing._id);
    await logEvent(db, ns, actor, "page.access_opened", pageId, page.title || "Untitled", now);
    return { restricted: false };
  }
  const members = new Set((await db.list("orgMembers", ns)).filter((m) => m.status === "active").map((m) => m.accountId));
  const teams = new Set((await db.list("orgTeams", ns)).filter((t) => !t.archivedAt).map((t) => t._id));
  const memberIds = [...new Set(access.memberIds)].filter((id) => members.has(id)).slice(0, 500);
  const teamIds = [...new Set(access.teamIds)].filter((id) => teams.has(id)).slice(0, 100);
  if (!admin && !memberIds.includes(actor.id)) memberIds.unshift(actor.id);
  const othersLevel = access.othersLevel === "view" || access.othersLevel === "comment" ? access.othersLevel : "none";
  // "Closed": everyone sees it's there (name and icon) and can ask to join; only hidden pages can be listed.
  const listed = othersLevel === "none" && !!access.listed;
  if (existing) await db.patch("orgPageAccess", existing._id, { memberIds, teamIds, othersLevel, listed, updatedAt: now });
  else {
    if ((await db.list("orgPageAccess", ns)).length >= MAX_RESTRICTIONS) throw new MaxError("LIMIT", `An organization can have up to ${MAX_RESTRICTIONS} private pages.`);
    await db.insert("orgPageAccess", { ownerId: ns, pageId, memberIds, teamIds, othersLevel, listed, createdBy: actor.id, updatedAt: now });
  }
  await logEvent(db, ns, actor, "page.access_restricted", pageId, `${page.title || "Untitled"}: ${memberIds.length} people, ${teamIds.length} teams, others ${othersLevel}${listed ? " (closed)" : ""}`, now);
  return { restricted: true };
}

export type { Tables };

/** Closed pages the member can't open but may ask to join: their name and icon only. */
export async function lockedPages(db: Db, actor: OrgActor, ns: string) {
  const member = await memberOf(db, ns, actor.id);
  if (!member || member.status !== "active" || member.role === "guest") throw notFound("organization");
  const v = await hiddenFor(db, ns, actor.id, member.role);
  if (!v) return { pages: [] };
  const out: { id: string; title: string; icon: string | null; teamspace: boolean }[] = [];
  for (const rule of await db.list("orgPageAccess", ns)) {
    if (!rule.listed || !(await v.hidden(rule.pageId))) continue;
    const page = await db.get("pages", rule.pageId);
    // Only roots whose own parent is visible: a closed page inside a hidden one stays secret.
    const up = page ? (page.parentId ?? page.databaseId) : null;
    if (page && !page.archivedAt && page.ownerId === ns && (!up || !(await v.hidden(up)))) out.push({ id: page._id, title: page.title || "Untitled", icon: page.icon, teamspace: !!page.teamspace });
  }
  return { pages: out };
}

/** Asks the people on a closed page's list to let the caller in (they get it in their inbox). */
export async function requestPageAccess(db: Db, actor: OrgActor, ns: string, pageId: string, message: string, now: number, notify: (recipients: string[], title: string) => Promise<void>) {
  const { pages } = await lockedPages(db, actor, ns);
  const page = pages.find((p) => p.id === pageId);
  if (!page) throw notFound();
  const rule = (await db.list("orgPageAccess", ns, { field: "pageId", value: pageId }))[0];
  const admins = (await db.list("orgMembers", ns)).filter((m) => m.status === "active" && (m.role === "owner" || m.role === "admin")).map((m) => m.accountId);
  const recipients = [...new Set([...(rule?.memberIds ?? []), ...admins])].filter((id) => id !== actor.id).slice(0, 50);
  await notify(recipients, `${actor.name} asked to join “${page.title}”${message.trim() ? `: ${message.trim().slice(0, 200)}` : ""}`);
  await logEvent(db, ns, actor, "page.access_requested", pageId, page.title, now);
  return { ok: true, notified: recipients.length };
}
