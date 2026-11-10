import { NextResponse } from "next/server";
import { z } from "zod";
import { notionUiOwner, runNotionForOwner } from "@/lib/server/notion";
import { serializeError } from "@/lib/domain/errors";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const schema = z.object({
  operation: z.enum(["status", "sources", "preview", "start", "job", "report", "history", "cancel", "retry", "disconnect"]),
  args: z.record(z.string(), z.unknown()).default({}),
});
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Open Max to manage your Notion connection." } }, { status: 403, headers });
  const owner = await notionUiOwner();
  if (!owner) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Sign in to continue." } }, { status: 401, headers });
  try {
    const { operation, args } = schema.parse(await request.json());
    const result = await runNotionForOwner(owner, operation, args, "ui");
    return NextResponse.json({ result }, { headers });
  } catch (error) {
    return NextResponse.json({ error: serializeError(error) }, { status: 400, headers });
  }
}
