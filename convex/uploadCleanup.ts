import { ConvexError, v } from "convex/values";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { convexUploadStore } from "./uploadStore";
import { UploadService, UPLOAD_LIMITS, type UploadRuntime } from "../lib/domain/uploads";
import { createUploadRuntime } from "../lib/domain/uploadRuntime";

export const UPLOAD_CLEANUP_BATCH = 25;
const fail = (message: string) => new ConvexError({ code: "CONFLICT", message });
const validId = (value: string) => !!value && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f]/.test(value);
const clock = (now: number) => {
  if (!Number.isSafeInteger(now) || now < 0) throw fail("The upload cleanup clock is unavailable.");
  return now;
};

/** Internal discovery only. Every candidate is checked again in its mutation. */
export const candidates = internalQuery({
  args: { now: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { now }) => {
    clock(now);
    const groups = await Promise.all([
      ctx.db
        .query("uploadReceipts")
        .withIndex("by_state_registerUntil", (q) => q.eq("state", "stored").lte("registerUntil", now))
        .take(UPLOAD_CLEANUP_BATCH),
      ctx.db
        .query("uploadReceipts")
        .withIndex("by_state_leaseUntil", (q) => q.eq("state", "cleaning").lte("leaseUntil", now))
        .take(UPLOAD_CLEANUP_BATCH),
      ctx.db
        .query("uploadReceipts")
        .withIndex("by_state_expiresAt", (q) => q.eq("state", "issued").lte("expiresAt", now))
        .take(UPLOAD_CLEANUP_BATCH),
      ctx.db
        .query("uploadReceipts")
        .withIndex("by_state_expiresAt", (q) => q.eq("state", "receiving").lte("expiresAt", now - UPLOAD_LIMITS.pendingMs))
        .take(UPLOAD_CLEANUP_BATCH),
    ]);
    return groups
      .flat()
      .map((row) => row.logicalId)
      .sort();
  },
});

/** Internal helper, always inside the caller's one native transaction. */
export async function cleanupReceipt(
  ctx: Pick<MutationCtx, "db" | "storage">,
  { receiptId, cleanupId }: { receiptId: string; cleanupId: string },
): Promise<{ receiptRemoved: boolean; fileRemoved: boolean }> {
  if (!validId(cleanupId)) throw fail("Cleanup identity is unavailable.");
  const now = clock(Date.now());
  const store = convexUploadStore(ctx.db);
  const receipt = await store.transaction((tx) => tx.get(receiptId));
  const skipped = { receiptRemoved: false, fileRemoved: false };
  if (!receipt) return skipped;
  if (receipt.state === "registered" || receipt.state === "cleaned") return skipped;
  if (!validId(receipt.id) || !validId(receipt.ownerId) || !/^[a-f0-9]{64}$/.test(receipt.capabilityHash))
    throw fail("Upload cleanup ownership is inconsistent.");
  clock(receipt.createdAt);
  clock(receipt.expiresAt);
  if (receipt.state === "receiving" || receipt.state === "cleaning") clock(receipt.leaseUntil);
  if (receipt.state === "stored") {
    clock(receipt.storedAt);
    clock(receipt.registerUntil);
  }
  const rows = await ctx.db
    .query("uploadReceipts")
    .withIndex("by_logicalId", (q) => q.eq("logicalId", receiptId))
    .take(2);
  if (rows.length !== 1) throw fail("Upload ownership metadata is inconsistent.");
  const physical = rows[0];
  if (receipt.state === "issued" || receipt.state === "receiving") {
    const cutoff = receipt.state === "issued" ? now : now - UPLOAD_LIMITS.pendingMs;
    if (receipt.expiresAt > cutoff) return skipped;
    await ctx.db.delete(physical._id);
    return { receiptRemoved: true, fileRemoved: false };
  }
  if (receipt.state !== "stored" && receipt.state !== "cleaning") return skipped;
  if (
    !Number.isSafeInteger(receipt.blob.size) ||
    receipt.blob.size < 1 ||
    receipt.blob.size > UPLOAD_LIMITS.bytes ||
    receipt.blob.type.length > 100 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(receipt.blob.type) ||
    !/^[a-f0-9]{64}$/.test(receipt.blob.sha256)
  )
    throw fail("Upload cleanup metadata is inconsistent.");
  if (receipt.state === "stored" ? receipt.registerUntil > now : receipt.leaseUntil > now) return skipped;
  const references = await ctx.db
    .query("assets")
    .withIndex("by_storageId", (q) => q.eq("storageId", receipt.blob.storageId))
    .take(1);
  if (references.length) throw fail("Upload cleanup bytes still have an attachment reference.");
  const storageId = ctx.db.system.normalizeId("_storage", receipt.blob.storageId);
  if (!storageId) throw fail("Upload cleanup storage identity is invalid.");
  const metadata = await ctx.db.system.get(storageId);
  if (!metadata && receipt.state === "stored") throw fail("Pending upload bytes are missing.");
  if (metadata) {
    const sha256 = Array.from(atob(metadata.sha256), (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    if (metadata.size !== receipt.blob.size || (metadata.contentType ?? "application/octet-stream") !== receipt.blob.type || sha256 !== receipt.blob.sha256)
      throw fail("Upload cleanup bytes do not match their receipt.");
  }
  const runtime: UploadRuntime = {
    now: () => now,
    newId: () => cleanupId,
    createCapability: () => {
      throw new Error("Cleanup cannot create capabilities.");
    },
    hashCapability: async () => {
      throw new Error("Cleanup cannot hash capabilities.");
    },
  };
  const service = new UploadService(store, runtime);
  const claim = await service.claimCleanup(receiptId);
  if (!claim) return skipped;
  if (metadata) await ctx.storage.delete(storageId);
  await service.completeCleanup(claim);
  await ctx.db.delete(physical._id);
  return { receiptRemoved: true, fileRemoved: metadata !== null };
}

/** File deletion and receipt finalization share this one native transaction. */
export const cleanupOne = internalMutation({
  args: { receiptId: v.string(), cleanupId: v.string() },
  returns: v.object({ receiptRemoved: v.boolean(), fileRemoved: v.boolean() }),
  handler: cleanupReceipt,
});

interface SweepSummary {
  candidates: number;
  receiptsRemoved: number;
  filesRemoved: number;
  skipped: number;
  failed: number;
}

export const sweep = internalAction({
  args: {},
  returns: v.object({ candidates: v.number(), receiptsRemoved: v.number(), filesRemoved: v.number(), skipped: v.number(), failed: v.number() }),
  handler: async (ctx): Promise<SweepSummary> => {
    const runtime = createUploadRuntime();
    const ids = await ctx.runQuery(internal.uploadCleanup.candidates, { now: runtime.now() });
    const summary: SweepSummary = { candidates: ids.length, receiptsRemoved: 0, filesRemoved: 0, skipped: 0, failed: 0 };
    for (const receiptId of ids) {
      try {
        const result = await ctx.runMutation(internal.uploadCleanup.cleanupOne, { receiptId, cleanupId: runtime.newId() });
        if (result.receiptRemoved) summary.receiptsRemoved++;
        else summary.skipped++;
        if (result.fileRemoved) summary.filesRemoved++;
      } catch {
        // A corrupt or referenced candidate must not stop independent cleanup.
        // Return counts only; no owner, file or capability data enters logs.
        summary.failed++;
      }
    }
    return summary;
  },
});
