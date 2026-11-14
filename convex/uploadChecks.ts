import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { UploadService } from "../lib/domain/uploads";
import { createUploadRuntime } from "../lib/domain/uploadRuntime";
import { convexUploadStore } from "./uploadStore";
import { MaxError } from "../lib/domain/errors";

function localSite(): string {
  const configured = process.env.CONVEX_SITE_URL;
  if (!configured) throw new Error("A local HTTP site is required for this synthetic probe.");
  const url = new URL(configured);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("The upload probe is restricted to an exact IPv4 loopback HTTP site.");
  return url.origin;
}

const ownedBlob = { ownerId: v.string(), receiptId: v.string(), storageId: v.string(), size: v.number(), sha256: v.string() };

/** Internal synthetic proof only. This is never an upload registration endpoint. */
export const verifyStored = internalMutation({
  args: ownedBlob,
  returns: v.object({ metadataMatches: v.boolean(), crossOwnerDenied: v.boolean() }),
  handler: async (ctx, args) => {
    localSite();
    if (!args.ownerId.startsWith("max-local-upload-probe-upload-")) throw new Error("Unexpected synthetic account.");
    const store = convexUploadStore(ctx.db);
    const receipt = await store.transaction((tx) => tx.get(args.receiptId));
    const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
    if (!storageId) throw new Error("The upload acknowledgement did not contain a native storage ID.");
    const measured = await ctx.db.system.get(storageId);
    const sha256 = measured ? Array.from(atob(measured.sha256), (b) => b.charCodeAt(0).toString(16).padStart(2, "0")).join("") : null;
    if (
      !receipt ||
      receipt.ownerId !== args.ownerId ||
      receipt.state !== "stored" ||
      receipt.blob.storageId !== args.storageId ||
      receipt.blob.size !== args.size ||
      receipt.blob.type !== "text/plain" ||
      receipt.blob.sha256 !== args.sha256 ||
      !measured ||
      measured.size !== args.size ||
      measured.contentType !== "text/plain" ||
      sha256 !== args.sha256
    )
      throw new Error("Received bytes, native storage metadata and ownership receipt did not match.");
    let crossOwnerDenied = false;
    try {
      await new UploadService(store, createUploadRuntime()).register(
        `${args.ownerId}-foreign`,
        receipt.blob,
        "synthetic-foreign-attempt",
        async () => {
          throw new Error("Foreign ownership reached attachment commit.");
        },
        async () => {
          throw new Error("Foreign ownership reached attachment replay.");
        },
      );
    } catch (error) {
      if (!(error instanceof MaxError) || error.code !== "NOT_FOUND") throw error;
      crossOwnerDenied = true;
    }
    if (!crossOwnerDenied) throw new Error("Foreign ownership was accepted.");
    return { metadataMatches: true, crossOwnerDenied };
  },
});

/** Delete only this probe's acknowledged, measured synthetic receipt and blob. */
export const cleanupStored = internalMutation({
  args: ownedBlob,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    localSite();
    if (!args.ownerId.startsWith("max-local-upload-probe-upload-")) throw new Error("Unexpected synthetic account.");
    const rows = await ctx.db
      .query("uploadReceipts")
      .withIndex("by_logicalId", (q) => q.eq("logicalId", args.receiptId))
      .take(2);
    const receipt = rows[0];
    if (
      rows.length !== 1 ||
      !receipt ||
      receipt.ownerId !== args.ownerId ||
      receipt.state !== "stored" ||
      receipt.blob.storageId !== args.storageId ||
      receipt.blob.size !== args.size ||
      receipt.blob.sha256 !== args.sha256
    )
      throw new Error("Synthetic cleanup ownership could not be established.");
    const storageId = ctx.db.system.normalizeId("_storage", args.storageId);
    if (!storageId) throw new Error("Synthetic cleanup storage ID was invalid.");
    await ctx.storage.delete(storageId);
    await ctx.db.delete(receipt._id);
    return true;
  },
});

function body(size: number): ReadableStream<Uint8Array<ArrayBuffer>> {
  let remaining = size;
  return new ReadableStream({
    pull(controller) {
      if (remaining === 0) {
        controller.close();
        return;
      }
      const bytes = Math.min(remaining, 64 * 1024);
      remaining -= bytes;
      controller.enqueue(new Uint8Array(bytes).fill(97));
    },
  });
}

interface ProbeSummary {
  uploads: number;
  bytes: number;
  exactLimitPassed: boolean;
  metadataMatches: boolean;
  replayMatches: boolean;
  crossOwnerDenied: boolean;
  cleaned: number;
}

/** Actual local HTTP receiver proof. Failure throws; it never reports partial success. */
export const probeHttp = internalAction({
  args: {},
  returns: v.object({
    uploads: v.number(),
    bytes: v.number(),
    exactLimitPassed: v.boolean(),
    metadataMatches: v.boolean(),
    replayMatches: v.boolean(),
    crossOwnerDenied: v.boolean(),
    cleaned: v.number(),
  }),
  handler: async (ctx): Promise<ProbeSummary> => {
    const site = localSite();
    const runtime = createUploadRuntime();
    const ownerId = `max-local-upload-probe-${runtime.newId()}`;
    const summary: ProbeSummary = {
      uploads: 0,
      bytes: 0,
      exactLimitPassed: false,
      metadataMatches: true,
      replayMatches: true,
      crossOwnerDenied: true,
      cleaned: 0,
    };
    // SHA-256 of repeated ASCII 'a', independently computed in 64 KiB chunks.
    const fixtures = [
      { size: 1024, sha256: "2edc986847e209b4016e141a6dc8716d3207350f416969382d431539bf292e4a" },
      { size: 50 * 1024 * 1024, sha256: "4f0e9c6a1a9a90f35b884d0f0e7343459c21060eefec6c0f2fa9dc1118dbe5be" },
    ];
    for (const fixture of fixtures) {
      const receiptId = runtime.newId();
      const capability = runtime.createCapability();
      await ctx.runMutation(internal.uploadMutations.issue, { ownerId, id: receiptId, capabilityHash: await runtime.hashCapability(capability) });
      const url = `${site}/uploads?capability=${encodeURIComponent(capability)}`;
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: body(fixture.size) });
      if (!response.ok) throw new Error(`Local HTTP upload failed for ${fixture.size} bytes with status ${response.status}. Receipt retained for inspection.`);
      const result: unknown = await response.json();
      if (!result || typeof result !== "object" || !("storageId" in result) || typeof result.storageId !== "string")
        throw new Error("Upload acknowledgement was malformed. No cleanup attempted.");
      const replay = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: "ignored replay body" });
      const replayResult: unknown = replay.ok ? await replay.json() : null;
      if (!replayResult || typeof replayResult !== "object" || !("storageId" in replayResult) || replayResult.storageId !== result.storageId)
        throw new Error("Upload retry did not return the acknowledged storage ID. Receipt retained.");
      // The internal proof helper normalizes the receiver's native storage ID.
      const storageId = result.storageId;
      const check = await ctx.runMutation(internal.uploadChecks.verifyStored, { ownerId, receiptId, storageId, ...fixture });
      summary.metadataMatches &&= check.metadataMatches;
      summary.crossOwnerDenied &&= check.crossOwnerDenied;
      summary.uploads++;
      summary.bytes += fixture.size;
      if (fixture.size === 50 * 1024 * 1024) summary.exactLimitPassed = true;
      if (await ctx.runMutation(internal.uploadChecks.cleanupStored, { ownerId, receiptId, storageId, ...fixture })) summary.cleaned++;
    }
    return summary;
  },
});
