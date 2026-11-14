import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { execute } from "@/lib/domain/ops";
import { createPersonalDb } from "@/lib/domain/collaboration/personalDb";
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
  private loading: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();
  async load() {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = (async () => {
        if (existsSync(FILE)) this.restore(await readFile(FILE, "utf8"));
        this.loaded = true;
      })().finally(() => { this.loading = undefined; });
    }
    await this.loading;
  }
  persist() {
    const data = this.snapshot();
    const save = async () => {
      await mkdir(DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      await writeFile(tmp, data);
      await rename(tmp, FILE);
    };
    this.queue = this.queue.then(save, save);
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
    if (SAFE_ID.test(storageId)) {
      await rm(path.join(FILES, storageId), { force: true });
      await rm(path.join(FILES, `${storageId}.type`), { force: true });
    }
  },
};

export async function saveLocalFile(body: ArrayBuffer, type: string): Promise<string> {
  const id = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(20)), (b) => (b % 36).toString(36)).join("");
  await mkdir(FILES, { recursive: true });
  const file = path.join(FILES, id);
  await writeFile(`${file}.tmp`, Buffer.from(body));
  await writeFile(`${file}.type.tmp`, type.slice(0, 100));
  await rename(`${file}.type.tmp`, `${file}.type`);
  await rename(`${file}.tmp`, file);
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
  const db = createPersonalDb({ db: s.db, ownerId });
  const context = () => ({ db, storage: localStorageAdapter, ownerId, now: Date.now(), source });
  const { registry } = await import("@/lib/domain/ops");
  const def = registry.get(op);
  if (def?.kind === "query") {
    const read = s.lock.then(() => execute(op, args, context(), kind));
    s.lock = read.catch(() => undefined);
    return read;
  }
  const run = s.lock.then(async () => {
    const removedFiles = new Set<string>();
    const writeContext = {
      ...context(),
      storage: { ...localStorageAdapter, remove: async (storageId: string) => { removedFiles.add(storageId); } },
    };
    try {
      const result = await s.db.transaction(async () => {
        if (op === "account.deleteAllData") await db.preflightAccountDeletion();
        const result = await execute(op, args, writeContext, kind);
        await s.db.persist();
        return result;
      });
      // File deletion cannot roll back with MemoryDb. A failed batch must keep
      // its bytes; remove them only after the new database is durably committed.
      // Crash recovery for post-commit orphan bytes still needs a cleanup ledger.
      for (const storageId of removedFiles) await localStorageAdapter.remove(storageId);
      s.events.emit("change", { op, source });
      return result;
    } catch (err) {
      // The failed write rolled back; record the attempt for assistant activity (names and codes only).
      if (source === "mcp" && def) {
        const a = (args ?? {}) as Record<string, unknown>;
        const target = a.id ?? a.pageId ?? a.databaseId ?? null;
        try {
          await s.db.transaction(async () => {
            await s.db.insert("audit", { ownerId, op, source, targetId: typeof target === "string" ? target : null, ok: false, code: (err as { code?: string }).code ?? "INTERNAL", at: Date.now() });
            await s.db.persist();
          });
        } catch {
          console.error(JSON.stringify({ level: "error", op: "audit.persist", message: "The failed operation audit could not be saved." }));
        }
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
  const run = s.lock.then(() => s.db.transaction(async () => {
    const row = await s.db.findTokenByHash(hash);
    if (!row || row.revokedAt) return null;
    await s.db.patch("tokens", row._id, { lastUsedAt: Date.now() });
    await s.db.persist();
    return row.ownerId;
  }));
  s.lock = run.catch(() => undefined);
  return run;
}

export function localModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.MAX_LOCAL_MODE === "true";
}
