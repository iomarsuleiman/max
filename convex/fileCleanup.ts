import type { DatabaseWriter } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Db, Storage } from "../lib/domain/db";
import { MaxError } from "../lib/domain/errors";
import { convexUploadStore } from "./uploadStore";

export const NATIVE_FILE_CLEANUP_LIMIT = 1000;
const conflict = (message: string) => new MaxError("CONFLICT", message);

/**
 * Trusted, scoped storage.remove requests only. Run after attachment row writes
 * in the SAME native mutation. Convex makes storage and receipt removal atomic.
 * No public caller may select storage IDs directly through this helper.
 */
export async function retireNativeFiles(
  nativeDb: DatabaseWriter,
  personalDb: Db,
  ownerId: string,
  storageIds: readonly string[],
  storage: Storage,
): Promise<void> {
  if (!ownerId || ownerId.trim() !== ownerId || /[\u0000-\u001f]/.test(ownerId)) throw new MaxError("INTERNAL", "File cleanup account scope is unavailable.");
  if (storageIds.length > NATIVE_FILE_CLEANUP_LIMIT) throw new MaxError("LIMIT", "Too many files were selected for one cleanup.");
  const store = convexUploadStore(nativeDb);
  const plans: { storageId: Id<"_storage">; removeBytes: boolean; receiptId: Id<"uploadReceipts"> | null }[] = [];
  // Validate the entire selection before the first storage or metadata write.
  for (const storageId of new Set(storageIds)) {
    const id = nativeDb.system.normalizeId("_storage", storageId);
    if (!id) throw conflict("File cleanup storage scope is invalid.");
    const receipt = await store.transaction((tx) => tx.getByStorageId(storageId));
    if (receipt && receipt.ownerId !== ownerId) throw conflict("These file bytes belong to another account.");
    const receiptRows = receipt
      ? await nativeDb
          .query("uploadReceipts")
          .withIndex("by_logicalId", (q) => q.eq("logicalId", receipt.id))
          .take(2)
      : [];
    if (receipt && (receiptRows.length !== 1 || receiptRows[0].ownerId !== ownerId)) throw conflict("Upload cleanup metadata is inconsistent.");
    const receiptId = receiptRows[0]?._id ?? null;
    const references = await nativeDb
      .query("assets")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .take(NATIVE_FILE_CLEANUP_LIMIT + 1);
    if (references.length > NATIVE_FILE_CLEANUP_LIMIT) throw new MaxError("LIMIT", "File cleanup references exceed the supported limit.");
    for (const reference of references) {
      const visible = await personalDb.get("assets", reference._id);
      if (reference.ownerId !== ownerId || !visible || visible._id !== reference._id || visible.ownerId !== ownerId || visible.storageId !== storageId)
        throw conflict("File cleanup has shared or unresolved attachment references.");
    }
    const metadata = await nativeDb.system.get(id);
    if (references.length && !metadata) throw conflict("Referenced file bytes are missing.");
    if (metadata && receipt) {
      const sha256 = Array.from(atob(metadata.sha256), (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      if (
        !("blob" in receipt) ||
        receipt.state === "cleaned" ||
        metadata.size !== receipt.blob.size ||
        (metadata.contentType ?? "application/octet-stream") !== receipt.blob.type ||
        sha256 !== receipt.blob.sha256
      )
        throw conflict("File bytes do not match their upload receipt.");
    }
    if (receipt?.state === "registered") {
      const assetId = nativeDb.normalizeId("assets", receipt.assetId);
      if (!assetId) throw conflict("Registered attachment scope is invalid.");
      const registered = await nativeDb.get(assetId);
      if (registered && (registered.ownerId !== ownerId || registered.storageId !== storageId || !(await personalDb.get("assets", registered._id))))
        throw conflict("Registered attachment ownership is inconsistent.");
      if (references.length) {
        if (!registered) plans.push({ storageId: id, removeBytes: false, receiptId });
        continue;
      }
    } else if (references.length) {
      if (receipt?.state === "cleaning" || receipt?.state === "cleaned") throw conflict("Cleanup bytes were referenced after retirement.");
      continue;
    }
    plans.push({ storageId: id, removeBytes: metadata !== null, receiptId });
  }
  for (const plan of plans) {
    if (plan.removeBytes) await storage.remove(plan.storageId);
    if (plan.receiptId) await nativeDb.delete(plan.receiptId);
  }
}
