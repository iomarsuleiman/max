import { z } from "zod";
import { MaxError } from "../errors";
import { atLeastRole, isOrgNamespace } from "../organizations";
import { defineOp, id } from "./define";
import { actorOf, requirePage, summary } from "./helpers";
import { people } from "./people";
import { notify } from "../notifications";
import { memberLevel } from "../orgPageAccess";

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/* ── Wiki verification ───────────────────────────────────────────────────── */

export const pagesVerify = defineOp({
  name: "pages.verify",
  kind: "mutation",
  title: "Verify a page",
  description: "Marks a page as verified by you (its owner for the wiki) until a date: days from now (default 90). Pass days: null to remove verification. Verified pages show a badge, and a warning once the verification expires.",
  input: z.object({ id, days: z.number().int().min(1).max(365).nullable().optional() }),
  async run(ctx, { id: pageId, days = 90 }) {
    const page = await requirePage(ctx, pageId);
    const me = actorOf(ctx);
    if (!me) throw new MaxError("FORBIDDEN", "Sign in to verify pages.");
    const verification = days === null ? null : { by: me, byName: ctx.actor?.name ?? (await people(ctx)).find((p) => p.id === me)?.name ?? null, at: ctx.now, until: ctx.now + days * DAY };
    await ctx.db.patch("pages", page._id, { verification });
    return { verification };
  },
});

export const pagesStale = defineOp({
  name: "pages.stale",
  kind: "query",
  title: "Pages needing review",
  description: "Verified pages whose verification has expired or expires within 14 days, soonest first: the wiki's review queue.",
  input: z.object({}),
  async run(ctx) {
    const pages = (await ctx.db.list("pages", ctx.ownerId)).filter((p) => p.verification && !p.archivedAt && p.verification.until < ctx.now + 14 * DAY);
    return { pages: pages.sort((a, b) => a.verification!.until - b.verification!.until).slice(0, 100).map((p) => ({ ...summary(p), verification: p.verification, expired: p.verification!.until < ctx.now })) };
  },
});

/* ── Activity and analytics ──────────────────────────────────────────────── */

export const activityList = defineOp({
  name: "activity.list",
  kind: "query",
  title: "Recent activity",
  description: "What changed recently in this workspace: pages and rows edited or created (and by whom), and new comments. Only what the caller can see.",
  input: z.object({ limit: z.number().int().min(1).max(100).optional() }),
  async run(ctx, { limit = 40 }) {
    const names = new Map((await people(ctx)).map((p) => [p.id, p.name]));
    const pages = (await ctx.db.list("pages", ctx.ownerId)).filter((p) => !p.archivedAt && !p.isTemplate);
    const comments = await ctx.db.list("comments", ctx.ownerId);
    const titles = new Map(pages.map((p) => [p._id, p.title || "Untitled"]));
    const items = [
      ...pages.map((p) => ({ at: p.updatedAt, kind: p.createdAt === p.updatedAt ? "created" : "edited", pageId: p._id, title: p.title || "Untitled", icon: p.icon, who: p.updatedBy ? (names.get(p.updatedBy) ?? "Someone") : null })),
      ...comments.filter((c) => titles.has(c.pageId)).map((c) => ({ at: c.createdAt, kind: "commented", pageId: c.pageId, title: titles.get(c.pageId)!, icon: null, who: c.authorName ?? (c.authorId ? (names.get(c.authorId) ?? "Someone") : null) })),
    ];
    return { items: items.sort((a, b) => b.at - a.at).slice(0, limit) };
  },
});

export const analyticsSummary = defineOp({
  name: "analytics.summary",
  kind: "query",
  title: "Workspace analytics",
  description: "Eight weeks of activity: pages created, pages edited, comments and active people per week, plus totals and the most active contributors. Admins only in an organization. Counts only, never content.",
  input: z.object({}),
  async run(ctx) {
    if (isOrgNamespace(ctx.ownerId) && !(ctx.org && atLeastRole(ctx.org.role, "admin"))) throw new MaxError("FORBIDDEN", "Only the organization's admins can see analytics.");
    const pages = (await ctx.db.list("pages", ctx.ownerId)).filter((p) => !p.isTemplate);
    const comments = await ctx.db.list("comments", ctx.ownerId);
    const names = new Map((await people(ctx)).map((p) => [p.id, p.name]));
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const start = ctx.now - (8 - i) * WEEK;
      const end = start + WEEK;
      const inWeek = (t: number) => t >= start && t < end;
      const editors = new Set(pages.filter((p) => inWeek(p.updatedAt) && p.updatedBy).map((p) => p.updatedBy!));
      for (const c of comments) if (inWeek(c.createdAt) && c.authorId) editors.add(c.authorId);
      return { weekStart: start, created: pages.filter((p) => inWeek(p.createdAt)).length, edited: pages.filter((p) => inWeek(p.updatedAt)).length, comments: comments.filter((c) => inWeek(c.createdAt)).length, activePeople: editors.size };
    });
    const contributions = new Map<string, number>();
    for (const p of pages) if (p.updatedBy && p.updatedAt > ctx.now - 4 * WEEK) contributions.set(p.updatedBy, (contributions.get(p.updatedBy) ?? 0) + 1);
    const live = pages.filter((p) => !p.archivedAt);
    // Workload: open rows per person across Person properties (done = checked box or Done status).
    const dbs = new Map(live.filter((p) => p.kind === "database").map((d) => [d._id, d.properties ?? []]));
    const load = new Map<string, number>();
    for (const r of live) {
      const props = r.databaseId ? dbs.get(r.databaseId) : null;
      if (!props) continue;
      const done = props.some((p) => (p.type === "checkbox" && r.values?.[p.id] === true) || (p.type === "status" && /^(done|complete|completed|closed)$/i.test(p.options?.find((o) => o.id === r.values?.[p.id])?.name ?? "")));
      if (done) continue;
      for (const p of props) if (p.type === "person" && Array.isArray(r.values?.[p.id])) for (const who of r.values![p.id] as string[]) load.set(who, (load.get(who) ?? 0) + 1);
    }
    const pending = (await ctx.db.list("approvals", ctx.ownerId)).filter((a) => a.status === "pending");
    return {
      workload: [...load].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id, open]) => ({ id, name: names.get(id) ?? "Former member", open })),
      pendingReviews: pending.length,
      totals: { pages: live.filter((p) => p.kind === "page" && !p.databaseId).length, databases: live.filter((p) => p.kind === "database").length, rows: live.filter((p) => p.databaseId).length, comments: comments.length, verified: live.filter((p) => p.verification && p.verification.until > ctx.now).length, staleVerified: live.filter((p) => p.verification && p.verification.until <= ctx.now).length },
      weeks,
      topContributors: [...contributions].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, pagesEdited]) => ({ id, name: names.get(id) ?? "Former member", pagesEdited })),
    };
  },
});

/* ── Announcements ───────────────────────────────────────────────────────── */

export const announcementsSend = defineOp({
  name: "announcements.send",
  kind: "mutation",
  title: "Announce a page",
  description: "In an organization (admins only): tells everyone, or chosen teams, about a page in their inbox. Only people who can open the page are told.",
  input: z.object({ pageId: id, message: z.string().trim().min(1).max(500), teamIds: z.array(z.string().max(64)).max(50).optional() }),
  async run(ctx, { pageId, message, teamIds }) {
    if (!isOrgNamespace(ctx.ownerId) || !ctx.org || !atLeastRole(ctx.org.role, "admin")) throw new MaxError("FORBIDDEN", "Only an organization's admins can make announcements.");
    const page = await requirePage(ctx, pageId);
    const db = ctx.unrestrictedDb ?? ctx.db;
    const members = (await db.list("orgMembers", ctx.ownerId)).filter((m) => m.status === "active" && m.role !== "guest");
    const inTeams = teamIds?.length ? new Set((await db.list("orgTeams", ctx.ownerId)).filter((t) => teamIds.includes(t._id) && !t.archivedAt).flatMap((t) => t.memberIds)) : null;
    const recipients: string[] = [];
    for (const m of members) {
      if (inTeams && !inTeams.has(m.accountId)) continue;
      if ((await memberLevel(db, ctx.ownerId, m.accountId, m.role, pageId)) !== "none") recipients.push(m.accountId);
    }
    const sent = await notify(ctx.db, recipients, { kind: "announcement", ownerId: ctx.ownerId, pageId, actor: { id: actorOf(ctx) ?? "", name: ctx.actor?.name ?? null }, title: `📣 ${page.title || "Untitled"}`, body: message }, ctx.now);
    return { sent };
  },
});
