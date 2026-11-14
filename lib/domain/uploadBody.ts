import { MaxError } from "./errors";
import { LIMITS, UPLOAD_TYPES } from "./ops/helpers";

/** Measure received bytes; neither Content-Length nor registration metadata is authority. */
export async function readUploadBody(request: Request, maxBytes = LIMITS.uploadBytes): Promise<Blob> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > LIMITS.uploadBytes) throw new MaxError("INTERNAL", "Upload limit is unavailable.");
  const type = (request.headers.get("content-type") ?? "application/octet-stream").split(";", 1)[0].trim().toLowerCase();
  if (!UPLOAD_TYPES.includes(type)) throw new MaxError("VALIDATION", "This file type is not supported.");
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) throw new MaxError("VALIDATION", "The upload length is invalid.");
    if (Number(length) > maxBytes) throw new MaxError("LIMIT", "The file exceeds the upload size limit.");
  }
  if (!request.body) throw new MaxError("VALIDATION", "The uploaded file is empty.");
  let size = 0;
  const bounded = request.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new MaxError("LIMIT", "The file exceeds the upload size limit.");
        controller.enqueue(chunk);
      },
    }),
  );
  const blob = await new Response(bounded, { headers: { "content-type": type } }).blob();
  if (blob.size === 0) throw new MaxError("VALIDATION", "The uploaded file is empty.");
  return blob;
}
