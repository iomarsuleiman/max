import type { GenericDatabaseReader, GenericDatabaseWriter, GenericDataModel, StorageReader, StorageWriter } from "convex/server";
import { newObjectKey, presign, R2_PREFIX, r2ConfigFromEnv } from "../lib/domain/r2";
import { accountOf } from "../lib/domain/workspaces";
import type { CrossField, CrossTable, Db, IndexedField, ListAllTable, NewRow, Storage } from "../lib/domain/db";
import type { TableName, Tables } from "../lib/domain/types";

type Reader = GenericDatabaseReader<GenericDataModel>;
type Writer = GenericDatabaseWriter<GenericDataModel>;

/** Adapts Convex's database to the domain Db contract. Writes throw inside queries (read-only). */
export function convexDb(db: Reader | Writer): Db {
  const writer = () => {
    if (!("insert" in db)) throw new Error("This operation needs a mutation.");
    return db as Writer;
  };
  const normalize = (table: TableName, id: string) => db.normalizeId(table, id);
  return {
    async get<T extends TableName>(table: T, id: string) {
      const nid = normalize(table, id);
      if (!nid) return null;
      const row = await db.get(nid);
      return row ? (strip(row, table) as unknown as Tables[T]) : null;
    },
    async list<T extends TableName>(table: T, ownerId: string, where?: { field: IndexedField<T>; value: string | null }) {
      const rows = where
        ? await db
            .query(table)
            .withIndex(`by_owner_${String(where.field)}`, (q) => (q.eq("ownerId", ownerId) as unknown as { eq(f: string, v: unknown): never }).eq(where.field as string, where.value))
            .collect()
        : await db
            .query(table)
            .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
            .collect();
      return rows.map((r) => strip(r, table) as unknown as Tables[T]);
    },
    async insert<T extends TableName>(table: T, row: NewRow<T>) {
      return (await writer().insert(table, row as never)) as string;
    },
    async patch<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>) {
      const nid = normalize(table, id);
      if (!nid) throw new Error("Invalid id");
      const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
      await writer().patch(nid, clean as never);
    },
    async delete(table: TableName, id: string) {
      const nid = normalize(table, id);
      if (nid) await writer().delete(nid);
    },
    async findTokenByHash(hash: string) {
      const row = await db
        .query("tokens")
        .withIndex("by_hash", (q) => q.eq("hash", hash))
        .first();
      return row ? (strip(row) as unknown as Tables["tokens"]) : null;
    },
    async memberNumber(ownerId: string) {
      const mine = await db
        .query("settings")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .first();
      if (!mine) return null;
      // Everyone whose settings row (created when they joined) is older than yours.
      const earlier = await db
        .query("settings")
        .withIndex("by_creation_time", (q) => (q as unknown as { lt(f: string, v: number): typeof q }).lt("_creationTime", Number(mine._creationTime)))
        .collect();
      return earlier.length + 1;
    },
    async listAll<T extends ListAllTable>(table: T, limit: number) {
      const rows = await db.query(table).order("desc").take(limit);
      return rows.map((r) => strip(r, table) as unknown as Tables[T]);
    },
    async invitedCount(account: string) {
      const rows = await db
        .query("settings")
        .withIndex("by_invitedBy", (q) => q.eq("invitedBy", account))
        .take(10_000);
      return rows.length;
    },
    async memberByNumber(n: number) {
      // Settings rows in the order people joined; the nth is member n.
      const rows = await db.query("settings").withIndex("by_creation_time").order("asc").take(n);
      return rows.length === n ? String((rows[n - 1] as { ownerId: string }).ownerId) : null;
    },
    async updatesAfter(roomId: string, afterSeq: number, limit: number) {
      const rows = await db
        .query("collabUpdates")
        // The adapter's db isn't typed by the schema, so the range builder is typed loosely.
        .withIndex("by_roomId", (q) => (q.eq("roomId", roomId) as unknown as { gt(f: string, v: number): typeof q }).gt("seq", afterSeq))
        .take(limit);
      return rows.map((r) => strip(r) as unknown as Tables["collabUpdates"]);
    },
    async findBy<T extends CrossTable>(table: T, field: CrossField<T>, value: string) {
      const rows = await db
        .query(table)
        .withIndex(`by_${String(field)}`, (q) => q.eq(field as string, value))
        .take(500);
      return rows.map((r) => strip(r) as unknown as Tables[T]);
    },
  };
}

function strip(row: Record<string, unknown>, table?: TableName) {
  const { _creationTime, ...rest } = row;
  // Legacy settings already have the authoritative first-use timestamp in Convex.
  return table === "settings" ? { ...rest, joinedAt: rest.joinedAt ?? _creationTime } : rest;
}

/**
 * Files: Cloudflare R2 when it's configured (R2_* environment variables), Convex storage otherwise.
 * R2 files have storage ids "r2:<key>"; older files stay in Convex and keep working either way.
 * Deleting an R2 file is handed to a background action (`schedule`), as mutations can't fetch.
 */
export function convexStorage(storage: StorageReader | StorageWriter, schedule?: (key: string) => Promise<unknown>): Storage {
  const r2 = r2ConfigFromEnv(process.env);
  return {
    async createUploadUrl() {
      if (!("generateUploadUrl" in storage)) throw new Error("Uploads need a mutation.");
      return storage.generateUploadUrl();
    },
    async createUpload({ type, size, ownerId }) {
      if (!r2) return null;
      const key = await newObjectKey(accountOf(ownerId), type);
      const headers = { "Content-Type": type || "application/octet-stream", "Content-Length": String(size) };
      const url = await presign(r2, "PUT", key, { now: Date.now(), expires: 600, headers });
      // The browser sets Content-Length itself; only Content-Type is sent by hand.
      return { url, method: "PUT" as const, headers: { "Content-Type": headers["Content-Type"] }, storageId: `${R2_PREFIX}${key}` };
    },
    async getUrl(storageId) {
      if (storageId.startsWith(R2_PREFIX)) {
        if (!r2) return null;
        // A week-long signed link: private files stay private, and the link can't be guessed.
        return presign(r2, "GET", storageId.slice(R2_PREFIX.length), { now: Date.now(), expires: 7 * 86_400 });
      }
      return storage.getUrl(storageId as never);
    },
    async remove(storageId) {
      if (storageId.startsWith(R2_PREFIX)) {
        await schedule?.(storageId.slice(R2_PREFIX.length));
        return;
      }
      if ("delete" in storage) await storage.delete(storageId as never);
    },
  };
}
