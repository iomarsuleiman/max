import { APP_URL, CLERK_KEY, CLOUD } from "@/lib/config";

/** OAuth 2.0 protected resource metadata (RFC 9728) so MCP clients can discover Clerk as the authorization server. */
function clerkIssuer(): string | null {
  try {
    const encoded = CLERK_KEY.split("_")[2];
    const host = atob(encoded).replace(/\$$/, "");
    return host ? `https://${host}` : null;
  } catch {
    return null;
  }
}

export function GET() {
  const issuer = CLOUD ? clerkIssuer() : null;
  return Response.json(
    {
      resource: `${APP_URL}/mcp`,
      authorization_servers: issuer ? [issuer] : [],
      bearer_methods_supported: ["header"],
      resource_name: "Max",
      resource_documentation: `${APP_URL}/connect`,
    },
    { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=3600" } },
  );
}
