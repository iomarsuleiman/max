/**
 * Organizations: shared workspaces that several Max accounts belong to.
 *
 * An organization is a content namespace, `org_<id>`, exactly like a personal workspace is
 * `<account>` or `<account>~<id>`. Its pages, databases, files, history and published sites
 * carry that ownerId, so every existing operation (editor, search, graph, files, MCP) works
 * unchanged and stays isolated from every other namespace by the same ownership checks.
 *
 * Who may act in the namespace is decided here, from server-verified identity only:
 *   - owner   one per organization; everything, including ownership transfer and deletion
 *   - admin   members, invitations, teams, policies, audit log; not other admins or the owner
 *   - member  reads and edits the organization's content
 *   - guest   no access to the namespace at all: only to the pages explicitly shared with them
 * A suspended membership grants nothing. Membership is re-read on every request, so removing
 * someone takes effect on their very next call (editor saves, live rooms, files, MCP included).
 */
import { MaxError, notFound } from "./errors";
import type { Db } from "./db";
import type { OrgEventRow, OrgInviteRow, OrgMemberRow, OrgPolicies, OrgRole, OrgRow, OrgTeamRow } from "./types";
import { retainsWorkspaceOwner } from "./workspacePolicy";

export const ORG_PREFIX = "org_";
export const ORG_NAMESPACE = /^org_[a-z0-9]{10}$/;
export const PLATFORM = "platform";

export const ORG_LIMITS = {
  ownedPerAccount: 10,
  membershipsPerAccount: 50,
  members: 1000,
  pendingInvites: 500,
  invitesPerCall: 50,
  teams: 100,
  teamMembers: 500,
  inviteDays: 14,
};

export const DEFAULT_POLICIES: OrgPolicies = { membersCanInvite: false, allowGuests: true, allowPublicLinks: false, allowSites: false };

const RANK: Record<OrgRole, number> = { guest: 0, member: 1, admin: 2, owner: 3 };
export const atLeastRole = (role: OrgRole, min: OrgRole) => RANK[role] >= RANK[min];

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

/** The signed-in person, as verified by the auth provider (never by the browser). */
export interface OrgActor {
  id: string;
  name: string;
  image: string | null;
  email: string | null;
  emailVerified: boolean;
}

/** Kill switch: MAX_ORGANIZATIONS=off hides organizations everywhere without touching their data. */
export const organizationsEnabled = () => (typeof process === "undefined" ? true : process.env.MAX_ORGANIZATIONS !== "off");

export const isOrgNamespace = (ownerId: string | null | undefined): ownerId is string => !!ownerId && ORG_NAMESPACE.test(ownerId);

function newNamespace(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return ORG_PREFIX + Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

export function normalizeEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) throw new MaxError("VALIDATION", `"${raw.trim().slice(0, 80)}" isn't a full email address.`);
  return email;
}

function cleanName(raw: string, what = "name", max = 80): string {
  const name = raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  if (!name) throw new MaxError("VALIDATION", `Give it a ${what}.`);
  return name;
}

function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/* ── Lookups ──────────────────────────────────────────────────────────────── */

export async function getOrg(db: Db, ns: string): Promise<OrgRow | null> {
  if (!isOrgNamespace(ns)) return null;
  return (await db.list("orgs", ns))[0] ?? null;
}

export async function memberOf(db: Db, ns: string, accountId: string): Promise<OrgMemberRow | null> {
  if (!isOrgNamespace(ns) || !accountId) return null;
  return (await db.list("orgMembers", ns, { field: "accountId", value: accountId }))[0] ?? null;
}

/** Platform moderation of the organization itself (suspended: read-only, banned: locked). */
async function orgStanding(db: Db, ns: string) {
  return (await db.list("moderation", ns))[0]?.status ?? "active";
}

/**
 * Whether `accountId` may use the organization's namespace, and as what. Null for anyone who
 * isn't an active, non-guest member of an existing, unlocked organization.
 */
export async function orgAccess(db: Db, accountId: string, ns: string): Promise<{ org: OrgRow; member: OrgMemberRow } | null> {
  if (!isOrgNamespace(ns)) return null;
  const [org, member] = await Promise.all([getOrg(db, ns), memberOf(db, ns, accountId)]);
  if (!org || !member || member.status !== "active" || member.role === "guest") return null;
  return { org, member };
}

/** The organization (and the caller's membership), or a uniform "not found" for non-members. */
async function requireRole(db: Db, actor: OrgActor, ns: string, min: OrgRole, write = false) {
  const [org, member] = await Promise.all([getOrg(db, ns), memberOf(db, ns, actor.id)]);
  if (!org || !member) throw notFound("organization");
  const standing = await orgStanding(db, ns);
  if (standing === "banned") throw new MaxError("FORBIDDEN", "This organization has been locked by Max's admins.");
  if (member.status !== "active") throw new MaxError("FORBIDDEN", "Your membership in this organization is suspended. Ask an admin to restore it.");
  if (!atLeastRole(member.role, min)) throw new MaxError("FORBIDDEN", min === "owner" ? "Only the organization's owner can do that." : min === "admin" ? "Only the organization's admins can do that." : "Guests can only open the pages shared with them.");
  if (write && standing === "suspended") throw new MaxError("FORBIDDEN", "This organization is read-only right now.");
  return { org, member };
}

/** Tells someone about a change to their membership (removed people get it without the org link). */
async function notifyMember(db: Db, accountId: string, ns: string, actor: { id: string; name?: string | null }, title: string, now: number, keepScope = true) {
  const { notify } = await import("./notifications");
  await notify(db, [accountId], { kind: "membership", ownerId: keepScope ? ns : null, pageId: null, actor, title }, now);
}

export async function logEvent(db: Db, scope: string, actor: { id: string; name?: string | null }, action: string, targetId: string | null, detail: string | null, now: number) {
  await db.insert("orgEvents", { ownerId: scope, actorId: actor.id, actorName: actor.name?.slice(0, 120) ?? null, action, targetId, detail: detail?.slice(0, 500) ?? null, at: now });
}

const live = (i: OrgInviteRow, now: number) => i.status === "pending" && i.expiresAt > now;

/* ── Your organizations ───────────────────────────────────────────────────── */

/**
 * Organizations start switched off for every account. Max's platform admins switch them on per
 * account (Admin → Users); with it on, the account can create organizations and run them. Being
 * invited into someone's organization doesn't need it: joining is the inviter's decision.
 */
export async function canCreateOrganizations(db: Db, accountId: string): Promise<boolean> {
  return organizationsEnabled() && !!(await db.list("accountFeatures", accountId))[0]?.organizations;
}

export async function setAccountOrganizations(db: Db, admin: { id: string; name?: string | null }, accountId: string, on: boolean, now: number) {
  if (!accountId || isOrgNamespace(accountId)) throw notFound("account");
  const row = (await db.list("accountFeatures", accountId))[0];
  if (row) await db.patch("accountFeatures", row._id, { organizations: on, by: admin.id, updatedAt: now });
  else await db.insert("accountFeatures", { ownerId: accountId, organizations: on, by: admin.id, updatedAt: now });
  await logEvent(db, PLATFORM, admin, on ? "user.organizations_on" : "user.organizations_off", accountId, null, now);
  return { organizations: on };
}

export async function myOrganizations(db: Db, actor: OrgActor, now: number) {
  const memberships = await db.findBy("orgMembers", "accountId", actor.id);
  const organizations = [];
  for (const m of memberships) {
    const org = await getOrg(db, m.ownerId);
    if (!org) continue;
    organizations.push({ id: org.ownerId, name: org.name, icon: org.icon, slug: org.slug, role: m.role, status: m.status, standing: await orgStanding(db, org.ownerId) });
  }
  organizations.sort((a, b) => a.name.localeCompare(b.name));
  return { canCreate: await canCreateOrganizations(db, actor.id), organizations, invitations: await myInvitations(db, actor, now), joinable: await joinableByDomain(db, actor) };
}

/** Pending invitations for the caller's verified email. Unverified emails see none. */
export async function myInvitations(db: Db, actor: OrgActor, now: number) {
  if (!actor.email || !actor.emailVerified) return [];
  const email = actor.email.trim().toLowerCase();
  const out = [];
  for (const invite of await db.findBy("orgInvites", "email", email)) {
    if (!live(invite, now)) continue;
    const org = await getOrg(db, invite.ownerId);
    if (!org || (await orgStanding(db, org.ownerId)) === "banned") continue;
    if (await memberOf(db, org.ownerId, actor.id)) continue;
    out.push({ id: invite._id, orgId: org.ownerId, orgName: org.name, orgIcon: org.icon, role: invite.role, invitedByName: invite.invitedByName, createdAt: invite.createdAt, expiresAt: invite.expiresAt });
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function createOrganization(db: Db, actor: OrgActor, input: { name: string; icon?: string | null; description?: string }, now: number) {
  if (!(await canCreateOrganizations(db, actor.id))) throw new MaxError("FORBIDDEN", "Organizations aren't switched on for your account yet. Ask Max's admins.");
  const name = cleanName(input.name);
  const memberships = await db.findBy("orgMembers", "accountId", actor.id);
  if (memberships.length >= ORG_LIMITS.membershipsPerAccount) throw new MaxError("LIMIT", `You can belong to up to ${ORG_LIMITS.membershipsPerAccount} organizations.`);
  if (memberships.filter((m) => m.role === "owner").length >= ORG_LIMITS.ownedPerAccount) throw new MaxError("LIMIT", `You can own up to ${ORG_LIMITS.ownedPerAccount} organizations.`);
  const ns = newNamespace();
  const base = slugify(name) || "org";
  let slug = base.length >= 3 ? base : `${base}-org`;
  if ((await db.findBy("orgs", "slug", slug)).length) slug = `${slug.slice(0, 33)}-${ns.slice(-6)}`;
  const icon = typeof input.icon === "string" && input.icon.length <= 64 ? input.icon : null;
  await db.insert("orgs", { ownerId: ns, name, slug, icon, description: (input.description ?? "").trim().slice(0, 500), createdBy: actor.id, createdAt: now, updatedAt: now, policies: { ...DEFAULT_POLICIES }, maxMembers: null });
  await db.insert("orgMembers", { ownerId: ns, accountId: actor.id, role: "owner", status: "active", name: actor.name, email: actor.email?.toLowerCase() ?? null, image: actor.image, invitedBy: null, joinedAt: now, updatedAt: now });
  await logEvent(db, ns, actor, "org.created", ns, name, now);
  return { id: ns, name, slug };
}

/** What a member sees on the organization's settings page; admins also get invitations, policies and stats. */
export async function organizationDetails(db: Db, actor: OrgActor, ns: string, now: number) {
  const { org, member } = await requireRole(db, actor, ns, "member");
  const admin = atLeastRole(member.role, "admin");
  const [members, teams] = await Promise.all([db.list("orgMembers", ns), db.list("orgTeams", ns)]);
  const teamsOf = (id: string) => teams.filter((t) => !t.archivedAt && t.memberIds.includes(id)).map((t) => t._id);
  const base = {
    org: { id: ns, name: org.name, slug: org.slug, icon: org.icon, description: org.description, createdAt: org.createdAt, policies: org.policies, maxMembers: org.maxMembers, standing: await orgStanding(db, ns) },
    me: { accountId: actor.id, role: member.role },
    security: member.role === "owner" ? { phraseSet: !!org.phraseHash } : null,
    members: members
      .map((m) => ({ accountId: m.accountId, name: m.name, email: admin ? m.email : null, image: m.image, role: m.role, status: m.status, joinedAt: m.joinedAt, teams: teamsOf(m.accountId) }))
      .sort((a, b) => RANK[b.role] - RANK[a.role] || (a.name ?? "").localeCompare(b.name ?? "")),
    teams: teams
      .filter((t) => admin || !t.archivedAt)
      .map((t) => ({ id: t._id, name: t.name, description: t.description, memberIds: t.memberIds, archivedAt: t.archivedAt }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
  if (!admin) return { ...base, invitations: [], stats: null };
  const [invites, pages, assets] = await Promise.all([db.list("orgInvites", ns), db.list("pages", ns), db.list("assets", ns)]);
  const livePages = pages.filter((p) => !p.archivedAt && !p.isTemplate);
  return {
    ...base,
    invitations: invites
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 200)
      .map((i) => ({ id: i._id, email: i.email, role: i.role, status: i.status === "pending" && i.expiresAt <= now ? "expired" : i.status, invitedByName: i.invitedByName, createdAt: i.createdAt, expiresAt: i.expiresAt, resolvedAt: i.resolvedAt })),
    stats: {
      members: members.filter((m) => m.status === "active").length,
      pendingInvites: invites.filter((i) => live(i, now)).length,
      pages: livePages.filter((p) => p.kind === "page" && !p.databaseId).length,
      databases: livePages.filter((p) => p.kind === "database").length,
      teamspaces: livePages.filter((p) => p.teamspace && !p.parentId).length,
      storageBytes: assets.filter((a) => !a.borrowed).reduce((n, a) => n + a.size, 0),
    },
  };
}

export async function updateOrganization(db: Db, actor: OrgActor, ns: string, patch: { name?: string; icon?: string | null; description?: string; slug?: string }, now: number) {
  const { org } = await requireRole(db, actor, ns, "admin", true);
  const next: Partial<OrgRow> = { updatedAt: now };
  if (patch.name !== undefined) next.name = cleanName(patch.name);
  if (patch.icon !== undefined) next.icon = typeof patch.icon === "string" && patch.icon.length <= 64 ? patch.icon : null;
  if (patch.description !== undefined) next.description = patch.description.trim().slice(0, 500);
  if (patch.slug !== undefined && patch.slug !== org.slug) {
    const slug = patch.slug.trim().toLowerCase();
    if (!SLUG.test(slug)) throw new MaxError("VALIDATION", "Use 3–40 lowercase letters, numbers and dashes.");
    if ((await db.findBy("orgs", "slug", slug)).some((o) => o.ownerId !== ns)) throw new MaxError("CONFLICT", "That address is taken.");
    next.slug = slug;
  }
  await db.patch("orgs", org._id, next);
  await logEvent(db, ns, actor, "org.updated", ns, Object.keys(patch).join(", "), now);
  return { ok: true };
}

const RETENTION = [7, 14, 30, 60, 90, 180, 365];
/** Domains anyone can sign up with can't be used to auto-join (they'd admit the whole world). */
const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com", "gmx.com", "yandex.com", "mail.com", "local.max"]);

export async function setPolicies(db: Db, actor: OrgActor, ns: string, patch: Partial<OrgPolicies>, now: number) {
  const { org, member } = await requireRole(db, actor, ns, "admin", true);
  const policies: OrgPolicies = { ...org.policies };
  for (const key of ["membersCanInvite", "allowGuests", "allowPublicLinks", "allowSites"] as const) if (typeof patch[key] === "boolean") policies[key] = patch[key]!;
  for (const key of ["trashRetentionDays", "versionRetentionDays"] as const) {
    if (patch[key] === undefined) continue;
    if (patch[key] !== null && !RETENTION.includes(patch[key] as number)) throw new MaxError("VALIDATION", `Pick one of ${RETENTION.join(", ")} days, or keep forever.`);
    policies[key] = patch[key] ?? null;
  }
  if (patch.autoJoinDomain !== undefined) {
    if (member.role !== "owner") throw new MaxError("FORBIDDEN", "Only the owner can let a whole email domain join.");
    const domain = patch.autoJoinDomain?.trim().toLowerCase().replace(/^@/, "") || null;
    if (domain) {
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) || PUBLIC_DOMAINS.has(domain)) throw new MaxError("VALIDATION", "Use your company's own email domain (public ones like gmail.com aren't allowed).");
      // Only a domain the owner's own verified email belongs to: you can't claim someone else's company.
      if (!actor.emailVerified || actor.email?.toLowerCase().split("@")[1] !== domain) throw new MaxError("FORBIDDEN", `Sign in with a verified @${domain} email to use that domain.`);
    }
    policies.autoJoinDomain = domain;
  }
  // Mirrored to an indexed field so finding a domain's organizations never scans them all.
  await db.patch("orgs", org._id, { policies, joinDomain: policies.autoJoinDomain ?? null, updatedAt: now });
  const changed = (Object.keys(policies) as (keyof OrgPolicies)[]).filter((k) => policies[k] !== org.policies[k]);
  if (changed.length) await logEvent(db, ns, actor, "org.policies", ns, changed.map((k) => `${k}=${policies[k]}`).join(", "), now);
  return { policies };
}

/** Organizations your verified email's domain lets you join without an invitation. */
export async function joinableByDomain(db: Db, actor: OrgActor) {
  const domain = actor.emailVerified ? actor.email?.toLowerCase().split("@")[1] : null;
  if (!domain || PUBLIC_DOMAINS.has(domain)) return [];
  const out = [];
  for (const org of await db.findBy("orgs", "joinDomain", domain)) {
    if (org.policies.autoJoinDomain !== domain || (await memberOf(db, org.ownerId, actor.id))) continue;
    if ((await orgStanding(db, org.ownerId)) === "banned") continue;
    out.push({ orgId: org.ownerId, orgName: org.name, orgIcon: org.icon });
  }
  return out;
}

export async function joinByDomain(db: Db, actor: OrgActor, ns: string, now: number) {
  if (!(await joinableByDomain(db, actor)).some((o) => o.orgId === ns)) throw notFound("organization");
  const org = (await getOrg(db, ns))!;
  if ((await db.list("orgMembers", ns)).length >= (org.maxMembers ?? ORG_LIMITS.members)) throw new MaxError("LIMIT", "This organization is full. Ask an admin to make room.");
  await db.insert("orgMembers", { ownerId: ns, accountId: actor.id, role: "member", status: "active", name: actor.name, email: actor.email?.toLowerCase() ?? null, image: actor.image, invitedBy: null, joinedAt: now, updatedAt: now });
  await logEvent(db, ns, actor, "member.joined_by_domain", actor.id, actor.email, now);
  return { orgId: ns, name: org.name, role: "member" as const };
}

/* ── Invitations ─────────────────────────────────────────────────────────── */

export async function inviteMembers(db: Db, actor: OrgActor, ns: string, rawEmails: string[], role: Exclude<OrgRole, "owner">, now: number) {
  const { org, member } = await requireRole(db, actor, ns, "member", true);
  const isAdmin = atLeastRole(member.role, "admin");
  if (!isAdmin && !(org.policies.membersCanInvite && role === "member")) throw new MaxError("FORBIDDEN", "Only the organization's admins can invite people.");
  if (role === "admin" && member.role !== "owner") throw new MaxError("FORBIDDEN", "Only the owner can invite admins.");
  if (!["admin", "member", "guest"].includes(role)) throw new MaxError("VALIDATION", "Pick a role.");
  const emails = [...new Set(rawEmails.map(normalizeEmail))];
  if (!emails.length) throw new MaxError("VALIDATION", "Add at least one email address.");
  if (emails.length > ORG_LIMITS.invitesPerCall) throw new MaxError("LIMIT", `Invite up to ${ORG_LIMITS.invitesPerCall} people at a time.`);
  const [members, invites] = await Promise.all([db.list("orgMembers", ns), db.list("orgInvites", ns)]);
  const memberEmails = new Set(members.map((m) => m.email).filter(Boolean));
  if (invites.filter((i) => live(i, now)).length + emails.length > ORG_LIMITS.pendingInvites) throw new MaxError("LIMIT", "This organization has too many pending invitations. Revoke some first.");
  const invited: string[] = [];
  const skipped: { email: string; reason: string }[] = [];
  const expiresAt = now + ORG_LIMITS.inviteDays * 86_400_000;
  for (const email of emails) {
    if (memberEmails.has(email)) {
      skipped.push({ email, reason: "Already a member" });
      continue;
    }
    const existing = invites.find((i) => i.email === email && i.status === "pending");
    if (existing) await db.patch("orgInvites", existing._id, { role, expiresAt, createdAt: now, invitedBy: actor.id, invitedByName: actor.name });
    else await db.insert("orgInvites", { ownerId: ns, email, role, status: "pending", invitedBy: actor.id, invitedByName: actor.name, createdAt: now, expiresAt, resolvedAt: null, resolvedBy: null });
    invited.push(email);
  }
  if (invited.length) await logEvent(db, ns, actor, "invite.sent", null, `${invited.length} as ${role}: ${invited.join(", ")}`, now);
  return { invited, skipped };
}

async function inviteFor(db: Db, inviteId: string) {
  const invite = await db.get("orgInvites", inviteId);
  if (!invite || !isOrgNamespace(invite.ownerId)) throw notFound("invitation");
  return invite;
}

/** Admins manage every invitation; the person who sent one may also revoke or resend it. */
export async function revokeInvite(db: Db, actor: OrgActor, inviteId: string, now: number) {
  const invite = await inviteFor(db, inviteId);
  const { member } = await requireRole(db, actor, invite.ownerId, "member", true);
  if (!atLeastRole(member.role, "admin") && invite.invitedBy !== actor.id) throw new MaxError("FORBIDDEN", "Only admins can revoke other people's invitations.");
  if (invite.status !== "pending") throw new MaxError("CONFLICT", "That invitation was already answered.");
  await db.patch("orgInvites", invite._id, { status: "revoked", resolvedAt: now, resolvedBy: actor.id });
  await logEvent(db, invite.ownerId, actor, "invite.revoked", null, invite.email, now);
  return { ok: true };
}

export async function resendInvite(db: Db, actor: OrgActor, inviteId: string, now: number) {
  const invite = await inviteFor(db, inviteId);
  const { member } = await requireRole(db, actor, invite.ownerId, "member", true);
  if (!atLeastRole(member.role, "admin") && invite.invitedBy !== actor.id) throw new MaxError("FORBIDDEN", "Only admins can resend other people's invitations.");
  if (invite.status !== "pending") throw new MaxError("CONFLICT", "That invitation was already answered.");
  await db.patch("orgInvites", invite._id, { createdAt: now, expiresAt: now + ORG_LIMITS.inviteDays * 86_400_000 });
  await logEvent(db, invite.ownerId, actor, "invite.resent", null, invite.email, now);
  return { ok: true };
}

/** Invitations are bound to an email; only a sign-in with that VERIFIED email can answer one. */
async function ownInvite(db: Db, actor: OrgActor, inviteId: string, now: number) {
  const invite = await inviteFor(db, inviteId);
  if (!actor.emailVerified || !actor.email || actor.email.trim().toLowerCase() !== invite.email) throw notFound("invitation");
  if (invite.status !== "pending") throw new MaxError("CONFLICT", "That invitation was already answered or revoked.");
  if (invite.expiresAt <= now) throw new MaxError("CONFLICT", "That invitation has expired. Ask for a new one.");
  return invite;
}

export async function acceptInvite(db: Db, actor: OrgActor, inviteId: string, now: number) {
  const invite = await ownInvite(db, actor, inviteId, now);
  const ns = invite.ownerId;
  const org = await getOrg(db, ns);
  if (!org) throw notFound("organization");
  if ((await orgStanding(db, ns)) === "banned") throw new MaxError("FORBIDDEN", "This organization has been locked by Max's admins.");
  const existing = await memberOf(db, ns, actor.id);
  if (!existing) {
    const members = await db.list("orgMembers", ns);
    const cap = org.maxMembers ?? ORG_LIMITS.members;
    if (members.length >= cap) throw new MaxError("LIMIT", `This organization is full (${cap} members). Ask an admin to make room.`);
    if ((await db.findBy("orgMembers", "accountId", actor.id)).length >= ORG_LIMITS.membershipsPerAccount) throw new MaxError("LIMIT", `You can belong to up to ${ORG_LIMITS.membershipsPerAccount} organizations.`);
    await db.insert("orgMembers", { ownerId: ns, accountId: actor.id, role: invite.role, status: "active", name: actor.name, email: invite.email, image: actor.image, invitedBy: invite.invitedBy, joinedAt: now, updatedAt: now });
  }
  await db.patch("orgInvites", invite._id, { status: "accepted", resolvedAt: now, resolvedBy: actor.id });
  await logEvent(db, ns, actor, "member.joined", actor.id, `${invite.email} as ${existing?.role ?? invite.role}`, now);
  return { orgId: ns, name: org.name, role: existing?.role ?? invite.role };
}

export async function declineInvite(db: Db, actor: OrgActor, inviteId: string, now: number) {
  const invite = await ownInvite(db, actor, inviteId, now);
  await db.patch("orgInvites", invite._id, { status: "declined", resolvedAt: now, resolvedBy: actor.id });
  await logEvent(db, invite.ownerId, actor, "invite.declined", actor.id, invite.email, now);
  return { ok: true };
}

/* ── Members ─────────────────────────────────────────────────────────────── */

/** Owners manage everyone but themselves; admins manage members and guests only. */
async function manageable(db: Db, actor: OrgActor, ns: string, accountId: string) {
  const { org, member } = await requireRole(db, actor, ns, "admin", true);
  if (accountId === actor.id) throw new MaxError("FORBIDDEN", "You can't change your own membership here. Use Leave, or transfer ownership.");
  const target = await memberOf(db, ns, accountId);
  if (!target) throw notFound("member");
  if (target.role === "owner") throw new MaxError("FORBIDDEN", "The owner can only change through an ownership transfer.");
  if (member.role === "admin" && target.role === "admin") throw new MaxError("FORBIDDEN", "Only the owner can change admins.");
  return { org, member, target };
}

export async function setMemberRole(db: Db, actor: OrgActor, ns: string, accountId: string, role: Exclude<OrgRole, "owner">, now: number) {
  const { member, target } = await manageable(db, actor, ns, accountId);
  if (!["admin", "member", "guest"].includes(role)) throw new MaxError("VALIDATION", "Pick a role.");
  if (role === "admin" && member.role !== "owner") throw new MaxError("FORBIDDEN", "Only the owner can make someone an admin.");
  if (target.role === role) return { changed: false };
  await db.patch("orgMembers", target._id, { role, updatedAt: now });
  await logEvent(db, ns, actor, "member.role", accountId, `${target.role} → ${role}`, now);
  await notifyMember(db, accountId, ns, actor, `You're now ${role === "admin" ? "an admin" : `a ${role}`} in ${(await getOrg(db, ns))?.name ?? "the organization"}`, now);
  return { changed: true };
}

export async function setMemberStatus(db: Db, actor: OrgActor, ns: string, accountId: string, status: OrgMemberRow["status"], now: number) {
  const { target } = await manageable(db, actor, ns, accountId);
  if (status !== "active" && status !== "suspended") throw new MaxError("VALIDATION", "Pick active or suspended.");
  if (target.status === status) return { changed: false };
  await db.patch("orgMembers", target._id, { status, updatedAt: now });
  await logEvent(db, ns, actor, status === "suspended" ? "member.suspended" : "member.reactivated", accountId, null, now);
  if (status === "active") await notifyMember(db, accountId, ns, actor, `Your membership in ${(await getOrg(db, ns))?.name ?? "the organization"} was restored`, now);
  return { changed: true };
}

/** Everything a person held in the organization besides membership: team seats and page shares. */
async function clearAffiliations(db: Db, ns: string, accountId: string, now: number) {
  for (const team of await db.list("orgTeams", ns)) {
    if (team.memberIds.includes(accountId)) await db.patch("orgTeams", team._id, { memberIds: team.memberIds.filter((id) => id !== accountId), updatedAt: now });
  }
  let shares = 0;
  for (const share of await db.findBy("shares", "granteeId", accountId)) {
    if (share.ownerId === ns) {
      await db.delete("shares", share._id);
      shares++;
    }
  }
  // Presence and live-room cursors expire on their own; every live-room call re-checks access.
  return shares;
}

/**
 * Offboarding: hands someone's assigned work (Person properties on database rows) to another
 * member, so nothing is left with nobody. Pages and records stay where they are: they belong to
 * the organization, not to the person who wrote them.
 */
async function reassignWork(db: Db, ns: string, from: string, to: string | null, now: number) {
  let moved = 0;
  const pages = await db.list("pages", ns);
  const personProps = new Map(pages.filter((p) => p.kind === "database").map((d) => [d._id, (d.properties ?? []).filter((p) => p.type === "person").map((p) => p.id)]));
  for (const row of pages) {
    const props = row.databaseId ? personProps.get(row.databaseId) : null;
    if (!props?.length || !row.values) continue;
    let changed = false;
    const values = { ...row.values };
    for (const id of props) {
      const v = values[id];
      if (!Array.isArray(v) || !v.includes(from)) continue;
      values[id] = [...new Set(v.map((x) => (x === from ? to : x)).filter((x): x is string => !!x))];
      changed = true;
    }
    if (changed) {
      await db.patch("pages", row._id, { values, updatedAt: now });
      moved++;
    }
  }
  return moved;
}

export async function removeMember(db: Db, actor: OrgActor, ns: string, accountId: string, now: number, reassignTo?: string | null) {
  const { target } = await manageable(db, actor, ns, accountId);
  if (reassignTo) {
    const heir = await memberOf(db, ns, reassignTo);
    if (!heir || heir.status !== "active" || heir.accountId === accountId) throw new MaxError("VALIDATION", "Hand their work to another active member.");
  }
  const moved = reassignTo !== undefined ? await reassignWork(db, ns, accountId, reassignTo ?? null, now) : 0;
  await db.delete("orgMembers", target._id);
  const shares = await clearAffiliations(db, ns, accountId, now);
  if (moved) await logEvent(db, ns, actor, "member.work_reassigned", accountId, `${moved} rows → ${reassignTo ?? "unassigned"}`, now);
  await notifyMember(db, accountId, ns, actor, `You were removed from ${(await getOrg(db, ns))?.name ?? "an organization"}`, now, false);
  await logEvent(db, ns, actor, "member.removed", accountId, `${target.email ?? target.name ?? accountId}${shares ? `, ${shares} page shares removed` : ""}`, now);
  return { ok: true };
}

export async function leaveOrganization(db: Db, actor: OrgActor, ns: string, now: number) {
  const member = await memberOf(db, ns, actor.id);
  if (!member) throw notFound("organization");
  const members = await db.list("orgMembers", ns);
  if (!retainsWorkspaceOwner(members, actor.id, null, "revoked")) throw new MaxError("FORBIDDEN", "Transfer ownership to someone else before you leave.");
  await db.delete("orgMembers", member._id);
  await clearAffiliations(db, ns, actor.id, now);
  await logEvent(db, ns, actor, "member.left", actor.id, null, now);
  return { ok: true };
}

/* ── The owner's security phrase ─────────────────────────────────────────
 * Max accounts sign in with Google (or other providers), so there's no password to ask for again
 * before the most dangerous actions, and no email to confirm with. Instead the owner sets a
 * security phrase, stored only as a salted PBKDF2 hash. Five wrong tries lock it for 15 minutes.
 * Wrong answers are RETURNED, not thrown, so the failure count survives the transaction. */

export const PHRASE = { minLength: 12, maxTries: 5, lockMs: 15 * 60_000, iterations: 100_000 };
export type PhraseCheck = { ok: true } | { ok: false; code: "PHRASE_REQUIRED" | "WRONG_PHRASE" | "LOCKED"; message: string };

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

export async function hashPhrase(phrase: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(phrase.normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: PHRASE.iterations }, key, 256);
  return hex(bits);
}

function sameHash(a: string, b: string) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

async function checkPhrase(db: Db, org: OrgRow, phrase: string, now: number): Promise<PhraseCheck> {
  if (!org.phraseHash || !org.phraseSalt) return { ok: false, code: "PHRASE_REQUIRED", message: "Set the organization's security phrase first (Organization → General)." };
  if (org.phraseLockedUntil && org.phraseLockedUntil > now) return { ok: false, code: "LOCKED", message: "Too many wrong tries. Try again in 15 minutes." };
  if (sameHash(await hashPhrase(phrase, org.phraseSalt), org.phraseHash)) {
    if (org.phraseFailures) await db.patch("orgs", org._id, { phraseFailures: 0, phraseLockedUntil: null });
    return { ok: true };
  }
  const failures = (org.phraseFailures ?? 0) + 1;
  const locked = failures >= PHRASE.maxTries;
  await db.patch("orgs", org._id, { phraseFailures: locked ? 0 : failures, phraseLockedUntil: locked ? now + PHRASE.lockMs : null });
  await logEvent(db, org.ownerId, { id: "system", name: "Max" }, locked ? "security.phrase_locked" : "security.phrase_wrong", null, null, now);
  return { ok: false, code: locked ? "LOCKED" : "WRONG_PHRASE", message: locked ? "Too many wrong tries. Try again in 15 minutes." : `That's not the security phrase. ${PHRASE.maxTries - failures} ${PHRASE.maxTries - failures === 1 ? "try" : "tries"} left.` };
}

/** Sets or changes the phrase. Changing it needs the current one. */
export async function setSecurityPhrase(db: Db, actor: OrgActor, ns: string, input: { current?: string; next: string }, now: number): Promise<PhraseCheck> {
  const { org } = await requireRole(db, actor, ns, "owner");
  const next = input.next.trim();
  if (next.length < PHRASE.minLength || next.length > 200) throw new MaxError("VALIDATION", `Use at least ${PHRASE.minLength} characters: a short sentence only you know works well.`);
  if (next.toLowerCase().includes(org.name.toLowerCase()) && next.length < org.name.length + 8) throw new MaxError("VALIDATION", "Don't build the phrase around the organization's name.");
  if (org.phraseHash) {
    const check = await checkPhrase(db, org, input.current ?? "", now);
    if (!check.ok) return check;
  }
  const salt = hex(globalThis.crypto.getRandomValues(new Uint8Array(16)));
  await db.patch("orgs", org._id, { phraseHash: await hashPhrase(next, salt), phraseSalt: salt, phraseFailures: 0, phraseLockedUntil: null, updatedAt: now });
  await logEvent(db, ns, actor, org.phraseHash ? "security.phrase_changed" : "security.phrase_set", null, null, now);
  return { ok: true };
}

/** One owner at a time: the new owner must already be an active admin or member. */
export async function transferOwnership(db: Db, actor: OrgActor, ns: string, nextOwnerId: string, phrase: string, now: number) {
  const { org, member } = await requireRole(db, actor, ns, "owner", true);
  const check = await checkPhrase(db, org, phrase, now);
  if (!check.ok) return check;
  await handOver(db, actor, org, member, nextOwnerId, now, "owner.transferred");
  return { ok: true as const };
}

export async function handOver(db: Db, actor: { id: string; name?: string | null }, org: OrgRow, oldOwner: OrgMemberRow | null, nextOwnerId: string, now: number, action: string, reason?: string) {
  const ns = org.ownerId;
  const next = await memberOf(db, ns, nextOwnerId);
  if (!next || next.accountId === oldOwner?.accountId) throw new MaxError("VALIDATION", "Pick another active member of the organization.");
  if (next.status !== "active" || next.role === "guest" || next.role === "owner") throw new MaxError("VALIDATION", "The new owner must be an active admin or member.");
  if (oldOwner) await db.patch("orgMembers", oldOwner._id, { role: "admin", updatedAt: now });
  for (const m of await db.list("orgMembers", ns)) if (m.role === "owner" && m.accountId !== nextOwnerId && m._id !== oldOwner?._id) await db.patch("orgMembers", m._id, { role: "admin", updatedAt: now });
  await db.patch("orgMembers", next._id, { role: "owner", updatedAt: now });
  await logEvent(db, ns, actor, action, nextOwnerId, `${oldOwner?.accountId ?? "none"} → ${nextOwnerId}${reason ? ` (${reason})` : ""}`, now);
  return { ok: true };
}

/* ── Teams (departments, groups) ─────────────────────────────────────────── */

async function validMemberIds(db: Db, ns: string, ids: string[]) {
  const members = new Set((await db.list("orgMembers", ns)).map((m) => m.accountId));
  const unique = [...new Set(ids)];
  if (unique.length > ORG_LIMITS.teamMembers) throw new MaxError("LIMIT", `A team can have up to ${ORG_LIMITS.teamMembers} people.`);
  if (unique.some((id) => !members.has(id))) throw new MaxError("VALIDATION", "Teams can only include members of the organization.");
  return unique;
}

export async function createTeam(db: Db, actor: OrgActor, ns: string, input: { name: string; description?: string; memberIds?: string[] }, now: number) {
  await requireRole(db, actor, ns, "admin", true);
  const teams = await db.list("orgTeams", ns);
  if (teams.length >= ORG_LIMITS.teams) throw new MaxError("LIMIT", `An organization can have up to ${ORG_LIMITS.teams} teams.`);
  const name = cleanName(input.name, "team name", 60);
  if (teams.some((t) => !t.archivedAt && t.name.toLowerCase() === name.toLowerCase())) throw new MaxError("CONFLICT", "There's already a team with that name.");
  const memberIds = await validMemberIds(db, ns, input.memberIds ?? []);
  const id = await db.insert("orgTeams", { ownerId: ns, name, description: (input.description ?? "").trim().slice(0, 300), memberIds, archivedAt: null, createdAt: now, updatedAt: now });
  await logEvent(db, ns, actor, "team.created", id, name, now);
  return { id };
}

async function teamIn(db: Db, ns: string, teamId: string): Promise<OrgTeamRow> {
  const team = await db.get("orgTeams", teamId);
  if (!team || team.ownerId !== ns) throw notFound("team");
  return team;
}

export async function updateTeam(db: Db, actor: OrgActor, ns: string, teamId: string, patch: { name?: string; description?: string; memberIds?: string[]; archived?: boolean }, now: number) {
  await requireRole(db, actor, ns, "admin", true);
  const team = await teamIn(db, ns, teamId);
  const next: Partial<OrgTeamRow> = { updatedAt: now };
  if (patch.name !== undefined) next.name = cleanName(patch.name, "team name", 60);
  if (patch.description !== undefined) next.description = patch.description.trim().slice(0, 300);
  if (patch.memberIds !== undefined) next.memberIds = await validMemberIds(db, ns, patch.memberIds);
  if (patch.archived !== undefined) next.archivedAt = patch.archived ? now : null;
  await db.patch("orgTeams", team._id, next);
  const what = patch.archived === true ? "team.archived" : patch.archived === false ? "team.restored" : patch.memberIds ? "team.members" : "team.updated";
  await logEvent(db, ns, actor, what, team._id, next.name ?? team.name, now);
  return { ok: true };
}

/* ── Audit and deletion ──────────────────────────────────────────────────── */

export async function orgAuditLog(db: Db, actor: OrgActor, ns: string, filter: { before?: number; action?: string; limit?: number }) {
  await requireRole(db, actor, ns, "admin");
  return { events: filterEvents(await db.list("orgEvents", ns), filter) };
}

export function filterEvents(rows: OrgEventRow[], filter: { before?: number; action?: string; actor?: string; limit?: number }) {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const action = filter.action?.trim().toLowerCase();
  const actorQ = filter.actor?.trim().toLowerCase();
  return rows
    .filter((e) => (filter.before === undefined || e.at < filter.before) && (!action || e.action.includes(action)) && (!actorQ || e.actorId.toLowerCase() === actorQ || (e.actorName ?? "").toLowerCase().includes(actorQ)))
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

/**
 * Removes the organization and everything in it. `purgeContent` deletes the namespace's pages,
 * documents, files and history (the account-deletion routine, run on the namespace). The record
 * that it happened stays in the platform audit trail.
 */
export async function deleteOrganization(db: Db, actor: { id: string; name?: string | null }, org: OrgRow, purgeContent: (ns: string) => Promise<number>, now: number, scope: "owner" | "platform", reason?: string) {
  const ns = org.ownerId;
  const removed = await purgeContent(ns);
  for (const table of ["orgMembers", "orgInvites", "orgTeams", "moderation"] as const) for (const row of await db.list(table, ns)) await db.delete(table, row._id);
  for (const share of await db.list("shares", ns)) await db.delete("shares", share._id);
  await db.delete("orgs", org._id);
  await logEvent(db, PLATFORM, actor, scope === "owner" ? "org.deleted_by_owner" : "org.deleted_by_admin", ns, `${org.name}: ${removed} items${reason ? ` (${reason})` : ""}`, now);
  return { removed };
}

export async function deleteOwnOrganization(db: Db, actor: OrgActor, ns: string, phrase: string, purgeContent: (ns: string) => Promise<number>, now: number) {
  const { org } = await requireRole(db, actor, ns, "owner");
  const check = await checkPhrase(db, org, phrase, now);
  if (!check.ok) return check;
  return { ok: true as const, ...(await deleteOrganization(db, actor, org, purgeContent, now, "owner")) };
}
