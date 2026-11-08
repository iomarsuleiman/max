import { NextResponse } from "next/server";
import { serializeError } from "@/lib/domain/errors";
import { CLOUD } from "@/lib/config";
import { localModeAllowed, runLocal } from "@/lib/server/local";

export const dynamic = "force-dynamic";

/** The browser's entry point in local mode. Cloud mode talks to Convex directly instead. */
export async function POST(request: Request) {
  if (CLOUD || !localModeAllowed()) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not available." } }, { status: 404 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Cross-site requests are not allowed." } }, { status: 403 });
  let body: { op?: string; args?: unknown; kind?: "query" | "mutation" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid request." } }, { status: 400 });
  }
  try {
    const result = await runLocal(String(body.op), body.args ?? {}, "ui", undefined, body.kind);
    return NextResponse.json({ result: result ?? null });
  } catch (err) {
    const error = serializeError(err);
    if (error.code === "INTERNAL") console.error(JSON.stringify({ level: "error", op: body.op, message: err instanceof Error ? err.message : String(err) }));
    const status = { NOT_FOUND: 404, VALIDATION: 400, CONFLICT: 409, LIMIT: 413, CONFIRMATION_REQUIRED: 428, READ_ONLY: 423, UNAUTHENTICATED: 401, INTERNAL: 500 }[error.code] ?? 500;
    return NextResponse.json({ error }, { status });
  }
}
