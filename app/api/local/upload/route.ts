import { NextResponse } from "next/server";
import { CLOUD } from "@/lib/config";
import { localModeAllowed, saveLocalFile } from "@/lib/server/local";
import { LIMITS, UPLOAD_TYPES } from "@/lib/domain/ops/helpers";

export const dynamic = "force-dynamic";

/** Mirrors Convex's upload URL contract: POST the body, get back { storageId }. */
export async function POST(request: Request) {
  if (CLOUD || !localModeAllowed()) return new Response("Not found", { status: 404 });
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ error: "Cross-site requests are blocked." }, { status: 403 });
  }
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!type || !UPLOAD_TYPES.includes(type)) {
    return NextResponse.json({ error: "Unsupported file type." }, { status: 415 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LIMITS.uploadBytes) return NextResponse.json({ error: "File is larger than 50 MB." }, { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > LIMITS.uploadBytes) return NextResponse.json({ error: "File is larger than 50 MB." }, { status: 413 });
  const storageId = await saveLocalFile(body, type);
  return NextResponse.json({ storageId });
}
