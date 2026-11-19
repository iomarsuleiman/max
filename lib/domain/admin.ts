import { MaxError, notFound } from "./errors";
import { accountOf, ownerFor } from "./workspaces";
import type { Db } from "./db";
import type { ModerationRow, ReportRow } from "./types";

/**
 * Max's admin dashboard: everyone's accounts with how they use Max, suspending or banning, and the
 * inbox of reported problems. Only callers whose sign-in email is in MAX_ADMIN_EMAILS get here
 * (convex/admin.ts and the local route check before calling).
 */

export const REPORTS = "reports";
const MAX_USERS = 300;

export function isAdminEmail(email: string | null | undefined, list = process.env.MAX_ADMIN_EMAILS ?? "") {
  if (!email) return false;
  return list
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}

export async function adminOverview(db: Db, now: number) {
  const settings = await db.listAll("settings", MAX_USERS);
  const moderation = new Map((await db.listAll("moderation", 1000)).map((m) => [m.ownerId, m]));
  const sites = await db.listAll("sites", 1000);
  const week = now - 7 * 86_400_000;
  const users = [];
  for (const s of settings) {
    // Every workspace of the account counts: the main one and any extra ones.
    const owners = [s.ownerId, ...(s.workspaces ?? []).map((w) => ownerFor(s.ownerId, w.id))];
    const pages = (await Promise.all(owners.map((o) => db.list("pages", o)))).flat().filter((p) => !p.isTemplate);
    const live = pages.filter((p) => !p.archivedAt);
    const lastActive = Math.max(s.updatedAt ?? 0, ...pages.map((p) => p.updatedAt));
    users.push({
      id: s.ownerId,
      name: s.displayName ?? null,
      email: s.email ?? null,
      joinedAt: s.joinedAt ?? null,
      lastActive: lastActive > 0 ? lastActive : null,
      pages: live.filter((p) => p.kind === "page" && !p.databaseId).length,
      databases: live.filter((p) => p.kind === "database").length,
      rows: live.filter((p) => p.databaseId).length,
      trashed: pages.length - live.length,
      workspaces: owners.length,
      sites: sites.filter((x) => accountOf(x.ownerId) === s.ownerId).length,
      shares: (await Promise.all(owners.map((o) => db.list("shares", o)))).flat().length,
      status: moderation.get(s.ownerId)?.status ?? "active",
      reason: moderation.get(s.ownerId)?.reason ?? null,
    });
  }
  users.sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  const reports = await db.list("reports", REPORTS);
  return {
    totals: {
      users: users.length,
      activeThisWeek: users.filter((u) => (u.lastActive ?? 0) >= week).length,
      newThisWeek: users.filter((u) => (u.joinedAt ?? 0) >= week).length,
      pages: users.reduce((n, u) => n + u.pages, 0),
      databases: users.reduce((n, u) => n + u.databases, 0),
      sites: sites.length,
      suspended: users.filter((u) => u.status !== "active").length,
      openReports: reports.filter((r) => r.status === "open").length,
    },
    users,
  };
}

/** Suspends (read-only), bans (no access), or restores an account. */
export async function setModeration(db: Db, adminId: string, userId: string, status: ModerationRow["status"] | "active", reason: string, now: number) {
  if (userId === adminId) throw new MaxError("VALIDATION", "You can't suspend or ban your own account.");
  if (!(await db.list("settings", userId)).length) throw notFound("account");
  for (const m of await db.list("moderation", userId)) await db.delete("moderation", m._id);
  if (status !== "active") await db.insert("moderation", { ownerId: userId, status, reason: reason.trim().slice(0, 300), by: adminId, updatedAt: now });
  return { status };
}

export async function listReports(db: Db) {
  return { reports: (await db.list("reports", REPORTS)).sort((a, b) => b.createdAt - a.createdAt) };
}

export async function setReportStatus(db: Db, id: string, status: ReportRow["status"], now: number) {
  const r = await db.get("reports", id);
  if (!r || r.ownerId !== REPORTS) throw notFound("report");
  await db.patch("reports", id, { status, resolvedAt: status === "resolved" ? now : null });
  return { ok: true };
}

/**
 * Anyone can report a problem: signed-in people from the app, visitors from a published page or
 * site. Short, and limited to ten an hour per person, so the inbox stays useful.
 */
export async function submitReport(
  db: Db,
  reporter: { id: string; name: string | null; email: string | null } | null,
  input: { kind: ReportRow["kind"]; message: string; url?: string | null; pageId?: string | null; siteSlug?: string | null },
  now: number,
) {
  const message = input.message.trim();
  if (message.length < 3) throw new MaxError("VALIDATION", "Tell us a little about the problem.");
  if (message.length > 2000) throw new MaxError("VALIDATION", "Keep it under 2,000 characters.");
  if (!["bug", "content", "other"].includes(input.kind)) throw new MaxError("VALIDATION", "Pick what kind of problem it is.");
  const recent = (await db.list("reports", REPORTS)).filter((r) => r.createdAt > now - 3600_000 && (reporter ? r.reporterId === reporter.id : r.reporterId === null));
  if (recent.length >= (reporter ? 10 : 30)) throw new MaxError("LIMIT", "You've sent a lot of reports in the last hour. Try again later.");
  const url = input.url && /^https?:\/\//.test(input.url) ? input.url.slice(0, 500) : null;
  await db.insert("reports", {
    ownerId: REPORTS,
    reporterId: reporter?.id ?? null,
    reporterName: reporter?.name?.slice(0, 120) ?? null,
    reporterEmail: reporter?.email?.slice(0, 320) ?? null,
    kind: input.kind,
    message,
    url,
    pageId: input.pageId?.slice(0, 64) ?? null,
    siteSlug: input.siteSlug?.slice(0, 40) ?? null,
    status: "open",
    createdAt: now,
    resolvedAt: null,
  });
  return { ok: true };
}
