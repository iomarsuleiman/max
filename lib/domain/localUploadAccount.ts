import type { Db, Storage } from "./db";
import { MaxError } from "./errors";
import type { MemoryDb } from "./memoryDb";
import { localUploadStore } from "./localUploadStore";

export const LOCAL_ACCOUNT_UPLOAD_LIMIT = 1000;
export interface LocalUploadMetadata {
  size: number;
  type: string;
  sha256: string;
}
/** Read actual bytes and sidecar type, not attachment-request metadata. */
export type ReadLocalUploadMetadata = (storageId: string) => Promise<LocalUploadMetadata | null>;

async function ownedReceipts(db: MemoryDb, personalDb: Db, ownerId: string, readMetadata: ReadLocalUploadMetadata) {
  if (!ownerId) throw new MaxError("INTERNAL", "Upload account scope is unavailable.");
  const rows = await db.list("uploadReceipts", ownerId);
  if (rows.length > LOCAL_ACCOUNT_UPLOAD_LIMIT)
    throw new MaxError("LIMIT", "This account has too many upload receipts for one deletion. Preserve a backup and use bounded account cleanup.");
  const store = localUploadStore(db);
  const present = new Set<string>();
  for (const row of rows) {
    const receipt = await store.transaction((tx) => tx.get(row.id));
    if (!receipt || receipt.ownerId !== ownerId) throw new MaxError("CONFLICT", "Upload ownership could not be established.");
    if (!("blob" in receipt)) continue;
    const storageId = receipt.blob.storageId;
    if (!/^[a-z0-9]{8,40}$/.test(storageId)) throw new MaxError("CONFLICT", "Upload storage scope is invalid.");
    const references = await db.findAssetReferences(storageId);
    if (references.length > LOCAL_ACCOUNT_UPLOAD_LIMIT) throw new MaxError("LIMIT", "Upload references exceed the supported deletion limit.");
    for (const asset of references) {
      const visible = await personalDb.get("assets", asset._id);
      if (asset.ownerId !== ownerId || !visible || visible._id !== asset._id || visible.ownerId !== ownerId || visible.storageId !== storageId)
        throw new MaxError("CONFLICT", "Upload bytes have shared or unresolved attachment references.");
    }
    const metadata = await readMetadata(storageId);
    if (metadata) {
      if (metadata.size !== receipt.blob.size || metadata.type !== receipt.blob.type || metadata.sha256 !== receipt.blob.sha256 || receipt.state === "cleaned")
        throw new MaxError("CONFLICT", "Upload bytes do not match their ownership receipt.");
      present.add(storageId);
    } else if ((receipt.state !== "registered" && receipt.state !== "cleaned") || references.length > 0) {
      throw new MaxError("CONFLICT", "Pending or referenced upload bytes are missing. Preserve a backup and resolve their scope first.");
    }
    if (receipt.state === "registered") {
      const asset = await db.get("assets", receipt.assetId);
      if (asset && (asset.ownerId !== ownerId || asset.storageId !== storageId || !(await personalDb.get("assets", asset._id))))
        throw new MaxError("CONFLICT", "Registered attachment ownership is inconsistent.");
    }
  }
  return { rows, present };
}

/** Same serialized transaction as account removal, before any row/file changes. */
export async function preflightLocalUploadDeletion(db: MemoryDb, personalDb: Db, ownerId: string, readMetadata: ReadLocalUploadMetadata): Promise<void> {
  await ownedReceipts(db, personalDb, ownerId, readMetadata);
}

/**
 * storage.remove MUST stage deletion for after the durable outer commit, never
 * unlink a live file here. The caller rolls staged removals back on any failure.
 */
export async function deleteLocalOwnerUploads(
  db: MemoryDb,
  personalDb: Db,
  ownerId: string,
  readMetadata: ReadLocalUploadMetadata,
  storage: Storage,
): Promise<void> {
  const { rows, present } = await ownedReceipts(db, personalDb, ownerId, readMetadata);
  for (const row of rows) {
    if ("blob" in row && row.state !== "cleaned" && present.has(row.blob.storageId)) await storage.remove(row.blob.storageId);
    // Removes issued and receiving capabilities too. In-flight receiver death
    // still requires orphan inventory recovery; no unknown bytes are guessed.
    await db.delete("uploadReceipts", row._id);
  }
}
