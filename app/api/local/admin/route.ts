import { NextResponse } from "next/server";
import { serializeError } from "@/lib/domain/errors";
import { CLOUD } from "@/lib/config";
import { localActor, localModeAllowed, runLocalAdmin } from "@/lib/server/local";

export const dynamic = "force-dynamic";

/** Local mode's admin dashboard and report form (the twin of convex/admin.ts). */
export async function POST(request: Request) {
  if (CLOUD || !localModeAllowed()) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not available." } }, { status: 404 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Cross-site requests are not allowed." } }, { status: 403 });
  let body: Parameters<typeof runLocalAdmin>[0];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid request." } }, { status: 400 });
  }
  if (!body || !["check", "overview", "reports", "setStatus", "setReport", "report"].includes(body.fn)) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid request." } }, { status: 400 });
  try {
    return NextResponse.json({ result: (await runLocalAdmin(body, localActor(request))) ?? null });
  } catch (err) {
    const error = serializeError(err);
    const status = { FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, LIMIT: 429 }[error.code as string] ?? 500;
    return NextResponse.json({ error }, { status });
  }
}
