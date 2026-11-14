import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { createUploadRuntime, hashUploadCapability } from "../lib/domain/uploadRuntime";
import { readUploadBody } from "../lib/domain/uploadBody";
import { serializeError } from "../lib/domain/errors";
import type { UploadAttempt } from "../lib/domain/uploads";
import type { Id } from "./_generated/dataModel";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
};

export const options = httpAction(async () => new Response(null, { status: 204, headers }));

/** A one-use capability authorizes these bytes for its persisted owner only. */
export const receive = httpAction(async (ctx, request) => {
  let received: { attempt: UploadAttempt; storageId: Id<"_storage"> } | undefined;
  try {
    const capability = new URL(request.url).searchParams.get("capability") ?? "";
    if (!/^max-upload-v1\.[a-f0-9]{64}$/.test(capability)) return new Response("Upload not found.", { status: 404, headers });
    const runtime = createUploadRuntime();
    const result = await ctx.runMutation(internal.uploadMutations.begin, {
      capabilityHash: await hashUploadCapability(capability),
      attemptId: runtime.newId(),
    });
    if (result.state !== "receiving") return Response.json({ storageId: result.blob.storageId }, { headers });
    const body = await readUploadBody(request);
    const storageId = await ctx.storage.store(body);
    received = { attempt: result.attempt, storageId };
    // This metadata comes from stored bytes, never a registration request.
    const metadata = await ctx.runQuery(internal.uploadMutations.storedMetadata, { storageId });
    if (!metadata || metadata.size !== body.size || metadata.type !== body.type) throw new Error("Stored file metadata does not match received bytes.");
    await ctx.runMutation(internal.uploadMutations.complete, {
      attempt: result.attempt,
      blob: { storageId, ...metadata },
    });
    return Response.json({ storageId }, { headers });
  } catch (error) {
    // A completion acknowledgement can be lost after commit. Never delete the
    // stored bytes here; receipt-aware cleanup must establish eligibility first.
    if (received) {
      const runtime = createUploadRuntime();
      try {
        await ctx.runMutation(internal.uploadOrphans.adopt, {
          ...received, orphanId: runtime.newId(), cleanupId: runtime.newId(),
          capabilityHash: await runtime.hashCapability(runtime.createCapability()),
        });
      } catch {
        // Total receiver failure still needs storage inventory reconciliation.
        // Never guess that an uncertain registration failed and delete bytes.
      }
    }
    const failure = serializeError(error);
    if (failure.code !== "INTERNAL")
      return new Response(failure.message, {
        status: failure.code === "LIMIT" ? 413 : failure.code === "NOT_FOUND" ? 404 : failure.code === "CONFLICT" ? 409 : 400,
        headers,
      });
    return new Response("The upload could not finish. Retry the same upload URL.", { status: 503, headers });
  }
});
