import { NextResponse } from "next/server";
import { serializeError } from "@/lib/domain/errors";
import { exchangeAppCode } from "@/lib/server/executor";

export const dynamic = "force-dynamic";

/**
 * OAuth 2.0 authorization-code exchange for apps. After someone approves an app at
 * /apps/<client_id>?redirect_uri=…&state=…, Max redirects back with ?code=…; the app's server
 * POSTs { grant_type: "authorization_code", client_id, client_secret, code, redirect_uri } here
 * (JSON or form-encoded) and gets { access_token, token_type: "bearer", workspace, scopes }.
 */
export async function POST(request: Request) {
  let body: Record<string, string> = {};
  try {
    const type = request.headers.get("content-type") ?? "";
    body = type.includes("application/json") ? await request.json() : Object.fromEntries(new URLSearchParams(await request.text()));
  } catch {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  if ((body.grant_type ?? "authorization_code") !== "authorization_code" || !body.client_id || !body.client_secret || !body.code) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const result = await exchangeAppCode({ clientId: body.client_id, clientSecret: body.client_secret, code: body.code, redirectUri: body.redirect_uri ?? null });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    const e = serializeError(err);
    return NextResponse.json({ error: e.code === "UNAUTHENTICATED" ? "invalid_grant" : "server_error", error_description: e.message }, { status: e.code === "UNAUTHENTICATED" ? 400 : 500 });
  }
}
