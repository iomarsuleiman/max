import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { CLOUD, CONVEX_URL } from "../config";
import { MaxError } from "../domain/errors";

export async function runNotionForOwner(ownerId: string, operation: string, args: unknown, source: "ui" | "mcp" = "mcp"): Promise<unknown> {
  if (!CLOUD) {
    if (operation === "status")
      return {
        configured: false,
        connected: false,
        workspace: null,
        reason: "Direct Notion import requires Max's cloud backend. You can still import a Notion export file.",
      };
    throw new MaxError("VALIDATION", "Direct Notion import requires Max's cloud backend. Import a Notion export file instead.");
  }
  const secret = process.env.MAX_SERVER_SECRET;
  if (!secret || secret.length < 32) throw new MaxError("INTERNAL", "The server connection is not configured. Contact the server owner.");
  const client = new ConvexHttpClient(CONVEX_URL);
  try {
    return await client.action(anyApi.notion.dispatch, { secret, ownerId, operation, args: args ?? {}, source });
  } catch {
    throw new MaxError(
      "VALIDATION",
      "Notion could not complete this action. Check the connection and selected pages, then try again. Your existing Max pages are unchanged.",
    );
  }
}
export async function notionUiOwner(): Promise<string | null> {
  if (!CLOUD) {
    const { localModeAllowed, LOCAL_OWNER } = await import("./local");
    return localModeAllowed() ? LOCAL_OWNER : null;
  }
  const { auth } = await import("@clerk/nextjs/server");
  return (await auth()).userId;
}
