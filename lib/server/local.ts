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
export async function runLocal(op: string, args: unknown, source: Source, account = LOCAL_OWNER, kind?: "query" | "mutation", workspace?: string) {
  const s = state();
  await s.db.load();
  const ownerId = await (await import("@/lib/domain/workspaces")).resolveOwner(s.db, account, workspace);
  const ctx = { db: s.db, storage: localStorageAdapter, ownerId, now: Date.now(), source };
  const { registry } = await import("@/lib/domain/ops");
  const def = registry.get(op);
  if (def?.kind === "query") return execute(op, args, ctx, kind);
  const run = s.lock.then(async () => {
    try {
      const result = await s.db.transaction(() => execute(op, args, ctx, kind));
      await s.db.persist();
      s.events.emit("change", { op, source });
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
  | { fn: "duplicate"; pageId: string; linkToken?: string | null }
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
  if (call.fn === "duplicate") return write(() => sharing.duplicateShared(s.db, actor, call.pageId, now, call.linkToken));
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
  return row.ownerId;
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
  | { fn: "setStatus"; userId: string; status: "active" | "suspended" | "banned"; reason: string }
  | { fn: "setReport"; id: string; status: "open" | "resolved" }
  | { fn: "report"; kind: "bug" | "content" | "other"; message: string; url?: string | null; pageId?: string | null; siteSlug?: string | null };

/** Local mode's admin dashboard: the person who runs this server (the local owner) is the admin. */
export async function runLocalAdmin(call: AdminCall, actor: { id: string; name: string }) {
  const s = state();
  await s.db.load();
  const admin = await import("@/lib/domain/admin");
  const isAdmin = actor.id === LOCAL_OWNER;
  const write = async (fn: () => Promise<unknown>) => {
    const run = s.lock.then(async () => {
      const result = await s.db.transaction(fn);
      await s.db.persist();
      s.events.emit("change", { op: "admin", source: "ui" });
      return result;
    });
    s.lock = run.catch(() => undefined);
    return run;
  };
  if (call.fn === "check") return { admin: isAdmin };
  if (call.fn === "report") return write(() => admin.submitReport(s.db, { id: actor.id, name: actor.name, email: null }, call, Date.now()));
  if (!isAdmin) throw new (await import("@/lib/domain/errors")).MaxError("FORBIDDEN", "This page is for Max's admins.");
  if (call.fn === "overview") return admin.adminOverview(s.db, Date.now());
  if (call.fn === "reports") return admin.listReports(s.db);
  if (call.fn === "setStatus") return write(() => admin.setModeration(s.db, actor.id, call.userId, call.status, call.reason ?? "", Date.now()));
  return write(() => admin.setReportStatus(s.db, call.id, call.status, Date.now()));
}
