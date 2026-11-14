import { ConvexError, v, type Infer } from "convex/values";
import { internalMutation } from "./_generated/server";
import { convexUploadStore } from "./uploadStore";
import { UPLOAD_LIMITS, type StoredUpload } from "../lib/domain/uploads";

const attempt = v.object({ receiptId: v.string(), ownerId: v.string(), attemptId: v.string() });
const blob = v.object({ storageId: v.string(), size: v.number(), type: v.string(), sha256: v.string() });
const claim = v.object({ receiptId: v.string(), cleanupId: v.string(), storageId: v.string() });
const adoptionResult = v.union(
  v.object({ state: v.literal("preserved"), storageId: v.string() }),
  v.object({ state: v.literal("cleaning"), claim, blob }),
  v.object({ state: v.literal("cleaned"), storageId: v.string() }),
);
const fail = (code: "NOT_FOUND" | "CONFLICT" | "INTERNAL", message: string) => new ConvexError({ code, message });
const validId = (value: string) => !!value && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f]/.test(value);
const sameBlob = (left: StoredUpload, right: StoredUpload) =>
  left.storageId === right.storageId && left.size === right.size && left.type === right.type && left.sha256 === right.sha256;

/**
 * Trusted HTTP receiver only, after storage.store returned this fresh ID.
 * This does not authenticate arbitrary client-selected storage IDs. It records
 * cleanup eligibility but never deletes bytes or reverses completed registration.
 * Process death before this mutation still requires storage inventory recovery.
 */
export const adopt = internalMutation({
  args: { attempt, storageId: v.id("_storage"), orphanId: v.string(), capabilityHash: v.string(), cleanupId: v.string() },
  returns: adoptionResult,
  handler: async (ctx, args): Promise<Infer<typeof adoptionResult>> => {
    if (!validId(args.orphanId) || !validId(args.cleanupId) || !validId(args.attempt.attemptId) || !/^[a-f0-9]{64}$/.test(args.capabilityHash))
      throw fail("INTERNAL", "Orphan cleanup identifiers are unavailable.");
    return convexUploadStore(ctx.db).transaction<Infer<typeof adoptionResult>>(async (tx) => {
      const original = await tx.get(args.attempt.receiptId);
      if (!original || original.ownerId !== args.attempt.ownerId || original.state === "issued") throw fail("NOT_FOUND", "Upload attempt not found.");
      const existing = await tx.getByStorageId(args.storageId);
      if (existing && existing.ownerId !== original.ownerId) throw fail("CONFLICT", "These bytes belong to another upload owner.");
      if (existing?.state !== "stored" && existing?.state !== "registered") {
        const reference = await ctx.db
          .query("assets")
          .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
          .take(1);
        if (reference.length) throw fail("CONFLICT", "These bytes are already referenced by an attachment.");
      }
      const metadata = await ctx.db.system.get(args.storageId);
      // Cleaned receipts remain idempotent after the storage object is gone.
      if (!metadata) {
        if (existing?.state === "cleaned") return { state: "cleaned", storageId: args.storageId };
        throw fail("NOT_FOUND", "Stored upload not found.");
      }
      const actual: StoredUpload = {
        storageId: args.storageId,
        size: metadata.size,
        type: metadata.contentType ?? "application/octet-stream",
        sha256: Array.from(atob(metadata.sha256), (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
      };
      if (metadata._creationTime < original.createdAt || actual.size < 1 || actual.size > UPLOAD_LIMITS.bytes || !/^[a-f0-9]{64}$/.test(actual.sha256))
        throw fail("CONFLICT", "Stored upload metadata is inconsistent with this attempt.");
      if (existing && (!("blob" in existing) || !sameBlob(existing.blob, actual))) throw fail("CONFLICT", "Stored upload metadata is inconsistent.");
      if (existing?.state === "stored" || existing?.state === "registered") return { state: "preserved", storageId: args.storageId };
      // No asset reference, under any owner, may be turned into cleanup work.
      if (existing?.state === "cleaning")
        return { state: "cleaning", claim: { receiptId: existing.id, cleanupId: existing.cleanupId, storageId: args.storageId }, blob: actual };
      if (existing?.state === "cleaned") return { state: "cleaned", storageId: args.storageId };
      const now = Date.now();
      await tx.insert({
        id: args.orphanId,
        ownerId: original.ownerId,
        capabilityHash: args.capabilityHash,
        createdAt: now,
        expiresAt: now,
        state: "cleaning",
        blob: actual,
        cleanupId: args.cleanupId,
        leaseUntil: now + UPLOAD_LIMITS.cleanupLeaseMs,
      });
      return { state: "cleaning", claim: { receiptId: args.orphanId, cleanupId: args.cleanupId, storageId: args.storageId }, blob: actual };
    });
  },
});
