import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { execute } from "../lib/domain/ops";
import { MaxError, serializeError } from "../lib/domain/errors";
import { convexDb, convexStorage } from "./convexDb";
import { purgeNotionAccount } from "./notionCleanup";
import { convexPersonalDb } from "./personalDb";

/**
 * Every Max operation runs through these four functions. The browser calls `query`/`mutation`
 * with the signed-in Clerk identity; the MCP server calls `serverQuery`/`serverMutation` with a
 * shared server secret and the account it has already authenticated. Both reach the same
 * domain operations, so UI and MCP behaviour can't drift apart.
 */

async function ownerFromAuth(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Your session has ended. Sign in again to continue." });
  return identity.subject;
}

function checkSecret(secret: string) {
  const expected = process.env.MAX_SERVER_SECRET;
  if (!expected || expected.length < 32 || secret !== expected) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Server credentials are not configured." });
  }
}

async function run(
  ctx: { db: never; storage: never; scheduler: GenericMutationCtx<GenericDataModel>["scheduler"] },
  op: string,
  args: unknown,
  ownerId: string,
  source: "ui" | "mcp",
  kind: "query" | "mutation",
) {
  try {
    const db = await convexPersonalDb(ctx.db, convexDb(ctx.db), ownerId);
    if (op === "account.deleteAllData") await db.preflightAccountDeletion();
    const result = await execute(op, args, { db, storage: convexStorage(ctx.storage), ownerId, now: Date.now(), source }, kind);
    if (op === "account.deleteAllData") await purgeNotionAccount(ctx, ownerId);
    return result;
  } catch (err) {
    if (err instanceof ConvexError) throw err;
    const e = serializeError(err);
    if (!(err instanceof MaxError)) console.error(JSON.stringify({ level: "error", op, message: err instanceof Error ? err.message : String(err) }));
    throw new ConvexError(e as never);
  }
}

export const query = queryGeneric({
  args: { op: v.string(), args: v.any() },
  handler: async (ctx, { op, args }) => run(ctx as never, op, args, await ownerFromAuth(ctx), "ui", "query"),
});

export const mutation = mutationGeneric({
  args: { op: v.string(), args: v.any() },
  handler: async (ctx, { op, args }) => run(ctx as never, op, args, await ownerFromAuth(ctx), "ui", "mutation"),
});

export const serverQuery = queryGeneric({
  args: { secret: v.string(), ownerId: v.string(), op: v.string(), args: v.any() },
  handler: async (ctx, { secret, ownerId, op, args }) => {
    checkSecret(secret);
    return run(ctx as never, op, args, ownerId, "mcp", "query");
  },
});

export const serverMutation = mutationGeneric({
  args: { secret: v.string(), ownerId: v.string(), op: v.string(), args: v.any() },
  handler: async (ctx, { secret, ownerId, op, args }) => {
    checkSecret(secret);
    return run(ctx as never, op, args, ownerId, "mcp", "mutation");
  },
});

/** Resolves a personal access token (by hash) to its account and records its use. */
export const resolveToken = mutationGeneric({
  args: { secret: v.string(), hash: v.string() },
  handler: async (ctx, { secret, hash }) => {
    checkSecret(secret);
    const row = await convexDb(ctx.db).findTokenByHash(hash);
    if (!row || row.revokedAt) return null;
    await convexDb(ctx.db).patch("tokens", row._id, { lastUsedAt: Date.now() });
    return row.ownerId;
  },
});

/** Records a failed assistant operation (names and codes only). */
export const logFailure = mutationGeneric({
  args: { secret: v.string(), ownerId: v.string(), op: v.string(), code: v.string(), targetId: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    checkSecret(a.secret);
    await ctx.db.insert("audit", { ownerId: a.ownerId, op: a.op, source: "mcp", targetId: a.targetId, ok: false, code: a.code, at: Date.now() });
  },
});
