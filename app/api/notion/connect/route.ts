import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { notionUiOwner, runNotionForOwner } from "@/lib/server/notion";
import { object, text } from "@/lib/notion/types";
import { APP_URL } from "@/lib/config";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const base = process.env.NEXT_PUBLIC_APP_URL ? APP_URL : new URL(request.url).origin;
  const owner = await notionUiOwner();
  if (!owner) return NextResponse.redirect(new URL("/sign-in", base));
  try {
    const state = randomBytes(32).toString("hex");
    const result = object(await runNotionForOwner(owner, "oauth.begin", { state }, "ui"));
    const response = NextResponse.redirect(text(result.url));
    response.cookies.set("max_notion_state", state, {
      httpOnly: true,
      secure: new URL(base).protocol === "https:",
      sameSite: "lax",
      path: "/api/notion/callback",
      maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/connect/notion?state=error&reason=not_configured", base));
  }
}
