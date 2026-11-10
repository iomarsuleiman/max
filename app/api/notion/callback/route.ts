import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { APP_URL } from "@/lib/config";
import { notionUiOwner, runNotionForOwner } from "@/lib/server/notion";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  const base = process.env.NEXT_PUBLIC_APP_URL ? APP_URL : request.nextUrl.origin;
  const finish = (query: string) => {
    const r = NextResponse.redirect(new URL(`/connect/notion?${query}`, base));
    r.cookies.set("max_notion_state", "", { path: "/api/notion/callback", maxAge: 0 });
    r.headers.set("Cache-Control", "no-store");
    r.headers.set("Referrer-Policy", "no-referrer");
    return r;
  };
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const cookie = request.cookies.get("max_notion_state")?.value ?? "";
  if (
    !/^[a-f0-9]{64}$/.test(state) ||
    !/^[a-f0-9]{64}$/.test(cookie) ||
    request.nextUrl.searchParams.getAll("state").length !== 1 ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))
  )
    return finish("state=error&reason=invalid_state");
  if (request.nextUrl.searchParams.get("error")) return finish("state=error&reason=access_denied");
  const code = request.nextUrl.searchParams.get("code");
  const owner = await notionUiOwner();
  if (!owner || !code) return finish("state=error&reason=expired");
  try {
    await runNotionForOwner(owner, "oauth.complete", { state, code }, "ui");
    return finish("state=success");
  } catch {
    return finish("state=error&reason=provider_error");
  }
}
