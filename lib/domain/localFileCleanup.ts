import type { Db } from "./db";
import { MaxError } from "./errors";
import type { MemoryDb } from "./memoryDb";
import type { ReadLocalUploadMetadata } from "./localUploadAccount";
import { localUploadStore } from "./localUploadStore";
import { UPLOAD_LIMITS, type StoredUpload, type UploadCleanup, type UploadReceipt, type UploadRuntime } from "./uploads";

export const LOCAL_FILE_CLEANUP_LIMIT = 1000;
const safeStorageId = (value: string) => /^[a-z0-9]{8,40}$/.test(value);
const validId = (value: string) => !!value && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f]/.test(value);
const identity = (receipt: UploadReceipt) => ({
  id: receipt.id,
  ownerId: receipt.ownerId,
  capabilityHash: receipt.capabilityHash,
  createdAt: receipt.createdAt,
  expiresAt: receipt.expiresAt,
});
const conflict = (message: string) => new MaxError("CONFLICT", message);
type Plan =
  { kind: "remove"; physicalId: string } | { kind: "replace"; physicalId: string; receipt: UploadReceipt } | { kind: "insert"; receipt: UploadReceipt };

/**
 * Trusted scoped storage.remove IDs only, after attachment rows are removed.
 * Caller owns the serialized outer transaction and persists these rows BEFORE
 * deleting files. This privileged retirement is not upload registration: only
 * this path may retire a registered receipt after checking all live references.
 */
export async function stageLocalFileDeletions(
  db: MemoryDb,
  ownerId: string,
  storageIds: readonly string[],
  readMetadata: ReadLocalUploadMetadata,
  runtime: UploadRuntime,
  personalDb: Db,
): Promise<UploadCleanup[]> {
  if (!validId(ownerId)) throw new MaxError("INTERNAL", "File cleanup account scope is unavailable.");
  if (storageIds.length > LOCAL_FILE_CLEANUP_LIMIT) throw new MaxError("LIMIT", "Too many files were selected for one cleanup.");
  const owned = await db.list("uploadReceipts", ownerId);
  const cleaningCount = owned.filter((receipt) => receipt.state === "cleaning").length;
  if (cleaningCount > LOCAL_FILE_CLEANUP_LIMIT) throw new MaxError("LIMIT", "Upload cleanup exceeds the supported pending-file limit.");
  const now = runtime.now();
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - UPLOAD_LIMITS.cleanupLeaseMs)
    throw new MaxError("INTERNAL", "The cleanup clock is unavailable.");
  const store = localUploadStore(db);
  const plans: Plan[] = [];
  const claims: UploadCleanup[] = [];
  const newIds = new Set<string>();
  const newHashes = new Set<string>();
  let futureCount = cleaningCount;
  // Complete validation before applying even the first metadata transition.
  for (const storageId of new Set(storageIds)) {
    if (!safeStorageId(storageId)) throw conflict("File cleanup storage scope is invalid.");
    const receipt = await store.transaction((tx) => tx.getByStorageId(storageId));
    if (receipt && receipt.ownerId !== ownerId) throw conflict("These file bytes belong to another account.");
    const physical = receipt ? (await db.findUploadReceipts({ field: "id", value: receipt.id }))[0] : null;
    if (receipt && !physical) throw conflict("Upload cleanup metadata is unavailable.");
    const references = await db.findAssetReferences(storageId);
    if (references.length > LOCAL_FILE_CLEANUP_LIMIT) throw new MaxError("LIMIT", "File cleanup references exceed the supported limit.");
    for (const asset of references) {
      const visible = await personalDb.get("assets", asset._id);
      if (asset.ownerId !== ownerId || !visible || visible._id !== asset._id || visible.ownerId !== ownerId || visible.storageId !== storageId)
        throw conflict("File cleanup has shared or unresolved attachment references.");
    }
    const metadata = await readMetadata(storageId);
    if (references.length && !metadata) throw conflict("Referenced file bytes are missing.");
    if (metadata) {
      if (
        !Number.isSafeInteger(metadata.size) ||
        metadata.size < 1 ||
        metadata.size > UPLOAD_LIMITS.bytes ||
        !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(metadata.type) ||
        metadata.type.length > 100 ||
        !/^[a-f0-9]{64}$/.test(metadata.sha256)
      )
        throw conflict("File cleanup metadata is invalid.");
      if (
        receipt &&
        (!("blob" in receipt) ||
          receipt.blob.size !== metadata.size ||
          receipt.blob.type !== metadata.type ||
          receipt.blob.sha256 !== metadata.sha256 ||
          receipt.state === "cleaned")
      )
        throw conflict("File bytes do not match their upload receipt.");
    }
    if (receipt?.state === "registered") {
      const registered = await db.get("assets", receipt.assetId);
      if (registered && (registered.ownerId !== ownerId || registered.storageId !== storageId || !(await personalDb.get("assets", registered._id))))
        throw conflict("Registered attachment ownership is inconsistent.");
      if (references.length) {
        if (!registered && physical) {
          plans.push({ kind: "remove", physicalId: physical._id });
        }
        continue;
      }
    } else if (references.length) {
      if (receipt?.state === "cleaning" || receipt?.state === "cleaned") throw conflict("Cleanup bytes were referenced after their retirement.");
      continue;
    }
    if (!metadata) {
      if (receipt && "blob" in receipt && physical && receipt.state !== "cleaned") {
        plans.push({ kind: "replace", physicalId: physical._id, receipt: { ...identity(receipt), state: "cleaned", blob: receipt.blob, cleanedAt: now } });
        if (receipt.state === "cleaning") futureCount--;
      }
      continue;
    }
    const blob: StoredUpload = { storageId, ...metadata };
    if (receipt) {
      if (
        !("blob" in receipt) ||
        receipt.blob.size !== blob.size ||
        receipt.blob.type !== blob.type ||
        receipt.blob.sha256 !== blob.sha256 ||
        receipt.state === "cleaned"
      )
        throw conflict("File bytes do not match their upload receipt.");
      if (receipt.state === "cleaning") {
        claims.push({ receiptId: receipt.id, cleanupId: receipt.cleanupId, storageId });
        continue;
      }
      const cleanupId = runtime.newId();
      if (!validId(cleanupId) || !physical) throw new MaxError("INTERNAL", "Cleanup identifiers are unavailable.");
      plans.push({
        kind: "replace",
        physicalId: physical._id,
        receipt: { ...identity(receipt), state: "cleaning", blob, cleanupId, leaseUntil: now + UPLOAD_LIMITS.cleanupLeaseMs },
      });
      claims.push({ receiptId: receipt.id, cleanupId, storageId });
      futureCount++;
    } else {
      const id = runtime.newId();
      const cleanupId = runtime.newId();
      const capabilityHash = await runtime.hashCapability(runtime.createCapability());
      if (
        !validId(id) ||
        !validId(cleanupId) ||
        !/^[a-f0-9]{64}$/.test(capabilityHash) ||
        newIds.has(id) ||
        newHashes.has(capabilityHash) ||
        (await store.transaction((tx) => tx.get(id))) ||
        (await store.transaction((tx) => tx.getByCapabilityHash(capabilityHash)))
      )
        throw new MaxError("INTERNAL", "Cleanup identifiers are unavailable or duplicated.");
      newIds.add(id);
      newHashes.add(capabilityHash);
      plans.push({
        kind: "insert",
        receipt: {
          id,
          ownerId,
          capabilityHash,
          createdAt: now,
          expiresAt: now,
          state: "cleaning",
          blob,
          cleanupId,
          leaseUntil: now + UPLOAD_LIMITS.cleanupLeaseMs,
        },
      });
      claims.push({ receiptId: id, cleanupId, storageId });
      futureCount++;
    }
  }
  if (futureCount > LOCAL_FILE_CLEANUP_LIMIT) throw new MaxError("LIMIT", "Upload cleanup exceeds the supported pending-file limit.");
  for (const plan of plans) {
    if (plan.kind === "remove") await db.delete("uploadReceipts", plan.physicalId);
    else if (plan.kind === "replace") await db.replaceUploadReceipt(plan.physicalId, plan.receipt);
    else await store.transaction((tx) => tx.insert(plan.receipt));
  }
  return claims;
}

/** Reconstruct committed claims after restart. Physical deletion is external. */
export async function getPendingLocalCleanup(db: MemoryDb, ownerId: string): Promise<UploadCleanup[]> {
  if (!validId(ownerId)) throw new MaxError("INTERNAL", "File cleanup account scope is unavailable.");
  const owned = (await db.list("uploadReceipts", ownerId)).filter((receipt) => receipt.state === "cleaning");
  if (owned.length > LOCAL_FILE_CLEANUP_LIMIT) throw new MaxError("LIMIT", "Upload cleanup exceeds the supported pending-file limit.");
  const store = localUploadStore(db);
  const claims: UploadCleanup[] = [];
  for (const row of owned) {
    if (row.state !== "cleaning") continue;
    const receipt = await store.transaction((tx) => tx.get(row.id));
    if (
      !receipt ||
      receipt.ownerId !== ownerId ||
      receipt.state !== "cleaning" ||
      !validId(receipt.id) ||
      !validId(receipt.cleanupId) ||
      !/^[a-f0-9]{64}$/.test(receipt.capabilityHash) ||
      !Number.isSafeInteger(receipt.leaseUntil) ||
      receipt.leaseUntil < 0 ||
      !safeStorageId(receipt.blob.storageId) ||
      !Number.isSafeInteger(receipt.blob.size) ||
      receipt.blob.size < 1 ||
      receipt.blob.size > UPLOAD_LIMITS.bytes ||
      receipt.blob.type.length > 100 ||
      !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(receipt.blob.type) ||
      !/^[a-f0-9]{64}$/.test(receipt.blob.sha256)
    )
      throw conflict("File cleanup ownership is inconsistent.");
    if ((await db.findAssetReferences(receipt.blob.storageId)).length) throw conflict("Cleanup bytes are still referenced by an attachment.");
    claims.push({ receiptId: receipt.id, cleanupId: receipt.cleanupId, storageId: receipt.blob.storageId });
  }
  return claims;
}
