import { MaxError, notFound } from "./errors";
import { accountOf, ownerFor } from "./workspaces";
import { deleteOrganization, filterEvents, getOrg, handOver, isOrgNamespace, logEvent, PLATFORM } from "./organizations";
import type { Db } from "./db";
import type { ModerationRow, ReportRow } from "./types";

/**
 * Max's admin dashboard: everyone's accounts with how they use Max, suspending or banning, and the
 * inbox of reported problems. Only callers whose sign-in email is in MAX_ADMIN_EMAILS get here
 * (convex/admin.ts and the local route check before calling).
 */

export const REPORTS = "reports";

export function isAdminEmail(email: string | null | undefined, list = process.env.MAX_ADMIN_EMAILS ?? "") {
  if (!email) return false;
  return list
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.trim().toLowerCase());
}

/**
 * Platform staff roles, separate from any organization role: "admin" (MAX_ADMIN_EMAILS) may act;
 * "support" (MAX_SUPPORT_EMAILS) may look but not change anything.
 */
export type PlatformRole = "admin" | "support";
export function platformRole(email: string | null | undefined): PlatformRole | null {
  if (isAdminEmail(email)) return "admin";
  if (isAdminEmail(email, process.env.MAX_SUPPORT_EMAILS ?? "")) return "support";
  return null;
}

const WEEK = 7 * 86_400_000;
const SCAN = 5000;

/** Weekly counts for the last `weeks` weeks, oldest first. */
function weekly(times: number[], now: number, weeks = 8) {
  const out = Array.from({ length: weeks }, (_, i) => ({ weekStart: now - (weeks - i) * WEEK, count: 0 }));
  for (const t of times) {
    const i = weeks - 1 - Math.floor((now - t) / WEEK);
    if (i >= 0 && i < weeks) out[i].count++;
  }
  return out;
}

/**
 * The dashboard's headline numbers and trends. Counts only, from metadata: never page contents.
 * Per-person usage is loaded a page at a time (adminUsers), so this stays fast as Max grows.
 */
export async function adminOverview(db: Db, now: number) {
  const [settings, moderation, sites, orgRows, events, audit, reports] = await Promise.all([
    db.listAll("settings", SCAN),
    db.listAll("moderation", SCAN),
    db.listAll("sites", SCAN),
    db.listAll("orgs", SCAN),
    db.listAll("orgEvents", 2000),
    db.listAll("audit", 2000),
    db.list("reports", REPORTS),
  ]);
  const week = now - WEEK;
  const memberships = (await Promise.all(orgRows.map((o) => db.list("orgMembers", o.ownerId)))).flat();
  const invites = (await Promise.all(orgRows.map((o) => db.list("orgInvites", o.ownerId)))).flat();
  const activeOrgs = new Set(events.filter((e) => e.at >= week && e.ownerId !== PLATFORM).map((e) => e.ownerId));
  const failures = audit.filter((a) => !a.ok && a.at >= week);
  const people = settings.filter((s) => !isOrgNamespace(s.ownerId));
  return {
    totals: {
      users: people.length,
      activeThisWeek: people.filter((u) => (u.updatedAt ?? 0) >= week).length,
      newThisWeek: people.filter((u) => (u.joinedAt ?? 0) >= week).length,
      organizations: orgRows.length,
      activeOrganizations: orgRows.filter((o) => activeOrgs.has(o.ownerId) || o.updatedAt >= week).length,
      orgMembers: memberships.filter((m) => m.status === "active").length,
      pendingInvites: invites.filter((i) => i.status === "pending" && i.expiresAt > now).length,
      sites: sites.length,
      suspended: moderation.filter((m) => !isOrgNamespace(m.ownerId)).length,
      suspendedOrgs: moderation.filter((m) => isOrgNamespace(m.ownerId)).length,
      openReports: reports.filter((r) => r.status === "open").length,
      failuresThisWeek: failures.length,
      truncated: settings.length >= SCAN || orgRows.length >= SCAN,
    },
    trends: { signups: weekly(people.map((p) => p.joinedAt ?? 0), now), organizations: weekly(orgRows.map((o) => o.createdAt), now) },
    incidents: Object.entries(
      failures.reduce<Record<string, number>>((acc, f) => {
        const key = `${f.op} · ${f.code ?? "error"}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .map(([what, count]) => ({ what, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
  };
}

/** One page of people, with usage counted only for that page. Search matches name, email or id. */
export async function adminUsers(db: Db, opts: { search?: string; offset?: number; limit?: number }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = opts.search?.trim().toLowerCase() ?? "";
  const [settings, moderation, sites] = await Promise.all([db.listAll("settings", SCAN), db.listAll("moderation", SCAN), db.listAll("sites", SCAN)]);
  const standing = new Map(moderation.map((m) => [m.ownerId, m]));
  const matches = settings
    .filter((s) => !isOrgNamespace(s.ownerId))
    .filter((s) => !q || s.ownerId.toLowerCase() === q || (s.email ?? "").toLowerCase().includes(q) || (s.displayName ?? "").toLowerCase().includes(q))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
  const invited = new Map<string, number>();
  for (const s of settings) if (s.invitedBy) invited.set(s.invitedBy, (invited.get(s.invitedBy) ?? 0) + 1);
  const users = [];
  for (const s of matches.slice(offset, offset + limit)) {
    // Every workspace of the account counts: the main one and any extra ones.
    const owners = [s.ownerId, ...(s.workspaces ?? []).map((w) => ownerFor(s.ownerId, w.id))];
    const [pageLists, shareLists, memberships] = await Promise.all([Promise.all(owners.map((o) => db.list("pages", o))), Promise.all(owners.map((o) => db.list("shares", o))), db.findBy("orgMembers", "accountId", s.ownerId)]);
    const pages = pageLists.flat().filter((p) => !p.isTemplate);
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
      organizations: memberships.length,
      orgsOn: !!(await db.list("accountFeatures", s.ownerId))[0]?.organizations,
      sites: sites.filter((x) => accountOf(x.ownerId) === s.ownerId).length,
      invited: invited.get(s.ownerId) ?? 0,
      shares: shareLists.flat().length,
      status: standing.get(s.ownerId)?.status ?? "active",
      reason: standing.get(s.ownerId)?.reason ?? null,
    });
  }
  return { users, total: matches.length, offset, limit };
}

/** One person: their organizations and roles, workspaces, standing and the admin actions about them. */
export async function adminUser(db: Db, userId: string) {
  const s = (await db.list("settings", userId))[0];
  if (!s || isOrgNamespace(userId)) throw notFound("account");
  const memberships = await db.findBy("orgMembers", "accountId", userId);
  const organizations = [];
  for (const m of memberships) {
    const org = await getOrg(db, m.ownerId);
    if (org) organizations.push({ id: org.ownerId, name: org.name, icon: org.icon, role: m.role, status: m.status, joinedAt: m.joinedAt });
  }
  const invites = s.email ? (await db.findBy("orgInvites", "email", s.email.toLowerCase())).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50) : [];
  const orgNames = new Map<string, string>();
  for (const i of invites) if (!orgNames.has(i.ownerId)) orgNames.set(i.ownerId, (await getOrg(db, i.ownerId))?.name ?? "Deleted organization");
  const moderation = (await db.list("moderation", userId))[0] ?? null;
  const events = (await db.listAll("orgEvents", 2000)).filter((e) => e.targetId === userId || e.actorId === userId).sort((a, b) => b.at - a.at).slice(0, 50);
  return {
    user: { id: userId, name: s.displayName ?? null, email: s.email ?? null, joinedAt: s.joinedAt ?? null, updatedAt: s.updatedAt ?? null, workspaces: [{ name: s.workspaceName?.trim() || "Personal" }, ...(s.workspaces ?? []).map((w) => ({ name: w.name }))], status: moderation?.status ?? "active", reason: moderation?.reason ?? null },
    organizations,
    invitations: invites.map((i) => ({ id: i._id, orgId: i.ownerId, orgName: orgNames.get(i.ownerId) ?? null, role: i.role, status: i.status, createdAt: i.createdAt, invitedByName: i.invitedByName })),
    events,
  };
}

/** Every organization with its owner, size and standing. */
export async function adminOrganizations(db: Db, opts: { search?: string; offset?: number; limit?: number }, now: number) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const q = opts.search?.trim().toLowerCase() ?? "";
  const [rows, moderation] = await Promise.all([db.listAll("orgs", SCAN), db.listAll("moderation", SCAN)]);
  const standing = new Map(moderation.map((m) => [m.ownerId, m]));
  const matches = rows.filter((o) => !q || o.ownerId === q || o.name.toLowerCase().includes(q) || o.slug.includes(q)).sort((a, b) => b.createdAt - a.createdAt);
  const organizations = [];
  for (const o of matches.slice(offset, offset + limit)) {
    const [members, invites] = await Promise.all([db.list("orgMembers", o.ownerId), db.list("orgInvites", o.ownerId)]);
    const owner = members.find((m) => m.role === "owner");
    organizations.push({
      id: o.ownerId,
      name: o.name,
      slug: o.slug,
      icon: o.icon,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      owner: owner ? { id: owner.accountId, name: owner.name, email: owner.email } : null,
      members: members.filter((m) => m.status === "active").length,
      admins: members.filter((m) => m.role === "admin").length,
      guests: members.filter((m) => m.role === "guest").length,
      pendingInvites: invites.filter((i) => i.status === "pending" && i.expiresAt > now).length,
      maxMembers: o.maxMembers,
      status: standing.get(o.ownerId)?.status ?? "active",
      reason: standing.get(o.ownerId)?.reason ?? null,
    });
  }
  return { organizations, total: matches.length, offset, limit };
}

/**
 * One organization in full: members and their teams, invitation history, audit trail and usage.
 * Teamspace names are shown (they are the organization's structure); page contents never are.
 */
export async function adminOrganization(db: Db, ns: string, now: number) {
  const org = await getOrg(db, ns);
  if (!org) throw notFound("organization");
  const [members, invites, teams, events, pages, assets, moderation, sitesRows] = await Promise.all([
    db.list("orgMembers", ns),
    db.list("orgInvites", ns),
    db.list("orgTeams", ns),
    db.list("orgEvents", ns),
    db.list("pages", ns),
    db.list("assets", ns),
    db.list("moderation", ns),
    db.list("sites", ns),
  ]);
  const live = pages.filter((p) => !p.archivedAt && !p.isTemplate);
  return {
    org: { id: ns, name: org.name, slug: org.slug, icon: org.icon, description: org.description, createdAt: org.createdAt, updatedAt: org.updatedAt, createdBy: org.createdBy, policies: org.policies, maxMembers: org.maxMembers, status: moderation[0]?.status ?? "active", reason: moderation[0]?.reason ?? null },
    members: members
      .map((m) => ({ accountId: m.accountId, name: m.name, email: m.email, role: m.role, status: m.status, joinedAt: m.joinedAt, invitedBy: m.invitedBy, teams: teams.filter((t) => t.memberIds.includes(m.accountId)).map((t) => t.name) }))
      .sort((a, b) => a.joinedAt - b.joinedAt),
    teams: teams.map((t) => ({ id: t._id, name: t.name, members: t.memberIds.length, archivedAt: t.archivedAt })),
    teamspaces: live.filter((p) => p.teamspace && !p.parentId).map((p) => ({ id: p._id, title: p.title || "Untitled", icon: p.icon })),
    invitations: invites
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200)
      .map((i) => ({ id: i._id, email: i.email, role: i.role, status: i.status === "pending" && i.expiresAt <= now ? "expired" : i.status, invitedByName: i.invitedByName, createdAt: i.createdAt, resolvedAt: i.resolvedAt })),
    events: events.sort((a, b) => b.at - a.at).slice(0, 200),
    stats: {
      pages: live.filter((p) => p.kind === "page" && !p.databaseId).length,
      databases: live.filter((p) => p.kind === "database").length,
      rows: live.filter((p) => p.databaseId).length,
      trashed: pages.length - live.length,
      files: assets.length,
      storageBytes: assets.filter((a) => !a.borrowed).reduce((n, a) => n + a.size, 0),
      sites: sitesRows.length,
      shares: (await db.list("shares", ns)).length,
    },
  };
}

/** Suspends (read-only), locks (no access, sites offline) or restores an organization. */
export async function setOrgModeration(db: Db, admin: { id: string; name?: string | null }, ns: string, status: ModerationRow["status"] | "active", reason: string, now: number) {
  const org = await getOrg(db, ns);
  if (!org) throw notFound("organization");
  const why = reason.trim().slice(0, 300);
  if (status !== "active" && !why) throw new MaxError("VALIDATION", "Give a reason. The organization's members will see it.");
  for (const m of await db.list("moderation", ns)) await db.delete("moderation", m._id);
  if (status !== "active") await db.insert("moderation", { ownerId: ns, status, reason: why, by: admin.id, updatedAt: now });
  await logEvent(db, PLATFORM, admin, `org.${status === "active" ? "restored" : status}`, ns, `${org.name}${why ? `: ${why}` : ""}`, now);
  await logEvent(db, ns, { id: admin.id, name: "Max admin" }, `org.${status === "active" ? "restored" : status}`, ns, why || null, now);
  return { status };
}

/** Ownership recovery: hands the organization to one of its active members, with a recorded reason. */
export async function recoverOrgOwnership(db: Db, admin: { id: string; name?: string | null }, ns: string, nextOwnerId: string, reason: string, now: number) {
  const org = await getOrg(db, ns);
  if (!org) throw notFound("organization");
  const why = reason.trim().slice(0, 300);
  if (!why) throw new MaxError("VALIDATION", "Give a reason for the recovery.");
  const owner = (await db.list("orgMembers", ns)).find((m) => m.role === "owner") ?? null;
  await handOver(db, { id: admin.id, name: "Max admin" }, org, owner, nextOwnerId, now, "owner.recovered_by_admin", why);
  // The new owner sets their own security phrase; the old one may be why recovery was needed.
  await db.patch("orgs", org._id, { phraseHash: null, phraseSalt: null, phraseFailures: 0, phraseLockedUntil: null });
  await logEvent(db, PLATFORM, admin, "org.ownership_recovered", ns, `${org.name} → ${nextOwnerId}: ${why}`, now);
  return { ok: true };
}

export async function setOrgLimits(db: Db, admin: { id: string; name?: string | null }, ns: string, limits: { maxMembers: number | null }, now: number) {
  const org = await getOrg(db, ns);
  if (!org) throw notFound("organization");
  const max = limits.maxMembers;
  if (max !== null && (!Number.isInteger(max) || max < 1 || max > 100_000)) throw new MaxError("VALIDATION", "Use a whole number from 1 to 100,000, or no limit.");
  await db.patch("orgs", org._id, { maxMembers: max, updatedAt: now });
  await logEvent(db, PLATFORM, admin, "org.limits", ns, `${org.name}: maxMembers ${org.maxMembers ?? "default"} → ${max ?? "default"}`, now);
  return { ok: true };
}

/** Removes one member (e.g. an abusive account) from an organization. The owner can't be removed. */
export async function adminRemoveOrgMember(db: Db, admin: { id: string; name?: string | null }, ns: string, accountId: string, reason: string, now: number) {
  const org = await getOrg(db, ns);
  const member = org ? (await db.list("orgMembers", ns, { field: "accountId", value: accountId }))[0] : null;
  if (!org || !member) throw notFound("member");
  if (member.role === "owner") throw new MaxError("FORBIDDEN", "Recover ownership to someone else first.");
  const why = reason.trim().slice(0, 300);
  if (!why) throw new MaxError("VALIDATION", "Give a reason.");
  await db.delete("orgMembers", member._id);
  for (const share of await db.findBy("shares", "granteeId", accountId)) if (share.ownerId === ns) await db.delete("shares", share._id);
  for (const team of await db.list("orgTeams", ns)) if (team.memberIds.includes(accountId)) await db.patch("orgTeams", team._id, { memberIds: team.memberIds.filter((id) => id !== accountId), updatedAt: now });
  await logEvent(db, ns, { id: admin.id, name: "Max admin" }, "member.removed_by_admin", accountId, why, now);
  await logEvent(db, PLATFORM, admin, "org.member_removed", ns, `${org.name}: ${member.email ?? accountId} (${why})`, now);
  return { ok: true };
}

export async function adminDeleteOrg(db: Db, admin: { id: string; name?: string | null }, ns: string, confirmName: string, reason: string, purge: (ns: string) => Promise<number>, now: number) {
  const org = await getOrg(db, ns);
  if (!org) throw notFound("organization");
  if (confirmName.trim() !== org.name) throw new MaxError("VALIDATION", "Type the organization's name exactly to confirm.");
  const why = reason.trim().slice(0, 300);
  if (!why) throw new MaxError("VALIDATION", "Give a reason for deleting it.");
  return deleteOrganization(db, admin, org, purge, now, "platform", why);
}

/** The audit trail across Max: organization events and platform actions, newest first. */
export async function adminAudit(db: Db, filter: { scope?: string; action?: string; actor?: string; before?: number; limit?: number }) {
  const rows = filter.scope ? await db.list("orgEvents", filter.scope) : await db.listAll("orgEvents", SCAN);
  const events = filterEvents(rows, filter);
  const names = new Map<string, string>();
  for (const e of events) if (isOrgNamespace(e.ownerId) && !names.has(e.ownerId)) names.set(e.ownerId, (await getOrg(db, e.ownerId))?.name ?? "Deleted organization");
  return { events: events.map((e) => ({ ...e, scopeName: e.ownerId === PLATFORM ? "Platform" : (names.get(e.ownerId) ?? e.ownerId) })) };
}

/** Suspends (read-only), bans (no access), or restores an account. */
export async function setModeration(db: Db, adminId: string, userId: string, status: ModerationRow["status"] | "active", reason: string, now: number) {
  if (userId === adminId) throw new MaxError("VALIDATION", "You can't suspend or ban your own account.");
  if (isOrgNamespace(userId) || !(await db.list("settings", userId)).length) throw notFound("account");
  for (const m of await db.list("moderation", userId)) await db.delete("moderation", m._id);
  if (status !== "active") await db.insert("moderation", { ownerId: userId, status, reason: reason.trim().slice(0, 300), by: adminId, updatedAt: now });
  await logEvent(db, PLATFORM, { id: adminId }, `user.${status === "active" ? "restored" : status}`, userId, reason.trim().slice(0, 300) || null, now);
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
