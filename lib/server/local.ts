import "server-only";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { execute } from "@/lib/domain/ops";
import { createPersonalDb } from "@/lib/domain/collaboration/personalDb";
import { localUploadStore } from "@/lib/domain/localUploadStore";
import { UploadService, type UploadAttempt } from "@/lib/domain/uploads";
import { createUploadRuntime, hashUploadCapability } from "@/lib/domain/uploadRuntime";
import { readUploadBody } from "@/lib/domain/uploadBody";
import { preflightLocalUploadDeletion, deleteLocalOwnerUploads } from "@/lib/domain/localUploadAccount";
import { stageLocalFileDeletions, getPendingLocalCleanup } from "@/lib/domain/localFileCleanup";
import { MaxError, notFound } from "@/lib/domain/errors";
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
      })().finally(() => {
        this.loading = undefined;
      });
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
  commit<T>(run: () => Promise<T>): Promise<T> {
    return this.transaction(async () => {
      const result = await run();
      await this.persist();
      return result;
    });
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

const uploadService = (db: FileDb) => new UploadService(localUploadStore(db), createUploadRuntime());

async function localFileMetadata(storageId: string) {
  const file = await readLocalFile(storageId);
  if (!file) return null;
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(file.body));
  return { size: file.body.byteLength, type: file.type, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
}

/** Caller holds the local write lock. A crash leaves the committed claim retryable. */
async function flushLocalCleanup(db: FileDb, ownerId: string) {
  const claims = await getPendingLocalCleanup(db, ownerId);
  for (const claim of claims) {
    const receipt = await localUploadStore(db).transaction((tx) => tx.get(claim.receiptId));
    const measured = await localFileMetadata(claim.storageId);
    if (
      !receipt ||
      receipt.state !== "cleaning" ||
      receipt.ownerId !== ownerId ||
      receipt.cleanupId !== claim.cleanupId ||
      (measured && (measured.size !== receipt.blob.size || measured.type !== receipt.blob.type || measured.sha256 !== receipt.blob.sha256))
    )
      throw new MaxError("CONFLICT", "File bytes changed after cleanup was committed.");
  }
  for (const claim of claims) {
    await localStorageAdapter.remove(claim.storageId);
    await db.commit(async () => {
      await uploadService(db).completeCleanup(claim);
      const rows = await db.findUploadReceipts({ field: "id", value: claim.receiptId });
      if (rows.length !== 1 || rows[0].state !== "cleaned") throw new MaxError("CONFLICT", "File cleanup metadata changed.");
      await db.delete("uploadReceipts", rows[0]._id);
    });
  }
  const cleaned = (await db.list("uploadReceipts", ownerId)).filter((row) => row.state === "cleaned");
  if (cleaned.length) {
    await db.commit(async () => {
      const store = localUploadStore(db);
      for (const row of cleaned) {
        const current = await store.transaction((tx) => tx.get(row.id));
        if (
          !current ||
          current.state !== "cleaned" ||
          current.ownerId !== ownerId ||
          !SAFE_ID.test(current.blob.storageId) ||
          (await db.findAssetReferences(current.blob.storageId)).length ||
          (await readLocalFile(current.blob.storageId))
        )
          throw new MaxError("CONFLICT", "Completed file cleanup metadata is inconsistent.");
      }
      for (const row of cleaned) await db.delete("uploadReceipts", row._id);
    });
  }
}

async function receiptWrite<T>(run: (db: FileDb) => Promise<T>): Promise<T> {
  const s = state();
  await s.db.load();
  const task = s.lock.then(() => s.db.commit(() => run(s.db)));
  s.lock = task.catch(() => undefined);
  return task;
}

export function beginLocalUpload(capability: string) {
  return receiptWrite((db) => uploadService(db).begin(capability));
}

export async function completeLocalUpload(attempt: UploadAttempt, body: Blob): Promise<string> {
  const bytes = await body.arrayBuffer();
  const storageId = await saveLocalFile(bytes, body.type);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  await receiptWrite((db) => uploadService(db).complete(attempt, { storageId, size: body.size, type: body.type, sha256 }));
  return storageId;
}

/** Trusted Node callers, including MCP, use the same owner-bound receive flow. */
export async function storeLocalUpload(ownerId: string, body: Blob): Promise<string> {
  const ticket = await receiptWrite((db) => uploadService(db).issue(ownerId));
  const begun = await beginLocalUpload(ticket.capability);
  if (begun.state !== "receiving") throw new MaxError("CONFLICT", "The upload already completed.");
  const checked = await readUploadBody(new Request("http://localhost/upload", { method: "POST", headers: { "content-type": body.type }, body }));
  return completeLocalUpload(begun.attempt, checked);
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
    const read = s.lock.then(async () => {
      await flushLocalCleanup(s.db, ownerId);
      return execute(op, args, context(), kind);
    });
    s.lock = read.catch(() => undefined);
    return read;
  }
  const run = s.lock.then(async () => {
    await flushLocalCleanup(s.db, ownerId);
    const removedFiles = new Set<string>();
    const writeContext = {
      ...context(),
      storage: {
        ...localStorageAdapter,
        createUploadUrl: async () => {
          const ticket = await uploadService(s.db).issue(ownerId);
          return `/api/local/upload?capability=${encodeURIComponent(ticket.capability)}`;
        },
        remove: async (storageId: string) => {
          removedFiles.add(storageId);
        },
      },
      registerUpload: async (asset: import("@/lib/domain/db").NewRow<"assets">) => {
        const registrationKey = await hashUploadCapability(
          JSON.stringify({ ownerId, pageId: asset.pageId, storageId: asset.storageId, name: asset.name, type: asset.type, size: asset.size, alt: asset.alt }),
        );
        return (
          await uploadService(s.db).register(
            ownerId,
            asset,
            registrationKey,
            () => db.insert("assets", asset),
            async (assetId) => {
              const current = await db.get("assets", assetId);
              if (!current || current.ownerId !== ownerId || current.pageId !== asset.pageId || current.storageId !== asset.storageId) throw notFound("upload");
            },
          )
        ).assetId;
      },
      preflightUploadDeletion: () => preflightLocalUploadDeletion(s.db, db, ownerId, localFileMetadata),
      deleteUploads: () =>
        deleteLocalOwnerUploads(s.db, db, ownerId, localFileMetadata, {
          ...localStorageAdapter,
          remove: async (storageId) => {
            removedFiles.add(storageId);
          },
        }),
    };
    let committed = false;
    try {
      const result = await s.db.commit(async () => {
        if (op === "account.deleteAllData") await db.preflightAccountDeletion();
        const result = await execute(op, args, writeContext, kind);
        await stageLocalFileDeletions(s.db, ownerId, [...removedFiles], localFileMetadata, createUploadRuntime(), db);
        return result;
      });
      committed = true;
      // File deletion cannot roll back with MemoryDb. A failed batch must keep
      // its bytes; remove them only after the new database is durably committed.
      // The committed cleanup ledger also recovers after process restart.
      await flushLocalCleanup(s.db, ownerId);
      s.events.emit("change", { op, source });
      return result;
    } catch (err) {
      if (committed) throw new MaxError("CONFLICT", "The change was saved, but file cleanup could not finish. Reload Max to retry cleanup.");
      // The failed write rolled back; record the attempt for assistant activity (names and codes only).
      if (source === "mcp" && def) {
        const a = (args ?? {}) as Record<string, unknown>;
        const target = a.id ?? a.pageId ?? a.databaseId ?? null;
        try {
          await s.db.transaction(async () => {
            await s.db.insert("audit", {
              ownerId,
              op,
              source,
              targetId: typeof target === "string" ? target : null,
              ok: false,
              code: (err as { code?: string }).code ?? "INTERNAL",
              at: Date.now(),
            });
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
  const run = s.lock.then(() =>
    s.db.transaction(async () => {
      const row = await s.db.findTokenByHash(hash);
      if (!row || row.revokedAt) return null;
      await s.db.patch("tokens", row._id, { lastUsedAt: Date.now() });
      await s.db.persist();
      return row.ownerId;
    }),
  );
  s.lock = run.catch(() => undefined);
  return run;
}

export function localModeAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.MAX_LOCAL_MODE === "true";
}
