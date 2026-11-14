import { ConvexError, v } from "convex/values";
import { MaxError } from "../lib/domain/errors";
import { internalMutation, internalQuery } from "./_generated/server";
import { convexUploadStore } from "./uploadStore";
import { UploadService, type UploadRuntime } from "../lib/domain/uploads";

const blob = v.object({ storageId: v.string(), size: v.number(), type: v.string(), sha256: v.string() });
const attempt = v.object({ receiptId: v.string(), ownerId: v.string(), attemptId: v.string() });

async function boundary<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof MaxError) throw new ConvexError({ code: error.code, message: error.message });
    throw error;
  }
}

function runtime(nextId?: string): UploadRuntime {
  return {
    now: () => Date.now(),
    newId: () => {
      if (!nextId) throw new Error("An action-generated upload identifier is required.");
      return nextId;
    },
    createCapability: () => {
      throw new Error("Upload entropy belongs in an action.");
    },
    hashCapability: async () => {
      throw new Error("Capabilities must be hashed before entering a mutation.");
    },
  };
}

/** Actor and entropy are supplied only by the authenticated upload action. */
export const issue = internalMutation({
  args: { ownerId: v.string(), id: v.string(), capabilityHash: v.string() },
  returns: v.object({ expiresAt: v.number() }),
  handler: (ctx, { ownerId, id, capabilityHash }) =>
    boundary(() => new UploadService(convexUploadStore(ctx.db), runtime()).issuePrepared(ownerId, { id, capabilityHash })),
});

/** Only the trusted HTTP byte receiver may exchange a capability for a lease. */
export const begin = internalMutation({
  args: { capabilityHash: v.string(), attemptId: v.string() },
  returns: v.union(
    v.object({ state: v.literal("receiving"), attempt, leaseUntil: v.number() }),
    v.object({ state: v.literal("stored"), blob }),
    v.object({ state: v.literal("registered"), blob, assetId: v.string() }),
  ),
  handler: (ctx, { capabilityHash, attemptId }) => boundary(() => new UploadService(convexUploadStore(ctx.db), runtime(attemptId)).beginHashed(capabilityHash)),
});

/** Metadata is measured from stored bytes in the receiver, never client JSON. */
export const complete = internalMutation({
  args: { attempt, blob },
  returns: blob,
  handler: (ctx, args) => boundary(() => new UploadService(convexUploadStore(ctx.db), runtime()).complete(args.attempt, args.blob)),
});

/** Storage supplies the digest without buffering a second full copy in HTTP memory. */
export const storedMetadata = internalQuery({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.null(), v.object({ size: v.number(), type: v.string(), sha256: v.string() })),
  handler: async (ctx, { storageId }) => {
    const stored = await ctx.db.system.get(storageId);
    if (!stored) return null;
    const sha256 = Array.from(atob(stored.sha256), (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join("");
    return { size: stored.size, type: stored.contentType ?? "application/octet-stream", sha256 };
  },
});
