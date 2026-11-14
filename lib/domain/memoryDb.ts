import type { LocalUploadDb, IndexedField, NewRow } from "./db";
import type { TableName, Tables } from "./types";

type State = { [T in TableName]: Map<string, Tables[T]> };

const emptyState = (): State => ({
  pages: new Map(),
  documents: new Map(),
  settings: new Map(),
  assets: new Map(),
  tokens: new Map(),
  audit: new Map(),
  idempotency: new Map(),
  versions: new Map(),
  comments: new Map(),
  uploadReceipts: new Map(),
});

let counter = 0;
function newId(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  counter = (counter + 1) % 1296;
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("") + counter.toString(36).padStart(2, "0");
}

const clone = <T>(v: T): T => structuredClone(v);

/** An in-memory implementation of Db with snapshot transactions. */
export class MemoryDb implements LocalUploadDb {
  protected state: State = emptyState();

  async get<T extends TableName>(table: T, id: string) {
    const row = this.state[table].get(id) as Tables[T] | undefined;
    return row ? clone(row) : null;
  }

  async list<T extends TableName>(table: T, ownerId: string, where?: { field: IndexedField<T>; value: string | null }) {
    const out: Tables[T][] = [];
    for (const row of this.state[table].values() as IterableIterator<Tables[T]>) {
      if (row.ownerId !== ownerId) continue;
      if (where?.field === "blob.storageId") {
        if (!("blob" in row) || row.blob.storageId !== where.value) continue;
      } else if (where && (row as unknown as Record<string, unknown>)[where.field as string] !== where.value) continue;
      out.push(clone(row));
    }
    return out;
  }

  async insert<T extends TableName>(table: T, row: NewRow<T>) {
    const _id = newId();
    (this.state[table] as Map<string, Tables[T]>).set(_id, clone({ ...row, _id } as unknown as Tables[T]));
    return _id;
  }

  async patch<T extends TableName>(table: T, id: string, patch: Partial<NewRow<T>>) {
    const row = this.state[table].get(id);
    if (!row) throw new Error(`patch: ${table}/${id} missing`);
    const next = { ...row } as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) next[k] = clone(v);
    (this.state[table] as Map<string, unknown>).set(id, next);
  }

  async delete(table: TableName, id: string) {
    this.state[table].delete(id);
  }

  async findTokenByHash(hash: string) {
    for (const t of this.state.tokens.values()) if (t.hash === hash) return clone(t);
    return null;
  }

  async findUploadReceipts(query: { field: "id" | "capabilityHash" | "blob.storageId"; value: string }) {
    const rows: Tables["uploadReceipts"][] = [];
    for (const row of this.state.uploadReceipts.values()) {
      const value = query.field === "blob.storageId" ? ("blob" in row ? row.blob.storageId : undefined) : row[query.field];
      if (value === query.value) rows.push(clone(row));
      if (rows.length === 2) break;
    }
    return rows;
  }

  async replaceUploadReceipt(id: string, row: NewRow<"uploadReceipts">) {
    if (!this.state.uploadReceipts.has(id)) throw new Error("Upload receipt is missing.");
    this.state.uploadReceipts.set(id, clone({ ...row, _id: id }));
  }

  async findAssetReferences(storageId: string) {
    const rows: Tables["assets"][] = [];
    for (const row of this.state.assets.values()) {
      if (row.storageId === storageId) rows.push(clone(row));
      if (rows.length === 1001) break;
    }
    return rows;
  }

  /** Runs `fn`; on error, restores the state from before it started. */
  async transaction<R>(fn: () => Promise<R>): Promise<R> {
    const snapshot = this.snapshot();
    try {
      return await fn();
    } catch (err) {
      this.restore(snapshot);
      throw err;
    }
  }

  snapshot(): string {
    const plain: Record<string, unknown[]> = {};
    for (const [table, rows] of Object.entries(this.state)) {
      if (table === "uploadReceipts" && rows.size === 0) continue;
      plain[table] = [...rows.values()];
    }
    return JSON.stringify(plain);
  }

  restore(serialized: string) {
    const plain = JSON.parse(serialized) as Record<string, { _id: string }[]>;
    const next = emptyState();
    if (!plain || typeof plain !== "object" || Array.isArray(plain)) throw new Error("Invalid local snapshot.");
    const keys = Object.keys(plain);
    const expected = Object.keys(next).filter((key) => key !== "uploadReceipts");
    if (keys.some((key) => !Object.hasOwn(next, key)) || expected.some((key) => !Object.hasOwn(plain, key))) throw new Error("Unsupported local snapshot tables.");
    for (const rows of Object.values(plain)) {
      if (!Array.isArray(rows) || rows.some((row) => !row || typeof row._id !== "string" || !row._id) || new Set(rows.map((row) => row._id)).size !== rows.length)
        throw new Error("Invalid or duplicate local snapshot rows.");
    }
    for (const table of Object.keys(next) as TableName[]) {
      for (const row of plain[table] ?? []) (next[table] as Map<string, unknown>).set(row._id, row);
    }
    this.state = next;
  }
}
