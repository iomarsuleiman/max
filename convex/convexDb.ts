import type { GenericDatabaseReader, GenericDatabaseWriter, GenericDataModel, StorageReader, StorageWriter } from "convex/server";
import type { Db, IndexedField, NewRow, Storage } from "../lib/domain/db";
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
      return row ? (strip(row) as unknown as Tables[T]) : null;
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
      return rows.map((r) => strip(r) as unknown as Tables[T]);
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
  };
}

function strip(row: Record<string, unknown>) {
  const { _creationTime: _c, ...rest } = row;
  return rest;
}

export function convexStorage(storage: StorageReader | StorageWriter): Storage {
  return {
    async createUploadUrl() {
      if (!("generateUploadUrl" in storage)) throw new Error("Uploads need a mutation.");
      return storage.generateUploadUrl();
    },
    async getUrl(storageId) {
      return storage.getUrl(storageId as never);
    },
    async remove(storageId) {
      if ("delete" in storage) await storage.delete(storageId as never);
    },
  };
}
