/**
 * Connectors: apps that work with Max through its API (lib/domain/ops), with the person's
 * explicit consent, like Notion's integrations.
 *
 *  - An integration (app) is registered by a developer (any Max account) with the scopes it needs,
 *    redirect URIs for the OAuth code flow, and optionally a webhook URL and events.
 *  - A person installs it into one of their workspaces, or an organization's admin into the
 *    organization, granting a subset of its scopes. The app gets a token for that installation
 *    only (`maxi_…`), either through the OAuth code exchange or shown once for private apps.
 *  - The app's calls run through the same execute() as the UI and MCP, as a member with the
 *    granted scopes: it can never see an organization's private pages it isn't listed on, never
 *    manage accounts, tokens, sharing or billing, and never delete permanently.
 *  - Published apps are listed in the marketplace only after Max's admins approve them; a
 *    suspended app stops working everywhere at once.
 *  - Webhooks tell apps what changed (ids and event names, never content), signed with HMAC.
 */
import { MaxError, notFound } from "./errors";
import type { Db } from "./db";
import type { InstallationRow, IntegrationRow, Source } from "./types";
import { accountOf, ownerFor } from "./workspaces";
import { atLeastRole, isOrgNamespace, logEvent, memberOf, PLATFORM } from "./organizations";
import { hiddenFor } from "./orgPageAccess";

export const SCOPES = {
  read_content: { label: "Read pages and databases", hint: "Titles, content, properties and rows it can see" },
  write_content: { label: "Create and edit pages and databases", hint: "Including moving pages to the trash (never deleting permanently)" },
  read_comments: { label: "Read comments", hint: "Comments and replies on pages it can see" },
  write_comments: { label: "Write comments", hint: "Add, resolve and react to comments as the app" },
  read_people: { label: "See people", hint: "Names of people in the workspace, for assigning and mentions" },
} as const;
export type Scope = keyof typeof SCOPES;

export const EVENTS = ["page.created", "page.updated", "page.content_updated", "page.deleted", "record.created", "record.updated", "comment.created"] as const;
export type WebhookEvent = (typeof EVENTS)[number];

/** Operations apps may never call, whatever their scopes. */
const NEVER = /^(account\.|tokens\.|workspaces\.(create|update|delete)|profileCard\.|settings\.|inbox\.|shares\.|sites\.|access\.|trash\.empty|pages\.deletePermanently|export\.all|import\.|audit\.|analytics\.|teamspaces\.requestJoin|pages\.(setFavorite|moveFavorite|touch|forgetRecent))/;

/** The scope an operation needs, or null when apps can't use it at all. */
export function scopeFor(op: string, kind: "query" | "mutation"): Scope | null {
  if (NEVER.test(op) || op === "batch") return null;
  if (op === "people.list") return "read_people";
  if (op.startsWith("comments.")) return kind === "query" ? "read_comments" : "write_comments";
  return kind === "query" ? "read_content" : "write_content";
}

const LIMITS = { perAccount: 20, redirectUris: 5, installsPerWorkspace: 50 };
const CODE_TTL = 10 * 60_000;

const rand = (bytes = 24) => Array.from(globalThis.crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, "0")).join("");
export async function sha256Hex(value: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Where Max may send webhooks or redirect people: https only, a real public host name. IP
 * literals, localhost and internal names are refused, so a webhook can't be aimed at Max's own
 * network (SSRF). Redirect URIs may also be http://localhost for app development.
 */
export function safeUrl(raw: string, kind: "webhook" | "redirect"): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new MaxError("VALIDATION", `"${raw.slice(0, 80)}" isn't a full web address.`);
  }
  const host = u.hostname.toLowerCase();
  const devLocal = kind === "redirect" && u.protocol === "http:" && (host === "localhost" || host === "127.0.0.1");
  if (!devLocal) {
    if (u.protocol !== "https:") throw new MaxError("VALIDATION", "Use an https:// address.");
    if (u.username || u.password) throw new MaxError("VALIDATION", "Addresses can't contain a username or password.");
    if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[")) throw new MaxError("VALIDATION", "Use a host name, not an IP address.");
    if (host === "localhost" || !host.includes(".") || /\.(local|internal|localhost|lan|home|corp|intranet)$/.test(host)) throw new MaxError("VALIDATION", "Use a public host name.");
  }
  if (u.toString().length > 500) throw new MaxError("VALIDATION", "That address is too long.");
  return u.toString();
}

function cleanScopes(scopes: string[]): Scope[] {
  const out = [...new Set(scopes)].filter((s): s is Scope => s in SCOPES);
  if (!out.length) throw new MaxError("VALIDATION", "Pick at least one permission.");
  return out;
}

export interface IntegrationInput {
  name: string;
  description?: string;
  icon?: string | null;
  website?: string | null;
  scopes: string[];
  redirectUris?: string[];
  webhookUrl?: string | null;
  events?: string[];
}

function normalize(input: IntegrationInput) {
  const name = input.name.replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) throw new MaxError("VALIDATION", "Give the app a name.");
  const redirectUris = [...new Set((input.redirectUris ?? []).filter(Boolean).map((u) => safeUrl(u, "redirect")))];
  if (redirectUris.length > LIMITS.redirectUris) throw new MaxError("LIMIT", `Up to ${LIMITS.redirectUris} redirect addresses.`);
  return {
    name,
    description: (input.description ?? "").trim().slice(0, 600),
    icon: typeof input.icon === "string" && input.icon.length <= 64 ? input.icon : null,
    website: input.website ? safeUrl(input.website, "redirect") : null,
    scopes: cleanScopes(input.scopes),
    redirectUris,
    webhookUrl: input.webhookUrl ? safeUrl(input.webhookUrl, "webhook") : null,
    events: [...new Set(input.events ?? [])].filter((e): e is WebhookEvent => (EVENTS as readonly string[]).includes(e)),
  };
}

const publicView = (i: IntegrationRow) => ({ id: i._id, name: i.name, description: i.description, icon: i.icon, website: i.website, scopes: i.scopes, events: i.events, status: i.status, installs: i.installs ?? 0 });

/* ── Developers ──────────────────────────────────────────────────────────── */

export async function createIntegration(db: Db, accountId: string, input: IntegrationInput, now: number) {
  const mine = await db.list("integrations", accountId);
  if (mine.length >= LIMITS.perAccount) throw new MaxError("LIMIT", `You can register up to ${LIMITS.perAccount} apps.`);
  const clientSecret = `maxs_${rand(24)}`;
  const signingSecret = `whsec_${rand(24)}`;
  const row = { ownerId: accountId, ...normalize(input), clientSecretHash: await sha256Hex(clientSecret), signingSecret, status: "private" as const, reviewNote: null, installs: 0, createdAt: now, updatedAt: now };
  const id = await db.insert("integrations", row);
  // Secrets are shown once; Max keeps only a hash of the client secret.
  return { integration: { ...publicView({ _id: id, ...row }), redirectUris: row.redirectUris, webhookUrl: row.webhookUrl }, clientId: id, clientSecret, signingSecret };
}

async function ownIntegration(db: Db, accountId: string, id: string) {
  const i = await db.get("integrations", id);
  if (!i || i.ownerId !== accountId) throw notFound("app");
  return i;
}

export async function updateIntegration(db: Db, accountId: string, id: string, input: IntegrationInput, now: number) {
  const i = await ownIntegration(db, accountId, id);
  const next = normalize(input);
  // A published app that asks for more needs review again; existing installs keep what they granted.
  const widened = next.scopes.some((s) => !i.scopes.includes(s as Scope));
  const status = i.status === "published" && widened ? "submitted" : i.status;
  await db.patch("integrations", i._id, { ...next, status, updatedAt: now });
  return { status };
}

export async function rotateSecrets(db: Db, accountId: string, id: string, now: number) {
  const i = await ownIntegration(db, accountId, id);
  const clientSecret = `maxs_${rand(24)}`;
  const signingSecret = `whsec_${rand(24)}`;
  await db.patch("integrations", i._id, { clientSecretHash: await sha256Hex(clientSecret), signingSecret, updatedAt: now });
  return { clientSecret, signingSecret };
}

export async function submitIntegration(db: Db, accountId: string, id: string, now: number) {
  const i = await ownIntegration(db, accountId, id);
  if (i.status === "suspended") throw new MaxError("FORBIDDEN", "This app was suspended by Max's admins.");
  if (!i.description || i.description.length < 20) throw new MaxError("VALIDATION", "Describe what the app does (at least 20 characters) before submitting it.");
  await db.patch("integrations", i._id, { status: "submitted", reviewNote: null, updatedAt: now });
  await logEvent(db, PLATFORM, { id: accountId }, "app.submitted", i._id, i.name, now);
  return { status: "submitted" };
}

export async function deleteIntegration(db: Db, accountId: string, id: string, now: number) {
  const i = await ownIntegration(db, accountId, id);
  for (const inst of await db.findBy("installations", "integrationId", i._id)) await db.delete("installations", inst._id);
  await db.delete("integrations", i._id);
  await logEvent(db, PLATFORM, { id: accountId }, "app.deleted", i._id, i.name, now);
  return { ok: true };
}

export async function myIntegrations(db: Db, accountId: string) {
  return { apps: (await db.list("integrations", accountId)).map((i) => ({ ...publicView(i), redirectUris: i.redirectUris, webhookUrl: i.webhookUrl, reviewNote: i.reviewNote, clientId: i._id })) };
}

/* ── Marketplace and review ──────────────────────────────────────────────── */

export async function marketplace(db: Db, accountId: string) {
  const published = (await db.findBy("integrations", "status", "published")).map(publicView);
  const own = (await db.list("integrations", accountId)).filter((i) => i.status !== "published").map((i) => ({ ...publicView(i), yours: true }));
  return { apps: [...published.sort((a, b) => b.installs - a.installs || a.name.localeCompare(b.name)), ...own] };
}

export async function appInfo(db: Db, id: string, accountId: string) {
  const i = await db.get("integrations", id);
  if (!i || (i.status !== "published" && i.ownerId !== accountId)) throw notFound("app");
  // Registered redirect addresses are public: the consent page uses them to refuse foreign ones.
  return { app: publicView(i), redirectUris: i.redirectUris, scopes: i.scopes.map((s) => ({ scope: s, ...SCOPES[s as Scope] })) };
}

export async function reviewQueue(db: Db) {
  const rows = [...(await db.findBy("integrations", "status", "submitted")), ...(await db.findBy("integrations", "status", "published")), ...(await db.findBy("integrations", "status", "suspended"))];
  return { apps: rows.map((i) => ({ ...publicView(i), developer: i.ownerId, redirectUris: i.redirectUris, webhookUrl: i.webhookUrl, reviewNote: i.reviewNote, updatedAt: i.updatedAt })) };
}

export async function reviewIntegration(db: Db, admin: { id: string; name?: string | null }, id: string, decision: "published" | "rejected" | "suspended", note: string, now: number) {
  const i = await db.get("integrations", id);
  if (!i) throw notFound("app");
  if (decision !== "published" && !note.trim()) throw new MaxError("VALIDATION", "Tell the developer why.");
  await db.patch("integrations", i._id, { status: decision, reviewNote: note.trim().slice(0, 500) || null, updatedAt: now });
  await logEvent(db, PLATFORM, admin, `app.${decision}`, i._id, `${i.name}${note ? `: ${note}` : ""}`, now);
  return { status: decision };
}

/* ── Installing ──────────────────────────────────────────────────────────── */

/** Which namespace a person may install into: their own workspace, or an organization they administer. */
export async function installTarget(db: Db, accountId: string, workspace: string | null): Promise<string> {
  if (workspace && isOrgNamespace(workspace)) {
    const m = await memberOf(db, workspace, accountId);
    if (!m || m.status !== "active" || !atLeastRole(m.role, "admin")) throw new MaxError("FORBIDDEN", "Only an organization's admins can connect apps to it.");
    return workspace;
  }
  if (!workspace) return accountId;
  const row = (await db.list("settings", accountId))[0];
  if (!row?.workspaces?.some((w) => w.id === workspace)) throw notFound("workspace");
  return ownerFor(accountId, workspace);
}

export async function install(db: Db, actor: { id: string; name: string }, input: { appId: string; workspace: string | null; scopes: string[]; redirectUri?: string | null; state?: string | null }, now: number) {
  const app = await db.get("integrations", input.appId);
  if (!app || (app.status !== "published" && app.ownerId !== actor.id)) throw notFound("app");
  const ns = await installTarget(db, actor.id, input.workspace);
  const scopes = cleanScopes(input.scopes).filter((s) => app.scopes.includes(s));
  if (!scopes.length) throw new MaxError("VALIDATION", "Grant at least one of the permissions the app asks for.");
  if ((await db.list("installations", ns)).filter((x) => !x.revokedAt).length >= LIMITS.installsPerWorkspace) throw new MaxError("LIMIT", "This workspace has too many connected apps.");
  const base = { ownerId: ns, integrationId: app._id, installedBy: actor.id, scopes, revokedAt: null, lastUsedAt: null, createdAt: now };
  await logEvent(db, isOrgNamespace(ns) ? ns : PLATFORM, actor, "app.installed", app._id, `${app.name}: ${scopes.join(", ")}`, now);
  await db.patch("integrations", app._id, { installs: (app.installs ?? 0) + 1 });
  if (input.redirectUri) {
    if (!app.redirectUris.includes(input.redirectUri)) throw new MaxError("VALIDATION", "That redirect address isn't registered for this app.");
    const code = `maxc_${rand(20)}`;
    await db.insert("installations", { ...base, tokenHash: null, tokenPrefix: null, codeHash: await sha256Hex(code), codeExpiresAt: now + CODE_TTL, redirectUri: input.redirectUri });
    const url = new URL(input.redirectUri);
    url.searchParams.set("code", code);
    if (input.state) url.searchParams.set("state", input.state.slice(0, 200));
    return { redirect: url.toString() };
  }
  const token = `maxi_${rand(24)}`;
  await db.insert("installations", { ...base, tokenHash: await sha256Hex(token), tokenPrefix: token.slice(0, 10), codeHash: null, codeExpiresAt: null, redirectUri: null });
  return { token };
}

/** OAuth code exchange: the app's server trades a one-time code (10 minutes) for its token. */
export async function exchangeCode(db: Db, input: { clientId: string; clientSecret: string; code: string; redirectUri?: string | null }, now: number) {
  const app = await db.get("integrations", input.clientId);
  const fail = () => new MaxError("UNAUTHENTICATED", "Invalid client or code.");
  if (!app || app.status === "suspended" || (await sha256Hex(input.clientSecret)) !== app.clientSecretHash) throw fail();
  const inst = (await db.findBy("installations", "codeHash", await sha256Hex(input.code)))[0];
  if (!inst || inst.integrationId !== app._id || inst.revokedAt || !inst.codeExpiresAt || inst.codeExpiresAt < now) throw fail();
  if (input.redirectUri && input.redirectUri !== inst.redirectUri) throw fail();
  const token = `maxi_${rand(24)}`;
  await db.patch("installations", inst._id, { tokenHash: await sha256Hex(token), tokenPrefix: token.slice(0, 10), codeHash: null, codeExpiresAt: null });
  return { access_token: token, token_type: "bearer", workspace: isOrgNamespace(inst.ownerId) ? inst.ownerId : null, scopes: inst.scopes };
}

export async function installedApps(db: Db, ns: string) {
  const out = [];
  for (const inst of await db.list("installations", ns)) {
    if (inst.revokedAt) continue;
    const app = await db.get("integrations", inst.integrationId);
    out.push({ id: inst._id, app: app ? publicView(app) : null, scopes: inst.scopes, connected: !!inst.tokenHash, installedBy: inst.installedBy, createdAt: inst.createdAt, lastUsedAt: inst.lastUsedAt });
  }
  return { installations: out };
}

export async function revokeInstallation(db: Db, actor: { id: string; name?: string | null }, installationId: string, now: number) {
  const inst = await db.get("installations", installationId);
  if (!inst) throw notFound("connection");
  const owner: string = inst.ownerId;
  const ws = owner.startsWith("org_") ? owner : owner.includes("~") ? owner.split("~")[1] : null;
  if ((await installTarget(db, actor.id, ws)) !== owner) throw notFound("connection");
  await db.patch("installations", inst._id, { revokedAt: now, tokenHash: null, codeHash: null });
  await logEvent(db, isOrgNamespace(inst.ownerId) ? inst.ownerId : PLATFORM, actor, "app.disconnected", inst.integrationId, null, now);
  return { ok: true };
}

/* ── Running as an app ───────────────────────────────────────────────────── */

export interface AppCaller {
  ownerId: string;
  installationId: string;
  scopes: Scope[];
  actor: { id: string; name: string; image: string | null };
  source: Source;
}

/** Resolves an app token; null for unknown, revoked, or suspended apps (and if its installer left). */
export async function appForToken(db: Db, token: string): Promise<AppCaller | null> {
  if (!/^maxi_[a-f0-9]{48}$/.test(token)) return null;
  const inst = (await db.findBy("installations", "tokenHash", await sha256Hex(token)))[0];
  if (!inst || inst.revokedAt) return null;
  const app = await db.get("integrations", inst.integrationId);
  if (!app || app.status === "suspended" || app.status === "rejected") return null;
  // An org app stays only while the admin who connected it is still an admin.
  if (isOrgNamespace(inst.ownerId)) {
    const m = await memberOf(db, inst.ownerId, inst.installedBy);
    if (!m || m.status !== "active" || !atLeastRole(m.role, "admin")) return null;
  } else if (accountOf(inst.ownerId) !== inst.installedBy) return null;
  return { ownerId: inst.ownerId, installationId: inst._id, scopes: inst.scopes as Scope[], actor: { id: `app:${app._id}`, name: app.name, image: null }, source: "app" };
}

/* ── Webhooks ────────────────────────────────────────────────────────────── */

const EVENT_OF: Record<string, { event: WebhookEvent; id: (args: Record<string, unknown>, result: Record<string, unknown>) => unknown }> = {
  "pages.create": { event: "page.created", id: (_a, r) => (r.page as { _id?: string } | undefined)?._id },
  "pages.update": { event: "page.updated", id: (a) => a.id },
  "documents.save": { event: "page.content_updated", id: (a) => a.pageId },
  "documents.writeMarkdown": { event: "page.content_updated", id: (a) => a.pageId },
  "pages.archive": { event: "page.deleted", id: (a) => a.id },
  "records.create": { event: "record.created", id: (_a, r) => (r.record as { _id?: string } | undefined)?._id },
  "records.update": { event: "record.updated", id: (a) => a.id },
  "comments.add": { event: "comment.created", id: (a) => a.pageId },
};

/**
 * Queues webhook deliveries for a successful change, in the same transaction (a rolled-back
 * change sends nothing). Pages an app can't see (organization private pages) are never announced.
 */
export async function queueEvents(db: Db, ns: string, op: string, args: unknown, result: unknown, now: number, actorName: string | null): Promise<number> {
  const map = EVENT_OF[op];
  if (!map) return 0;
  const installs = (await db.list("installations", ns)).filter((i) => i.tokenHash && !i.revokedAt);
  if (!installs.length) return 0;
  const pageId = map.id((args ?? {}) as Record<string, unknown>, (result ?? {}) as Record<string, unknown>);
  if (typeof pageId !== "string") return 0;
  let queued = 0;
  for (const inst of installs) {
    const app = await db.get("integrations", inst.integrationId);
    if (!app?.webhookUrl || app.status === "suspended" || !app.events.includes(map.event)) continue;
    if (isOrgNamespace(ns)) {
      const v = await hiddenFor(db, ns, `app:${app._id}`, "member");
      if (v && (await v.hidden(pageId))) continue;
    }
    const payload = JSON.stringify({ event: map.event, id: `evt_${rand(10)}`, at: new Date(now).toISOString(), workspace: isOrgNamespace(ns) ? ns : null, pageId, actor: actorName });
    await db.insert("webhookDeliveries", { ownerId: ns, installationId: inst._id, integrationId: app._id, event: map.event, payload, status: "pending", attempts: 0, nextAt: now, lastError: null, createdAt: now });
    queued++;
  }
  return queued;
}

export const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3600_000];

/** HMAC-SHA256 over `<timestamp>.<body>`, sent as `Max-Signature: t=<timestamp>,v1=<hex>`. */
export async function signPayload(secret: string, timestamp: number, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  return `t=${timestamp},v1=${Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Sends one delivery. Never follows redirects (they could point anywhere); 10-second timeout. */
export async function sendWebhook(url: string, secret: string, body: string, now: number): Promise<{ ok: boolean; error: string | null }> {
  try {
    safeUrl(url, "webhook");
    const res = await fetch(url, { method: "POST", redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "Content-Type": "application/json", "User-Agent": "Max-Webhooks/1", "Max-Signature": await signPayload(secret, Math.floor(now / 1000), body) }, body });
    return res.ok ? { ok: true, error: null } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : "Failed" };
  }
}

/** Delivers due webhooks with retries (1 min, 5 min, 30 min, 2 h), then gives up and records why. */
export async function deliverDue(db: Db, now: number, limit = 25) {
  const due = (await db.findBy("webhookDeliveries", "status", "pending")).filter((d) => d.nextAt <= now).slice(0, limit);
  for (const d of due) {
    const app = await db.get("integrations", d.integrationId);
    if (!app?.webhookUrl || app.status === "suspended") {
      await db.patch("webhookDeliveries", d._id, { status: "failed", lastError: "App unavailable" });
      continue;
    }
    const r = await sendWebhook(app.webhookUrl, app.signingSecret, d.payload, now);
    const attempts = d.attempts + 1;
    if (r.ok) await db.patch("webhookDeliveries", d._id, { status: "delivered", attempts, lastError: null });
    else await db.patch("webhookDeliveries", d._id, { status: attempts > RETRY_MS.length ? "failed" : "pending", attempts, nextAt: now + (RETRY_MS[attempts - 1] ?? 0), lastError: r.error });
  }
  return { sent: due.length };
}

export type { IntegrationRow, InstallationRow };
