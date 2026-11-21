import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { execute } from "@/lib/domain/ops";
import type { Storage } from "@/lib/domain/db";
import type { Source } from "@/lib/domain/types";

/**
 * Local mode: one private workspace stored as JSON on this machine (MAX_DATA_DIR, default .max-data).
 * Used for development and self-hosting without accounts. Never enabled in production unless
 * MAX_LOCAL_MODE=true is set explicitly.
 */
export const LOCAL_OWNER = "local";
const DIR = path.resolve(/*turbopackIgnore: true*/ process.env.MAX_DATA_DIR || ".max-data");
const FILE = path.join(DIR, "db.json");
const FILES = path.join(DIR, "files");

class FileDb extends MemoryDb {
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();
  async load() {
    if (this.loaded) return;
    this.loaded = true;
    if (existsSync(FILE)) this.restore(await readFile(FILE, "utf8"));
  }
  persist() {
    const data = this.snapshot();
    this.queue = this.queue.then(async () => {
      await mkdir(DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, FILE);
    });
    return this.queue;
  }
}

const g = globalThis as unknown as { __maxLocal?: { db: FileDb; events: EventEmitter; lock: Promise<unknown> } };
function state() {
  if (!g.__maxLocal) {
    const events = new EventEmitter();
    events.setMaxListeners(200);
    g.__maxLocal = { db: new FileDb(), events, lock: Promise.resolve() };
  }
  return g.__maxLocal;
}

export const localEvents = () => state().events;

/** The local database, loaded, for read-only public lookups (invite pages, link previews). */
export async function localDb() {
  const s = state();
  await s.db.load();
  return s.db;
}

const SAFE_ID = /^[a-z0-9]{8,40}$/;
export const localStorageAdapter: Storage = {
  async createUploadUrl() {
    const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), (b) => (b % 36).toString(36)).join("");
    return `/api/local/upload?t=${token}`;
  },
  async getUrl(storageId) {
    return SAFE_ID.test(storageId) && existsSync(path.join(FILES, storageId)) ? `/api/local/files/${storageId}` : null;
  },
  async remove(storageId) {
    if (SAFE_ID.test(storageId)) await rm(path.join(FILES, storageId), { force: true });
  },
};

export async function saveLocalFile(body: ArrayBuffer, type: string): Promise<string> {
  const id = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(20)), (b) => (b % 36).toString(36)).join("");
  await mkdir(FILES, { recursive: true });
  await writeFile(path.join(FILES, id), Buffer.from(body));
  await writeFile(path.join(FILES, `${id}.type`), type.slice(0, 100));
  return id;
}

export async function readLocalFile(id: string): Promise<{ body: Buffer; type: string } | null> {
  if (!SAFE_ID.test(id)) return null;
  const file = path.join(FILES, id);
  if (!existsSync(file)) return null;
  const type = existsSync(`${file}.type`) ? await readFile(`${file}.type`, "utf8") : "application/octet-stream";
  return { body: await readFile(file), type };
}

/** Runs an operation against the local store. Writes are serialized and atomic. */
export async function runLocal(op: string, args: unknown, source: Source, account = LOCAL_OWNER, kind?: "query" | "mutation", workspace?: string, actorName?: string) {
  const s = state();
  await s.db.load();
  const scope = await (await import("@/lib/domain/workspaces")).resolveScope(s.db, account, workspace);
  const ownerId = scope.ownerId;
  const org = scope.org ? { org: { role: scope.org.role }, actor: { id: account, name: actorName ?? scope.org.name ?? account, image: null } } : {};
  const outbox = { queued: 0 };
  const ctx = { db: s.db, storage: localStorageAdapter, ownerId, now: Date.now(), source, outbox, ...org };
  const { registry } = await import("@/lib/domain/ops");
  const def = registry.get(op);
  // Local mode has no background jobs: recurring automations catch up when the sidebar loads.
  if (op === "pages.tree" && (await s.db.listAll("schedules", 5000)).some((x) => x.nextAt <= Date.now())) {
    const { runDueSchedules } = await import("@/lib/domain/ops/automations");
    await localWriter("schedules")(() => runDueSchedules(s.db, localStorageAdapter, Date.now())).catch(() => undefined);
  }
  if (def?.kind === "query") return execute(op, args, ctx, kind);
  const run = s.lock.then(async () => {
    try {
      const result = await s.db.transaction(() => execute(op, args, ctx, kind));
      await s.db.persist();
      s.events.emit("change", { op, source });
      if (outbox.queued) void localDeliver();
      return result;
    } catch (err) {
      // The failed write rolled back; record the attempt for assistant activity (names and codes only).
      if (source === "mcp" && def) {
        const a = (args ?? {}) as Record<string, unknown>;
        const target = a.id ?? a.pageId ?? a.databaseId ?? null;
        await s.db.insert("audit", { ownerId, op, source, targetId: typeof target === "string" ? target : null, ok: false, code: (err as { code?: string }).code ?? "INTERNAL", at: Date.now() });
        await s.db.persist();
      }
      throw err;
    }
  });
  s.lock = run.catch(() => undefined);
  return run;
}

/**
 * Who is calling in local mode. Always the single local owner, unless MAX_LOCAL_MULTIUSER=true
 * (tests and demos only), where a `max-dev-user` cookie picks a pretend account so sharing can
 * be exercised between two people on one machine.
 */
export function localActor(request: Request): { id: string; name: string; image: null } {
  if (process.env.MAX_LOCAL_MULTIUSER === "true") {
    const m = /(?:^|;\s*)max-dev-user=([a-z0-9_]{1,40})/.exec(request.headers.get("cookie") ?? "");
    if (m && m[1] !== LOCAL_OWNER) return { id: m[1], name: m[1].charAt(0).toUpperCase() + m[1].slice(1), image: null };
  }
  return { id: LOCAL_OWNER, name: "You", image: null };
}

type SharingCall =
  | { fn: "query" | "mutation"; scopePageId: string; op: string; args?: unknown; linkToken?: string | null }
  | { fn: "access"; pageId: string; linkToken?: string | null }
  | { fn: "withMe" }
  | { fn: "ping"; pageId: string; linkToken?: string | null }
  | { fn: "here"; pageId: string; linkToken?: string | null; at: number }
  | { fn: "public"; token: string; scopePageId: string; op: string; args?: unknown }
  | { fn: "duplicate"; pageId: string; linkToken?: string | null; ws?: string }
  | { fn: "join"; pageId: string; linkToken?: string | null }
  | { fn: "leave"; pageId: string }
  | { fn: "collab"; call: "join" | "pull" | "push" | "awareness" | "commit" | "leave"; args: Record<string, unknown>; linkToken?: string | null };

/** The local twin of convex/sharing.ts. */
export async function runLocalSharing(call: SharingCall, actor: { id: string; name: string; image: null }) {
  const s = state();
  await s.db.load();
  const sharing = await import("@/lib/domain/sharing");
  const now = Date.now();
  if (call.fn === "access") return sharing.accessInfo(s.db, actor.id, call.pageId, call.linkToken);
  if (call.fn === "withMe") return sharing.sharedWithMe(s.db, actor.id);
  if (call.fn === "here") return sharing.present(s.db, actor.id, call.pageId, call.at, call.linkToken);
  if (call.fn === "public") {
    const visitor = { id: sharing.ANONYMOUS, name: "Visitor", image: null };
    return sharing.executeShared(call.op, call.args, { db: s.db, storage: localStorageAdapter, actor: visitor, now, scopePageId: call.scopePageId, linkToken: call.token }, "query");
  }
  const write = async (fn: () => Promise<unknown>) => {
    const run = s.lock.then(async () => {
      const result = await s.db.transaction(fn);
      await s.db.persist();
      s.events.emit("change", { op: call.fn, source: "ui" });
      return result;
    });
    s.lock = run.catch(() => undefined);
    return run;
  };
  if (call.fn === "ping") return write(() => sharing.heartbeat(s.db, actor, call.pageId, now, call.linkToken));
  if (call.fn === "duplicate") return write(async () => sharing.duplicateShared(s.db, actor, call.pageId, now, call.linkToken, await (await import("@/lib/domain/workspaces")).resolveOwner(s.db, actor.id, call.ws?.startsWith("org_") ? undefined : call.ws)));
  if (call.fn === "join") return write(() => sharing.joinByLink(s.db, actor, call.pageId, now, call.linkToken));
  if (call.fn === "leave") return write(() => sharing.leaveShare(s.db, actor, call.pageId));
  if (call.fn === "collab") {
    const collab = await import("@/lib/domain/collab");
    const c = { db: s.db, actor, now, linkToken: call.linkToken };
    const a = call.args as never as { pageId: string; roomId: string; clientId: string; afterSeq: number; epoch: number; data: string; seedRevision?: number; blocks: unknown[]; state?: string; upTo?: number };
    if (call.call === "pull") return collab.pullRoom(c, String(a.roomId), Number(a.afterSeq));
    return write(() => {
      if (call.call === "join") return collab.joinRoom(c, String(a.pageId), String(a.clientId));
      if (call.call === "push") return collab.pushRoom(c, a);
      if (call.call === "awareness") return collab.setAwareness(c, a);
      if (call.call === "commit") return collab.commitRoom({ ...c, storage: localStorageAdapter }, a);
      return collab.leaveRoom(c, String(a.roomId), String(a.clientId));
    });
  }
  const ctx = { db: s.db, storage: localStorageAdapter, actor, now, scopePageId: call.scopePageId, linkToken: call.linkToken };
  if (call.fn === "query") return sharing.executeShared(call.op, call.args, ctx, "query");
  return write(() => sharing.executeShared(call.op, call.args, ctx, "mutation"));
}

export async function resolveLocalToken(hash: string) {
  const s = state();
  await s.db.load();
  const row = await s.db.findTokenByHash(hash);
  if (!row || row.revokedAt) return null;
  await s.db.patch("tokens", row._id, { lastUsedAt: Date.now() });
  await s.db.persist();
  // Tokens belong to the account; the assistant picks a workspace per call.
  return (await import("@/lib/domain/workspaces")).accountOf(row.ownerId);
}

export function localModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.MAX_LOCAL_MODE === "true";
}

/** Local mode's published websites: read by anyone, no account (the twin of convex/sites.ts). */
export async function runLocalSites(call: { fn: "nav" | "read" | "search"; slug: string; op?: string; args?: unknown; q?: string }) {
  const s = state();
  await s.db.load();
  const sites = await import("@/lib/domain/sites");
  if (call.fn === "nav") return sites.siteNav(s.db, call.slug);
  if (call.fn === "search") return sites.siteSearch(s.db, call.slug, call.q ?? "");
  return sites.siteRead(s.db, localStorageAdapter, call.slug, String(call.op), call.args, Date.now());
}

type AdminCall =
  | { fn: "check" }
  | { fn: "overview" }
  | { fn: "reports" }
  | { fn: "users"; search?: string; offset?: number; limit?: number }
  | { fn: "user"; userId: string }
  | { fn: "organizations"; search?: string; offset?: number; limit?: number }
  | { fn: "organization"; orgId: string }
  | { fn: "audit"; scope?: string; action?: string; actor?: string; before?: number; limit?: number }
  | { fn: "orgAction"; orgId: string; action: "moderate" | "recover" | "limits" | "removeMember" | "delete"; status?: "active" | "suspended" | "banned"; reason?: string; accountId?: string; maxMembers?: number | null; confirmName?: string }
  | { fn: "apps" }
  | { fn: "reviewApp"; appId: string; decision: "published" | "rejected" | "suspended"; note?: string }
  | { fn: "setStatus"; userId: string; status: "active" | "suspended" | "banned"; reason: string }
  | { fn: "setReport"; id: string; status: "open" | "resolved" }
  | { fn: "report"; kind: "bug" | "content" | "other"; message: string; url?: string | null; pageId?: string | null; siteSlug?: string | null };

export const LOCAL_ADMIN_FNS = ["apps", "reviewApp", "check", "overview", "reports", "users", "user", "organizations", "organization", "audit", "orgAction", "setStatus", "setReport", "report"];

function localWriter(op: string) {
  const s = state();
  return async <T,>(fn: () => Promise<T>): Promise<T> => {
    const run = s.lock.then(async () => {
      const result = await s.db.transaction(fn);
      await s.db.persist();
      s.events.emit("change", { op, source: "ui" });
      return result;
    });
    s.lock = run.catch(() => undefined);
    return run as Promise<T>;
  };
}

/** Deletes an organization's content in local mode (the account-deletion routine, on its namespace). */
async function localPurge(ns: string) {
  const { accountDeleteAllData } = await import("@/lib/domain/ops/account");
  return (await accountDeleteAllData.run({ db: state().db, storage: localStorageAdapter, ownerId: ns, now: Date.now(), source: "ui" }, { confirm: true })).removed;
}

/** Local mode's admin dashboard: the person who runs this server (the local owner) is the admin. */
export async function runLocalAdmin(call: AdminCall, actor: { id: string; name: string }) {
  const s = state();
  await s.db.load();
  const admin = await import("@/lib/domain/admin");
  const isAdmin = actor.id === LOCAL_OWNER;
  const write = localWriter("admin");
  const now = Date.now();
  if (call.fn === "check") return { admin: isAdmin, role: isAdmin ? "admin" : null };
  if (call.fn === "report") return write(() => admin.submitReport(s.db, { id: actor.id, name: actor.name, email: null }, call, now));
  if (!isAdmin) throw new (await import("@/lib/domain/errors")).MaxError("FORBIDDEN", "This page is for Max's admins.");
  if (call.fn === "overview") return admin.adminOverview(s.db, now);
  if (call.fn === "reports") return admin.listReports(s.db);
  if (call.fn === "users") return admin.adminUsers(s.db, call);
  if (call.fn === "user") return admin.adminUser(s.db, call.userId);
  if (call.fn === "organizations") return admin.adminOrganizations(s.db, call, now);
  if (call.fn === "organization") return admin.adminOrganization(s.db, call.orgId, now);
  if (call.fn === "audit") return admin.adminAudit(s.db, call);
  if (call.fn === "apps") return (await import("@/lib/domain/integrations")).reviewQueue(s.db);
  if (call.fn === "reviewApp") {
    const { reviewIntegration } = await import("@/lib/domain/integrations");
    return write(() => reviewIntegration(s.db, actor, call.appId, call.decision, call.note ?? "", now));
  }
  if (call.fn === "setStatus") return write(() => admin.setModeration(s.db, actor.id, call.userId, call.status, call.reason ?? "", now));
  if (call.fn === "orgAction") {
    const reason = call.reason ?? "";
    return write(async () => {
      if (call.action === "moderate") return admin.setOrgModeration(s.db, actor, call.orgId, call.status ?? "active", reason, now);
      if (call.action === "recover") return admin.recoverOrgOwnership(s.db, actor, call.orgId, call.accountId ?? "", reason, now);
      if (call.action === "limits") return admin.setOrgLimits(s.db, actor, call.orgId, { maxMembers: call.maxMembers ?? null }, now);
      if (call.action === "removeMember") return admin.adminRemoveOrgMember(s.db, actor, call.orgId, call.accountId ?? "", reason, now);
      return admin.adminDeleteOrg(s.db, actor, call.orgId, call.confirmName ?? "", reason, localPurge, now);
    });
  }
  return write(() => admin.setReportStatus(s.db, call.id, call.status, now));
}

type OrgCall = { fn: string; [key: string]: unknown };
export const LOCAL_ORG_FNS = ["mine", "details", "audit", "create", "update", "setPolicies", "invite", "answerInvite", "member", "leave", "joinDomain", "transfer", "setPhrase", "team", "remove"];

/**
 * Local mode's organizations (the twin of convex/organizations.ts). Local accounts have a pretend,
 * verified email `<id>@local.max`, so invitations can be tried between MAX_LOCAL_MULTIUSER accounts.
 */
export async function runLocalOrganizations(call: OrgCall, who: { id: string; name: string }) {
  const s = state();
  await s.db.load();
  const orgs = await import("@/lib/domain/organizations");
  const { MaxError } = await import("@/lib/domain/errors");
  if (!orgs.organizationsEnabled()) {
    if (call.fn === "mine") return { enabled: false, organizations: [], invitations: [] };
    throw new MaxError("NOT_FOUND", "Organizations aren't available on this server.");
  }
  const actor = { id: who.id, name: who.name, image: null, email: `${who.id}@local.max`, emailVerified: true };
  const now = Date.now();
  const str = (k: string) => String(call[k] ?? "");
  const write = localWriter("organizations");
  switch (call.fn) {
    case "mine":
      return { enabled: true, ...(await orgs.myOrganizations(s.db, actor, now)) };
    case "details": {
      // Local mode has no daily job: apply this organization's retention when its settings open.
      const { applyRetention } = await import("@/lib/domain/retention");
      await write(() => applyRetention(s.db, localStorageAdapter, now, str("orgId"))).catch(() => undefined);
      return orgs.organizationDetails(s.db, actor, str("orgId"), now);
    }
    case "audit":
      return orgs.orgAuditLog(s.db, actor, str("orgId"), { before: call.before as number | undefined, action: call.action as string | undefined, limit: call.limit as number | undefined });
    case "create":
      return write(async () => {
        const org = await orgs.createOrganization(s.db, actor, { name: str("name"), icon: (call.icon as string | null) ?? null, description: call.description as string | undefined }, now);
        const { seedOrganization } = await import("@/lib/domain/orgSeed");
        return { ...org, ...(await seedOrganization(s.db, localStorageAdapter, org.id, actor, now)) };
      });
    case "update":
      return write(() => orgs.updateOrganization(s.db, actor, str("orgId"), { name: call.name as string | undefined, icon: call.icon as string | null | undefined, description: call.description as string | undefined, slug: call.slug as string | undefined }, now));
    case "setPolicies":
      return write(() => orgs.setPolicies(s.db, actor, str("orgId"), call as never, now));
    case "invite":
      return write(() => orgs.inviteMembers(s.db, actor, str("orgId"), (call.emails as string[]) ?? [], call.role as "member", now));
    case "answerInvite": {
      const fn = { accept: orgs.acceptInvite, decline: orgs.declineInvite, revoke: orgs.revokeInvite, resend: orgs.resendInvite }[str("action") as "accept"];
      if (!fn) throw new MaxError("VALIDATION", "Invalid request.");
      return write(() => (fn as (...a: unknown[]) => Promise<unknown>)(s.db, actor, str("inviteId"), now));
    }
    case "member":
      return write((): Promise<unknown> => {
        if (call.action === "role") return orgs.setMemberRole(s.db, actor, str("orgId"), str("accountId"), call.role as "member", now);
        if (call.action === "status") return orgs.setMemberStatus(s.db, actor, str("orgId"), str("accountId"), call.status as "active", now);
        return orgs.removeMember(s.db, actor, str("orgId"), str("accountId"), now, call.reassignTo as string | null | undefined);
      });
    case "leave":
      return write(() => orgs.leaveOrganization(s.db, actor, str("orgId"), now));
    case "joinDomain":
      return write(() => orgs.joinByDomain(s.db, actor, str("orgId"), now));
    case "transfer":
      return write(() => orgs.transferOwnership(s.db, actor, str("orgId"), str("nextOwnerId"), str("phrase"), now));
    case "setPhrase":
      return write(() => orgs.setSecurityPhrase(s.db, actor, str("orgId"), { current: call.current as string | undefined, next: str("next") }, now));
    case "team":
      return write((): Promise<unknown> =>
        call.teamId
          ? orgs.updateTeam(s.db, actor, str("orgId"), str("teamId"), { name: call.name as string | undefined, description: call.description as string | undefined, memberIds: call.memberIds as string[] | undefined, archived: call.archived as boolean | undefined }, now)
          : orgs.createTeam(s.db, actor, str("orgId"), { name: str("name"), description: call.description as string | undefined, memberIds: call.memberIds as string[] | undefined }, now),
      );
    case "remove":
      return write(() => orgs.deleteOwnOrganization(s.db, actor, str("orgId"), str("phrase"), localPurge, now));
    default:
      throw new MaxError("VALIDATION", "Invalid request.");
  }
}

/* ── Connected apps in local mode (the twin of convex/integrations.ts) ──────── */

/** Runs one operation for an app token, then delivers any webhooks right away. */
export async function runLocalApp(token: string, op: string, args: unknown) {
  const s = state();
  await s.db.load();
  const apps = await import("@/lib/domain/integrations");
  const { MaxError } = await import("@/lib/domain/errors");
  const run = s.lock.then(async () => {
    const result = await s.db.transaction(async () => {
      const app = await apps.appForToken(s.db, token);
      if (!app) throw new MaxError("UNAUTHENTICATED", "That app token is invalid or was disconnected.");
      const outbox = { queued: 0 };
      const r = await execute(op, args, { db: s.db, storage: localStorageAdapter, ownerId: app.ownerId, now: Date.now(), source: "app", actor: app.actor, appScopes: app.scopes, outbox, ...(app.ownerId.startsWith("org_") ? { org: { role: "member" as const } } : {}) });
      await s.db.patch("installations", app.installationId, { lastUsedAt: Date.now() });
      return r;
    });
    await s.db.persist();
    s.events.emit("change", { op, source: "app" });
    return result;
  });
  s.lock = run.catch(() => undefined);
  const result = await run;
  void localDeliver();
  return result;
}

export async function runLocalExchange(input: { clientId: string; clientSecret: string; code: string; redirectUri?: string | null }) {
  const s = state();
  await s.db.load();
  const apps = await import("@/lib/domain/integrations");
  return localWriter("apps")(() => apps.exchangeCode(s.db, input, Date.now()));
}

/** Sends due webhooks (local mode has no background jobs: called after changes). */
export async function localDeliver() {
  const s = state();
  const apps = await import("@/lib/domain/integrations");
  await localWriter("webhooks")(() => apps.deliverDue(s.db, Date.now())).catch(() => undefined);
}

type AppCall = { fn: string; [key: string]: unknown };
export const LOCAL_APP_FNS = ["marketplace", "info", "mine", "installed", "manage", "install", "revoke"];

export async function runLocalApps(call: AppCall, who: { id: string; name: string }) {
  const s = state();
  await s.db.load();
  const apps = await import("@/lib/domain/integrations");
  const now = Date.now();
  const write = localWriter("apps");
  const str = (k: string) => String(call[k] ?? "");
  switch (call.fn) {
    case "marketplace":
      return apps.marketplace(s.db, who.id);
    case "info":
      return apps.appInfo(s.db, str("appId"), who.id);
    case "mine":
      return apps.myIntegrations(s.db, who.id);
    case "installed":
      return apps.installedApps(s.db, await apps.installTarget(s.db, who.id, (call.ws as string | null) ?? null));
    case "manage": {
      const input = call.app as Parameters<typeof apps.createIntegration>[2];
      return write((): Promise<unknown> => {
        if (call.action === "create") return apps.createIntegration(s.db, who.id, input, now);
        if (call.action === "update") return apps.updateIntegration(s.db, who.id, str("appId"), input, now);
        if (call.action === "rotate") return apps.rotateSecrets(s.db, who.id, str("appId"), now);
        if (call.action === "submit") return apps.submitIntegration(s.db, who.id, str("appId"), now);
        return apps.deleteIntegration(s.db, who.id, str("appId"), now);
      });
    }
    case "install":
      return write(() => apps.install(s.db, who, { appId: str("appId"), workspace: (call.ws as string | null) ?? null, scopes: (call.scopes as string[]) ?? [], redirectUri: (call.redirectUri as string | null) ?? null, state: (call.state as string | null) ?? null }, now));
    case "revoke":
      return write(() => apps.revokeInstallation(s.db, who, str("installationId"), now));
    default:
      throw new (await import("@/lib/domain/errors")).MaxError("VALIDATION", "Invalid request.");
  }
}
