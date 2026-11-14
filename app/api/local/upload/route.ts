import { NextResponse } from "next/server";
import { CLOUD } from "@/lib/config";
import { localModeAllowed, beginLocalUpload, completeLocalUpload } from "@/lib/server/local";
import { readUploadBody } from "@/lib/domain/uploadBody";
import { MaxError } from "@/lib/domain/errors";

export const dynamic = "force-dynamic";

/** Mirrors Convex's upload URL contract: POST the body, get back { storageId }. */
export async function POST(request: Request) {
  if (CLOUD || !localModeAllowed()) return new Response("Not found", { status: 404 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: "Cross-site uploads are not allowed." }, { status: 403 });
  try {
    const begun = await beginLocalUpload(new URL(request.url).searchParams.get("capability") ?? "");
    if (begun.state !== "receiving") return NextResponse.json({ storageId: begun.blob.storageId }, { headers: { "Cache-Control": "no-store" } });
    const body = await readUploadBody(request);
    const storageId = await completeLocalUpload(begun.attempt, body);
    return NextResponse.json({ storageId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MaxError)
      return NextResponse.json(
        { error: error.message },
        {
          status: error.code === "LIMIT" ? 413 : error.code === "NOT_FOUND" ? 404 : error.code === "CONFLICT" ? 409 : 400,
          headers: { "Cache-Control": "no-store" },
        },
      );
    throw error;
  }
}
