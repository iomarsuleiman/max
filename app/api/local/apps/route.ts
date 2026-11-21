import { NextResponse } from "next/server";
import { serializeError } from "@/lib/domain/errors";
import { CLOUD } from "@/lib/config";
import { LOCAL_APP_FNS, localActor, localModeAllowed, runLocalApps } from "@/lib/server/local";

export const dynamic = "force-dynamic";

/** Local mode's connectors and marketplace (the twin of convex/integrations.ts). */
export async function POST(request: Request) {
  if (CLOUD || !localModeAllowed()) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not available." } }, { status: 404 });
  if (request.headers.get("sec-fetch-site") === "cross-site") return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Cross-site requests are not allowed." } }, { status: 403 });
  let body: { fn: string; [key: string]: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid request." } }, { status: 400 });
  }
  if (!body || typeof body.fn !== "string" || !LOCAL_APP_FNS.includes(body.fn)) return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid request." } }, { status: 400 });
  try {
    return NextResponse.json({ result: (await runLocalApps(body, localActor(request))) ?? null });
  } catch (err) {
    const error = serializeError(err);
    const status = { FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, LIMIT: 429, CONFLICT: 409 }[error.code as string] ?? 500;
    return NextResponse.json({ error }, { status });
  }
}
