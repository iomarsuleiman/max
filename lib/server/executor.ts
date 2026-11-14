import "server-only";
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { CLOUD, CONVEX_URL } from "@/lib/config";
import { MaxError, serializeError } from "@/lib/domain/errors";
import { registry } from "@/lib/domain/ops";
import { sha256 } from "@/lib/domain/ops/helpers";
import { localModeAllowed, resolveLocalToken, runLocal } from "./local";

/** Runs an operation for an already-authenticated account from server code (the MCP endpoint). */
export async function runForOwner(ownerId: string, op: string, args: unknown): Promise<unknown> {
  const def = registry.get(op);
  if (!def) throw new MaxError("NOT_FOUND", `Unknown operation "${op}".`);
  if (!CLOUD) {
    if (!localModeAllowed()) throw new MaxError("INTERNAL", "Max isn't configured on this server yet.");
    return runLocal(op, args, "mcp", ownerId);
  }
  const client = new ConvexHttpClient(CONVEX_URL);
  const payload = { secret: serverSecret(), ownerId, op, args: args ?? {} };
  try {
    if (op === "assets.createUploadUrl") {
      if (args && typeof args === "object" && "idempotencyKey" in args && typeof args.idempotencyKey === "string" && args.idempotencyKey.length)
        throw new MaxError("VALIDATION", "Operations that return upload capabilities cannot use idempotencyKey.");
      return await client.action(anyApi.uploadActions.serverStart, { secret: serverSecret(), ownerId });
    }
    return def.kind === "query" ? await client.query(anyApi.ops.serverQuery, payload) : await client.mutation(anyApi.ops.serverMutation, payload);
  } catch (err) {
    const e = serializeError(err);
    if (def.kind === "mutation") {
      const a = (args ?? {}) as Record<string, unknown>;
      const target = (a.id ?? a.pageId ?? a.databaseId ?? null) as string | null;
      await client.mutation(anyApi.ops.logFailure, { secret: serverSecret(), ownerId, op, code: e.code, targetId: typeof target === "string" ? target : null }).catch(() => undefined);
    }
    throw new MaxError(e.code, e.message, e.details);
  }
}

function serverSecret(): string {
  const s = process.env.MAX_SERVER_SECRET;
  if (!s || s.length < 32) throw new MaxError("INTERNAL", "MAX_SERVER_SECRET is not configured (32+ characters, same value in Convex and the web app).");
  return s;
}

/** Resolves a personal access token ("max_…") to its account, or null. */
export async function ownerForToken(token: string): Promise<string | null> {
  if (!token.startsWith("max_") || token.length < 20) return null;
  const hash = await sha256(token);
  if (!CLOUD) return localModeAllowed() ? resolveLocalToken(hash) : null;
  const client = new ConvexHttpClient(CONVEX_URL);
  return (await client.mutation(anyApi.ops.resolveToken, { secret: serverSecret(), hash })) as string | null;
}
