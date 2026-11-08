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
export async function runLocal(op: string, args: unknown, source: Source, ownerId = LOCAL_OWNER, kind?: "query" | "mutation") {
  const s = state();
  await s.db.load();
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
