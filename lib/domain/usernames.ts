import { MaxError } from "./errors";
import type { Db } from "./db";
import { profileCardSchema, defaultProfileCard, type ProfileCard } from "./profileCard";
import { accountOf } from "./workspaces";

/**
 * Usernames: max.chaos.fail/<username> is a person's invite link. Lowercase letters, digits,
 * dots and underscores, 3–20 characters, unique, and never the name of one of Max's own pages.
 */
export const USERNAME = /^[a-z0-9](?:[a-z0-9._]{1,18})[a-z0-9]$/;

export const RESERVED_USERNAMES = new Set([
  "home", "p", "s", "site", "sites", "join", "welcome", "privacy", "connect", "admin", "api", "mcp", "trash", "templates", "graph",
  "settings", "sign-in", "signin", "sign-up", "signup", "login", "logout", "w", "max", "help", "support", "about", "terms", "app",
  "www", "static", "assets", "favicon", "robots", "sitemap", "manifest", "icon", "offline", "covers", "textures", "screenshots",
  "invite", "invites", "u", "user", "users", "me", "you", "team", "teams", "workspace", "workspaces", "pages", "page", "new",
  "search", "share", "shared", "public", "root", "system", "official", "staff", "moderator", "security", "status", "blog", "docs",
]);

export function usernameProblem(name: string): string | null {
  if (!USERNAME.test(name) || name.includes("..")) return "Use 3–20 lowercase letters, numbers, dots or underscores, starting and ending with a letter or number.";
  if (RESERVED_USERNAMES.has(name)) return "That one's taken by Max itself. Try another.";
  return null;
}

export async function usernameOf(db: Db, ownerId: string): Promise<string | null> {
  return (await db.list("usernames", accountOf(ownerId)))[0]?.username ?? null;
}

async function taken(db: Db, name: string, account: string) {
  if ((await db.findBy("sites", "slug", name)).some((s) => s.root)) return true; // a top-level site's address
  return (await db.findBy("usernames", "username", name)).some((r) => r.ownerId !== account);
}

/** Sets (or changes) an account's username. */
export async function setUsername(db: Db, ownerId: string, wanted: string, now: number): Promise<string> {
  const account = accountOf(ownerId);
  const name = wanted.trim().toLowerCase().replace(/^@/, "");
  const problem = usernameProblem(name);
  if (problem) throw new MaxError("VALIDATION", problem);
  if (await taken(db, name, account)) throw new MaxError("CONFLICT", `“${name}” is taken. Try another.`);
  const mine = await db.list("usernames", account);
  if (mine[0]) await db.patch("usernames", mine[0]._id, { username: name });
  else await db.insert("usernames", { ownerId: account, username: name, createdAt: now });
  for (const extra of mine.slice(1)) await db.delete("usernames", extra._id);
  return name;
}

/** Gives an account a username from its name (or email) if it has none: omar, then omar2, omar3… */
export async function ensureUsername(db: Db, ownerId: string, hint: { name?: string | null; email?: string | null }, now: number): Promise<string> {
  const existing = await usernameOf(db, ownerId);
  if (existing) return existing;
  const fromName = (hint.name ?? "").normalize("NFKD").toLowerCase().split(/\s+/)[0]?.replace(/[^a-z0-9]/g, "") ?? "";
  const fromEmail = (hint.email ?? "").split("@")[0].toLowerCase().replace(/[^a-z0-9._]/g, "").replace(/^[._]+|[._]+$/g, "");
  let base = (fromName.length >= 3 ? fromName : fromEmail.length >= 3 ? fromEmail : "member").slice(0, 17);
  if (RESERVED_USERNAMES.has(base)) base = `${base}.max`.slice(0, 17);
  for (let n = 1; n < 10_000; n++) {
    const candidate = n === 1 ? base : `${base}${n}`;
    if (!usernameProblem(candidate) && !(await taken(db, candidate, accountOf(ownerId)))) return setUsername(db, ownerId, candidate, now);
  }
  throw new MaxError("CONFLICT", "Couldn't pick a username. Choose one in Settings → My account.");
}

export interface PublicProfile {
  username: string;
  name: string;
  memberNumber: number | null;
  card: ProfileCard;
}

/**
 * What an invite link shows to anyone: the person's name, member number and card artwork.
 * Nothing else about the account is public. Banned accounts have no invite page.
 */
export async function profileByUsername(db: Db, wanted: string): Promise<PublicProfile | null> {
  const name = wanted.trim().toLowerCase();
  if (!USERNAME.test(name)) return null;
  const row = (await db.findBy("usernames", "username", name))[0];
  if (!row) return null;
  if ((await db.list("moderation", row.ownerId)).some((m) => m.status === "banned")) return null;
  const settings = (await db.list("settings", row.ownerId))[0];
  const display = settings?.displayName?.trim() || name;
  const saved = profileCardSchema.safeParse(settings?.profileCard);
  const memberNumber = await db.memberNumber(row.ownerId);
  const card = { ...(saved.success ? saved.data : defaultProfileCard(display)), name: display, createdAt: settings?.joinedAt, memberNumber: memberNumber ?? undefined };
  return { username: name, name: display, memberNumber, card };
}

/** The username of a published site's owner (sites live at /<username>/<slug>), or null. */
export async function siteHandle(db: Db, slug: string): Promise<string | null> {
  const site = (await db.findBy("sites", "slug", slug.toLowerCase()))[0];
  return site ? usernameOf(db, site.ownerId) : null;
}

/** Whether a slug is a top-level site (max.chaos.fail/<slug>), published by one of Max's admins. */
export async function isRootSite(db: Db, slug: string): Promise<boolean> {
  return (await db.findBy("sites", "slug", slug.toLowerCase())).some((s) => s.root);
}
