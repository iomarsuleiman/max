import { NextResponse } from "next/server";
import { serializeError } from "@/lib/domain/errors";
import { CLOUD } from "@/lib/config";
import { localModeAllowed, runLocalSites } from "@/lib/server/local";

export const dynamic = "force-dynamic";

/** Local mode's published websites (the twin of convex/sites.ts): read-only, no account. */
export async function POST(request: Request) {
  if (CLOUD || !localModeAllowed()) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not available." } }, { status: 404 });
  let body: Parameters<typeof runLocalSites>[0];
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid request." } }, { status: 400 });
  }
  if (!body || !["nav", "read", "search"].includes(body.fn) || typeof body.slug !== "string") return NextResponse.json({ error: { code: "VALIDATION", message: "Invalid request." } }, { status: 400 });
  try {
    return NextResponse.json({ result: (await runLocalSites(body)) ?? null });
  } catch (err) {
    const error = serializeError(err);
    const status = { FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400 }[error.code as string] ?? 500;
    return NextResponse.json({ error }, { status });
  }
}
