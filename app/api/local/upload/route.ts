import { NextResponse } from "next/server";
import { CLOUD } from "@/lib/config";
import { localModeAllowed, saveLocalFile } from "@/lib/server/local";
import { readUploadBody } from "@/lib/domain/uploadBody";
import { MaxError } from "@/lib/domain/errors";

export const dynamic = "force-dynamic";

/** Mirrors Convex's upload URL contract: POST the body, get back { storageId }. */
export async function POST(request: Request) {
  if (CLOUD || !localModeAllowed()) return new Response("Not found", { status: 404 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Cross-site uploads are not allowed." }, { status: 403 });
  try {
    const body = await readUploadBody(request);
    const storageId = await saveLocalFile(await body.arrayBuffer(), body.type);
    return NextResponse.json({ storageId });
  } catch (error) {
    if (error instanceof MaxError) return NextResponse.json({ error: error.message }, { status: error.code === "LIMIT" ? 413 : 400 });
    throw error;
  }
}
