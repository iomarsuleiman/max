import { NextResponse } from "next/server";
import { CLOUD } from "@/lib/config";
import { localModeAllowed, saveLocalFile } from "@/lib/server/local";
import { LIMITS } from "@/lib/domain/ops/helpers";

export const dynamic = "force-dynamic";

/** Mirrors Convex's upload URL contract: POST the body, get back { storageId }. */
export async function POST(request: Request) {
  if (CLOUD || !localModeAllowed()) return new Response("Not found", { status: 404 });
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LIMITS.uploadBytes) return NextResponse.json({ error: "File is larger than 20 MB." }, { status: 413 });
  const body = await request.arrayBuffer();
  if (body.byteLength > LIMITS.uploadBytes) return NextResponse.json({ error: "File is larger than 20 MB." }, { status: 413 });
  const storageId = await saveLocalFile(body, request.headers.get("content-type") ?? "application/octet-stream");
  return NextResponse.json({ storageId });
}
