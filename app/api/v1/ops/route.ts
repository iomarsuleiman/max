import { NextResponse } from "next/server";
import { serializeError } from "@/lib/domain/errors";
import { listOps } from "@/lib/domain/ops";
import { scopeFor, SCOPES } from "@/lib/domain/integrations";
import { runForApp } from "@/lib/server/executor";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Max's REST API for connected apps. Authenticate with the app's token:
 *   POST /api/v1/ops  { "op": "pages.create", "args": { "title": "Hello" } }
 *   Authorization: Bearer maxi_…
 * GET lists every operation with the permission it needs. Same operations as the UI and MCP.
 */

const STATUS: Record<string, number> = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, CONFLICT: 409, LIMIT: 429, CONFIRMATION_REQUIRED: 400, READ_ONLY: 409 };

/** Per-token rate limit (per server instance): 300 requests a minute. */
const windows = new Map<string, { start: number; count: number }>();
function limited(key: string) {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start > 60_000) {
    windows.set(key, { start: now, count: 1 });
    return false;
  }
  return ++w.count > 300;
}

const bearer = (request: Request) => /^Bearer\s+(maxi_[a-f0-9]{48})$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;

export async function GET() {
  return NextResponse.json({
    scopes: SCOPES,
    operations: listOps()
      .map((op) => ({ name: op.name, kind: op.kind, title: op.title, description: op.description, scope: scopeFor(op.name, op.kind) }))
      .filter((o) => o.scope),
  });
}

export async function POST(request: Request) {
  const token = bearer(request);
  if (!token) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Send your app token as Authorization: Bearer maxi_…" } }, { status: 401 });
  if (limited(token.slice(0, 18))) return NextResponse.json({ error: { code: "LIMIT", message: "Too many requests. Slow down to 300 a minute." } }, { status: 429, headers: { "Retry-After": "30" } });
  let body: { op?: unknown; args?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION", message: "Send JSON: { op, args }." } }, { status: 400 });
  }
  if (typeof body.op !== "string" || body.op.length > 64) return NextResponse.json({ error: { code: "VALIDATION", message: "Missing op." } }, { status: 400 });
  try {
    return NextResponse.json({ result: (await runForApp(token, body.op, body.args ?? {})) ?? null });
  } catch (err) {
    const error = serializeError(err);
    return NextResponse.json({ error }, { status: STATUS[error.code] ?? 500 });
  }
}
