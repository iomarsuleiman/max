import type { LocalUploadDb } from "./db";
import { MaxError } from "./errors";
import type { Tables } from "./types";
import type { UploadReceipt, UploadStore } from "./uploads";

function unique<T>(rows: T[]): T | null {
  if (rows.length > 1) throw new MaxError("INTERNAL", "Upload ownership metadata is inconsistent.");
  return rows[0] ?? null;
}
function receipt(row: Tables["uploadReceipts"]): UploadReceipt {
  const { _id: _physicalId, ...value } = row;
  return value;
}

/**
 * Internal local adapter. Caller owns the serialized MemoryDb transaction AND
 * durable snapshot commit, including attachment writes. This adapter neither
 * starts a nested transaction nor persists independently. Pass the raw store,
 * never a client-supplied owner or a personal content facade.
 */
export function localUploadStore(db: LocalUploadDb): UploadStore {
  const byId = async (id: string) => unique(await db.findUploadReceipts({ field: "id", value: id }));
  const byHash = async (hash: string) => unique(await db.findUploadReceipts({ field: "capabilityHash", value: hash }));
  const byStorageId = async (storageId: string) => unique(await db.findUploadReceipts({ field: "blob.storageId", value: storageId }));

  async function checked(row: Tables["uploadReceipts"] | null): Promise<UploadReceipt | null> {
    if (!row) return null;
    const identity = await byId(row.id);
    const capability = await byHash(row.capabilityHash);
    const blob = "blob" in row ? await byStorageId(row.blob.storageId) : row;
    if (identity?._id !== row._id || capability?._id !== row._id || blob?._id !== row._id)
      throw new MaxError("INTERNAL", "Upload ownership metadata is inconsistent.");
    return receipt(row);
  }

  async function assertUnique(value: UploadReceipt): Promise<void> {
    const hashOwner = await byHash(value.capabilityHash);
    if (hashOwner && hashOwner.id !== value.id) throw new MaxError("CONFLICT", "Upload capability already exists.");
    if ("blob" in value) {
      const blobOwner = await byStorageId(value.blob.storageId);
      if (blobOwner && blobOwner.id !== value.id) throw new MaxError("CONFLICT", "These bytes already belong to another upload.");
    }
  }

  return {
    transaction: (body) =>
      body({
        get: async (id) => checked(await byId(id)),
        getByCapabilityHash: async (hash) => checked(await byHash(hash)),
        getByStorageId: async (storageId) => checked(await byStorageId(storageId)),
        async insert(value) {
          if (await byId(value.id)) throw new MaxError("CONFLICT", "Upload receipt already exists.");
          await assertUnique(value);
          await db.insert("uploadReceipts", value);
        },
        async put(value) {
          const prior = await byId(value.id);
          if (!prior) throw new MaxError("NOT_FOUND", "Upload receipt not found.");
          // Validate all prior indexes before changing any row. This catches
          // contradictory cross-owner records outside owner-scoped list results.
          await checked(prior);
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
          await db.replaceUploadReceipt(prior._id, value);
        },
      }),
  };
}
