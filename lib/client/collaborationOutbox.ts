import { z } from "zod";
import { settleDraft, type AppliedReceipt, type PendingDraft } from "../domain/collaboration/generations";

const keyPart = z.string().min(1).max(128);
export const OUTBOX_LIMITS = Object.freeze({ entries: 200, bytesPerDocument: 16 * 1024 * 1024, snapshotBytes: 900_000, updateBytes: 900_000 });
const scopeSchema = z.object({ accountId: keyPart, workspaceId: keyPart, pageId: keyPart }).strict();
const entrySchema = scopeSchema
  .extend({
    operationId: keyPart,
    generation: z.number().int().nonnegative(),
    baseRevision: z.number().int().nonnegative(),
    snapshot: z.string().max(OUTBOX_LIMITS.snapshotBytes),
    update: z.instanceof(Uint8Array).refine((value) => value.byteLength <= OUTBOX_LIMITS.updateBytes, "This recovery update is too large."),
    sequence: z.number().int().positive(),
    state: z.enum(["pending", "conflict", "revoked"]),
  })
  .strict();
type Entry = z.infer<typeof entrySchema>;
export type OutboxScope = z.infer<typeof scopeSchema>;
export type OutboxInput = Omit<Entry, "sequence" | "state">;
const receiptSchema = z
  .object({
    document: z.object({ workspaceId: keyPart, pageId: keyPart }).strict(),
    accountId: keyPart,
    operationId: keyPart,
    generation: z.number().int().nonnegative(),
    revision: z.number().int().positive(),
    outcome: z.literal("applied"),
  })
  .strict();
const bytes = (entry: Pick<Entry, "snapshot" | "update">) => new TextEncoder().encode(entry.snapshot).length + entry.update.byteLength;
const scopeKey = (scope: OutboxScope) => [scope.accountId, scope.workspaceId, scope.pageId];
const entryKey = (scope: OutboxScope, operationId: string) => [...scopeKey(scope), operationId];

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Local recovery storage failed."));
  });
}

/**
 * Experimental recovery primitive, not wired into the current editor.
 * Completion means the IndexedDB transaction committed, never remote sync.
 * Callers must re-authorize before replay and must handle quota/commit failures.
 */
export class CollaborationOutbox {
  private connection: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (!this.connection)
      this.connection = new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open("max-collaboration-outbox-v1", 1);
        let blocked = false;
        opening.onupgradeneeded = () => {
          const store = opening.result.createObjectStore("entries", { keyPath: ["accountId", "workspaceId", "pageId", "operationId"] });
          store.createIndex("by_scope", ["accountId", "workspaceId", "pageId"]);
        };
        opening.onerror = () => {
          this.connection = null;
          reject(opening.error ?? new Error("Local recovery storage is unavailable."));
        };
        opening.onblocked = () => {
          blocked = true;
          this.connection = null;
          reject(new Error("Close older Max tabs before opening local recovery storage."));
        };
        opening.onsuccess = () => {
          const db = opening.result;
          if (blocked) {
            db.close();
            return;
          }
          db.onversionchange = () => {
            db.close();
            this.connection = null;
          };
          resolve(db);
        };
      });
    return this.connection;
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();
    const tx = db.transaction("entries", mode, { durability: "strict" });
    const committed = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error("The local recovery transaction was aborted."));
    });
    // A request can reject before the transaction's abort event arrives.
    void committed.catch(() => undefined);
    try {
      const result = await run(tx.objectStore("entries"));
      await committed;
      return result;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* already completed or aborted */
      }
      await committed.catch(() => undefined);
      throw error;
    }
  }

  private async rows(store: IDBObjectStore, scope: OutboxScope): Promise<Entry[]> {
    const found: unknown[] = await request(store.index("by_scope").getAll(IDBKeyRange.only(scopeKey(scope)), OUTBOX_LIMITS.entries + 1));
    if (found.length > OUTBOX_LIMITS.entries) throw new Error("The local recovery journal exceeds its supported limit.");
    return found.map((value) => entrySchema.parse(value)).sort((a, b) => a.sequence - b.sequence);
  }

  async append(raw: OutboxInput): Promise<{ sequence: number; state: Entry["state"] }> {
    const input = entrySchema.omit({ sequence: true, state: true }).parse(raw);
    if (new TextEncoder().encode(input.snapshot).length > OUTBOX_LIMITS.snapshotBytes || input.update.byteLength > OUTBOX_LIMITS.updateBytes)
      throw new Error("This local recovery update is too large.");
    const snapshot: unknown = JSON.parse(input.snapshot);
    if (!snapshot || typeof snapshot !== "object") throw new Error("The recovery snapshot must be document JSON.");
    return this.transaction("readwrite", async (store) => {
      const existing = await this.rows(store, input);
      const duplicate = existing.find((entry) => entry.operationId === input.operationId);
      if (duplicate) {
        if (
          duplicate.generation !== input.generation ||
          duplicate.baseRevision !== input.baseRevision ||
          duplicate.snapshot !== input.snapshot ||
          duplicate.update.length !== input.update.length ||
          !duplicate.update.every((byte, index) => byte === input.update[index])
        )
          throw new Error("That recovery operation ID already contains different content.");
        return { sequence: duplicate.sequence, state: duplicate.state };
      }
      if (existing.some((entry) => entry.state === "revoked"))
        throw new Error("This document's old drafts are quarantined. Review or discard them before starting another recovery journal.");
      if (existing.length >= OUTBOX_LIMITS.entries || existing.reduce((total, entry) => total + bytes(entry), bytes(input)) > OUTBOX_LIMITS.bytesPerDocument)
        throw new Error("Local recovery storage is full. Keep this tab open and resolve pending changes before continuing.");
      const sequence = (existing.at(-1)?.sequence ?? 0) + 1;
      await request(store.add({ ...input, sequence, state: "pending" } satisfies Entry));
      return { sequence, state: "pending" };
    });
  }

  async recoverable(rawScope: OutboxScope): Promise<Entry[]> {
    const scope = scopeSchema.parse(rawScope);
    return this.transaction("readonly", async (store) => (await this.rows(store, scope)).filter((entry) => entry.state !== "revoked"));
  }

  /** Candidates only: the adapter must still re-authorize before transmission. */
  async pending(rawScope: OutboxScope): Promise<Entry[]> {
    return (await this.recoverable(rawScope)).filter((entry) => entry.state === "pending");
  }

  async headers(rawScope: OutboxScope): Promise<Omit<Entry, "snapshot" | "update">[]> {
    const scope = scopeSchema.parse(rawScope);
    return this.transaction("readonly", async (store) => (await this.rows(store, scope)).map(({ snapshot: _snapshot, update: _update, ...header }) => header));
  }

  async acknowledge(rawReceipt: AppliedReceipt): Promise<boolean> {
    const receipt = receiptSchema.parse(rawReceipt);
    const scope = scopeSchema.parse({ accountId: receipt.accountId, ...receipt.document });
    return this.transaction("readwrite", async (store) => {
      const value: unknown = await request(store.get(entryKey(scope, receipt.operationId)));
      if (value === undefined) return false;
      const entry = entrySchema.parse(value);
      if (entry.state === "revoked") return false;
      const draft: PendingDraft<string> = { ...entry, document: receipt.document };
      const result = settleDraft(draft, receipt);
      if (result.state === "acknowledged") {
        await request(store.delete(entryKey(scope, receipt.operationId)));
        return true;
      }
      await request(store.put({ ...entry, state: "conflict" } satisfies Entry));
      return false;
    });
  }

  async quarantine(rawScope: OutboxScope): Promise<void> {
    const scope = scopeSchema.parse(rawScope);
    await this.transaction("readwrite", async (store) => {
      for (const entry of await this.rows(store, scope)) await request(store.put({ ...entry, state: "revoked" } satisfies Entry));
    });
  }

  /** Only an explicit user's discard action may call this, not a failed sync. */
  async discard(rawScope: OutboxScope, operationId: string): Promise<void> {
    const scope = scopeSchema.parse(rawScope);
    await this.transaction("readwrite", async (store) => {
      await request(store.delete(entryKey(scope, keyPart.parse(operationId))));
    });
  }

  async close(): Promise<void> {
    if (this.connection) (await this.connection).close();
    this.connection = null;
  }
}
