import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { APP_URL, CLOUD } from "@/lib/config";
import { createMcpServer } from "@/lib/server/mcp";
import { ownerForToken } from "@/lib/server/executor";
import { localModeAllowed } from "@/lib/server/local";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RESOURCE_METADATA = `${APP_URL}/.well-known/oauth-protected-resource/mcp`;

function unauthorized(message: string) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message }, id: null }), {
    status: 401,
    headers: { "Content-Type": "application/json", "WWW-Authenticate": `Bearer resource_metadata="${RESOURCE_METADATA}"` },
  });
}

/** Simple per-account rate limit (per server instance): 240 requests per minute. */
const windows = new Map<string, { start: number; count: number }>();
function rateLimited(ownerId: string) {
  const now = Date.now();
  const w = windows.get(ownerId);
  if (!w || now - w.start > 60_000) {
    windows.set(ownerId, { start: now, count: 1 });
    return false;
  }
  w.count++;
  return w.count > 240;
}

async function authenticate(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token) return null;
  if (token.startsWith("max_")) return ownerForToken(token);
  if (!CLOUD) return null;
  // OAuth access tokens issued by Clerk to MCP clients such as ChatGPT and Claude.
  const { auth } = await import("@clerk/nextjs/server");
  const result = await auth({ acceptsToken: "oauth_token" });
  return result.isAuthenticated ? (result.userId ?? null) : null;
}

async function handle(request: Request) {
  if (!CLOUD && !localModeAllowed()) return new Response("Not found", { status: 404 });
  let ownerId: string | null = null;
  try {
    ownerId = await authenticate(request);
  } catch {
    ownerId = null;
  }
  if (!ownerId) return unauthorized("Connect Max with an access token (Settings → Connections) or sign in with OAuth.");
  if (rateLimited(ownerId)) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Wait a minute and try again." }, id: null }), { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "60" } });
  }
  const server = createMcpServer(ownerId);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
