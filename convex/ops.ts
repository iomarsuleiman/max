import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { execute } from "../lib/domain/ops";
import { MaxError, serializeError } from "../lib/domain/errors";
import { convexDb, convexStorage } from "./convexDb";
import { makeFunctionReference } from "convex/server";

const deleteR2Object = makeFunctionReference<"action", { key: string }>("r2:deleteObject");
const deliverWebhooks = makeFunctionReference<"action">("integrations:deliver");
import { accountOf, resolveScope, type RequestScope } from "../lib/domain/workspaces";
import { purgeNotionAccount } from "./notionCleanup";

/**
 * Every Max operation runs through these four functions. The browser calls `query`/`mutation`
 * with the signed-in Clerk identity; the MCP server calls `serverQuery`/`serverMutation` with a
 * shared server secret and the account it has already authenticated. Both reach the same
 * domain operations, so UI and MCP behaviour can't drift apart.
 */

type Identity = { subject: string; name?: string; givenName?: string; email?: string; pictureUrl?: string };
type Auth = { auth: { getUserIdentity(): Promise<Identity | null> } };

async function identityOf(ctx: Auth) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Your session has ended. Sign in again to continue." });
  return identity;
}

function constantTimeEqual(a: string, b: string): boolean {
  const max = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < max; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function checkSecret(secret: string) {
  const expected = process.env.MAX_SERVER_SECRET;
  if (!expected || expected.length < 32 || !constantTimeEqual(secret, expected)) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Server credentials are not configured." });
  }
}

async function run(
  ctx: { db: never; storage: never; scheduler: GenericMutationCtx<GenericDataModel>["scheduler"] },
  op: string,
  args: unknown,
  scope: RequestScope & { actor?: { id: string; name: string; image: string | null } },
  source: "ui" | "mcp",
  kind: "query" | "mutation",
) {
  const ownerId = scope.ownerId;
  try {
    // R2 files are deleted by a background action (mutations can't make network calls).
    const schedule = kind === "mutation" && ctx.scheduler ? (key: string) => ctx.scheduler.runAfter(0, deleteR2Object, { key }) : undefined;
    const outbox = { queued: 0 };
    const result = await execute(
      op,
      args,
      { db: convexDb(ctx.db), storage: convexStorage(ctx.storage, schedule), ownerId, now: Date.now(), source, ...(kind === "mutation" ? { outbox } : {}), ...(scope.org ? { org: { role: scope.org.role }, actor: scope.actor } : {}) },
      kind,
    );
    // Connected apps hear about the change (webhooks go out from an action, after this commits).
    if (outbox.queued && ctx.scheduler) await ctx.scheduler.runAfter(0, deliverWebhooks, {});
    if (op === "account.deleteAllData") await purgeNotionAccount(ctx, ownerId);
    return result;
  } catch (err) {
    if (err instanceof ConvexError) throw err;
    const e = serializeError(err);
    if (!(err instanceof MaxError)) console.error(JSON.stringify({ level: "error", op, message: err instanceof Error ? err.message : String(err) }));
    throw new ConvexError(e as never);
  }
}

/** The signed-in account, in the workspace or organization the browser has open (`ws`; the main one when absent). */
async function ownerOf(ctx: Auth & { db: unknown }, ws: string | undefined) {
  const identity = await identityOf(ctx);
  try {
    const scope = await resolveScope(convexDb(ctx.db as never), identity.subject, ws);
    const name = (identity.name || identity.givenName || identity.email?.split("@")[0] || "Someone").slice(0, 120);
    return { ...scope, actor: { id: identity.subject, name, image: identity.pictureUrl ?? null } };
  } catch (err) {
    throw new ConvexError(serializeError(err) as never);
  }
}

export const query = queryGeneric({
  args: { op: v.string(), args: v.any(), ws: v.optional(v.string()) },
  handler: async (ctx, { op, args, ws }) => run(ctx as never, op, args, await ownerOf(ctx, ws), "ui", "query"),
});

export const mutation = mutationGeneric({
  args: { op: v.string(), args: v.any(), ws: v.optional(v.string()) },
  handler: async (ctx, { op, args, ws }) => run(ctx as never, op, args, await ownerOf(ctx, ws), "ui", "mutation"),
});

/** An assistant's account, in the workspace or organization it asked for (`ws`; the main one when absent). */
async function serverOwner(ctx: { db: unknown }, ownerId: string, ws: string | undefined) {
  try {
    const account = accountOf(ownerId);
    const scope = await resolveScope(convexDb(ctx.db as never), account, ws);
    return { ...scope, actor: { id: account, name: scope.org?.name ?? "Assistant", image: null } };
  } catch (err) {
    throw new ConvexError(serializeError(err) as never);
  }
}

export const serverQuery = queryGeneric({
  args: { secret: v.string(), ownerId: v.string(), op: v.string(), args: v.any(), ws: v.optional(v.string()) },
  handler: async (ctx, { secret, ownerId, op, args, ws }) => {
    checkSecret(secret);
    return run(ctx as never, op, args, await serverOwner(ctx, ownerId, ws), "mcp", "query");
  },
});

export const serverMutation = mutationGeneric({
  args: { secret: v.string(), ownerId: v.string(), op: v.string(), args: v.any(), ws: v.optional(v.string()) },
  handler: async (ctx, { secret, ownerId, op, args, ws }) => {
    checkSecret(secret);
    return run(ctx as never, op, args, await serverOwner(ctx, ownerId, ws), "mcp", "mutation");
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
    // Tokens belong to the account; the assistant picks a workspace per call.
    return accountOf(row.ownerId);
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
