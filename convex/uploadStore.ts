import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { UploadReceipt, UploadStore } from "../lib/domain/uploads";
import { MaxError } from "../lib/domain/errors";

function unique<T>(rows: T[]): T | null {
  if (rows.length > 1) throw new MaxError("INTERNAL", "Upload ownership metadata is inconsistent.");
  return rows[0] ?? null;
}
function receipt(row: Doc<"uploadReceipts">): UploadReceipt {
  const { _id: _nativeId, _creationTime: _at, logicalId, ...data } = row;
  return { id: logicalId, ...data };
}
function stored(value: UploadReceipt) {
  const { id, ...data } = value;
  return { logicalId: id, ...data };
}

/** Must share one outer native transaction with attachment writes. Never public. */
export function convexUploadStore(db: DatabaseReader | DatabaseWriter): UploadStore {
  const writer = (): DatabaseWriter => {
    if (!("insert" in db)) throw new MaxError("INTERNAL", "Upload writes require a mutation.");
    return db;
  };
  const byId = async (id: string) =>
    unique(
      await db
        .query("uploadReceipts")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", id))
        .take(2),
    );
  const byHash = async (hash: string) =>
    unique(
      await db
        .query("uploadReceipts")
        .withIndex("by_capabilityHash", (q) => q.eq("capabilityHash", hash))
        .take(2),
    );
  const byStorageId = async (id: string) =>
    unique(
      await db
        .query("uploadReceipts")
        .withIndex("by_blob_storageId", (q) => q.eq("blob.storageId", id))
        .take(2),
    );
  async function checked(row: Doc<"uploadReceipts"> | null): Promise<UploadReceipt | null> {
    if (!row) return null;
    const identity = await byId(row.logicalId);
    const capability = await byHash(row.capabilityHash);
    const blob = "blob" in row ? await byStorageId(row.blob.storageId) : row;
    if (identity?._id !== row._id || capability?._id !== row._id || blob?._id !== row._id)
      throw new MaxError("INTERNAL", "Upload ownership metadata is inconsistent.");
    return receipt(row);
  }
  async function assertUnique(value: UploadReceipt) {
    const hashOwner = await byHash(value.capabilityHash);
    if (hashOwner && hashOwner.logicalId !== value.id) throw new MaxError("CONFLICT", "Upload capability already exists.");
    if ("blob" in value) {
      const blobOwner = await byStorageId(value.blob.storageId);
      if (blobOwner && blobOwner.logicalId !== value.id) throw new MaxError("CONFLICT", "These bytes already belong to another upload.");
    }
  }
  return {
    transaction: (body) =>
      body({
        get: async (id) => {
          return checked(await byId(id));
        },
        getByCapabilityHash: async (hash) => {
          return checked(await byHash(hash));
        },
        getByStorageId: async (id) => {
          return checked(await byStorageId(id));
        },
        async insert(value) {
          if (await byId(value.id)) throw new MaxError("CONFLICT", "Upload receipt already exists.");
          await assertUnique(value);
          await writer().insert("uploadReceipts", stored(value));
        },
        async put(value) {
          const prior = await byId(value.id);
          if (!prior) throw new MaxError("NOT_FOUND", "Upload receipt not found.");
          if (
            prior.ownerId !== value.ownerId ||
            prior.capabilityHash !== value.capabilityHash ||
            prior.createdAt !== value.createdAt ||
            prior.expiresAt !== value.expiresAt
          )
            throw new MaxError("CONFLICT", "Upload identity is immutable.");
          if (
            "blob" in prior &&
            (!("blob" in value) ||
              prior.blob.storageId !== value.blob.storageId ||
              prior.blob.size !== value.blob.size ||
              prior.blob.type !== value.blob.type ||
              prior.blob.sha256 !== value.blob.sha256)
          )
            throw new MaxError("CONFLICT", "Received upload bytes are immutable.");
          if (
            prior.state === "registered" &&
            (value.state !== "registered" ||
              prior.assetId !== value.assetId ||
              prior.registrationKey !== value.registrationKey ||
              prior.registeredAt !== value.registeredAt ||
              prior.receivedByAttemptId !== value.receivedByAttemptId)
          )
            throw new MaxError("CONFLICT", "Completed upload receipts are immutable.");
          if (prior.state === "cleaned" && (value.state !== "cleaned" || prior.cleanedAt !== value.cleanedAt))
            throw new MaxError("CONFLICT", "Completed upload receipts are immutable.");
          await assertUnique(value);
          await writer().replace(prior._id, stored(value));
        },
      }),
  };
}
