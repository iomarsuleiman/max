import { defineTable } from "convex/server";
import { v } from "convex/values";

const identity = {
  logicalId: v.string(),
  ownerId: v.string(),
  capabilityHash: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
};
const blob = v.object({ storageId: v.string(), size: v.number(), type: v.string(), sha256: v.string() });

/** Internal upload ownership receipts; only a trusted receiver may persist blobs. */
export const uploadTables = {
  uploadReceipts: defineTable(
    v.union(
      v.object({ ...identity, state: v.literal("issued") }),
      v.object({ ...identity, state: v.literal("receiving"), attemptId: v.string(), leaseUntil: v.number() }),
      v.object({ ...identity, state: v.literal("stored"), blob, receivedByAttemptId: v.string(), storedAt: v.number(), registerUntil: v.number() }),
      v.object({
        ...identity,
        state: v.literal("registered"),
        blob,
        receivedByAttemptId: v.string(),
        assetId: v.string(),
        registrationKey: v.string(),
        registeredAt: v.number(),
      }),
      v.object({ ...identity, state: v.literal("cleaning"), blob, cleanupId: v.string(), leaseUntil: v.number() }),
      v.object({ ...identity, state: v.literal("cleaned"), blob, cleanedAt: v.number() }),
    ),
  )
    .index("by_logicalId", ["logicalId"])
    .index("by_capabilityHash", ["capabilityHash"])
    .index("by_ownerId", ["ownerId"])
    .index("by_blob_storageId", ["blob.storageId"])
    .index("by_state_registerUntil", ["state", "registerUntil"])
    .index("by_state_leaseUntil", ["state", "leaseUntil"]),
};
