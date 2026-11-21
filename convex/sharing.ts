import { mutationGeneric, queryGeneric, type GenericMutationCtx, type GenericDataModel } from "convex/server";
import { ConvexError, v } from "convex/values";
import { MaxError, serializeError } from "../lib/domain/errors";
import { ANONYMOUS, accessInfo, duplicateShared, executeShared, heartbeat, joinByLink, leaveShare, present, sharedWithMe, type Actor } from "../lib/domain/sharing";
import { convexDb, convexStorage } from "./convexDb";
import { resolveOwner } from "../lib/domain/workspaces";

/**
 * Sharing entry points. The caller is always the signed-in Clerk identity; what they may do on
 * someone else's page is decided by lib/domain/sharing.ts from the share and link tables.
 */

type Identity = { subject: string; name?: string; givenName?: string; email?: string; pictureUrl?: string };

export async function actorOf(ctx: { auth: { getUserIdentity(): Promise<Identity | null> } }): Promise<Actor> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to open shared pages." });
  const name = identity.name || identity.givenName || identity.email?.split("@")[0] || "Someone";
  return { id: identity.subject, name: name.slice(0, 120), image: identity.pictureUrl ?? null };
}

export async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConvexError) throw err;
    const e = serializeError(err);
    if (!(err instanceof MaxError)) console.error(JSON.stringify({ level: "error", where: "sharing", message: err instanceof Error ? err.message : String(err) }));
    throw new ConvexError(e as never);
  }
}

const scoped = { scopePageId: v.string(), op: v.string(), args: v.any(), linkToken: v.optional(v.union(v.string(), v.null())) };

export const query = queryGeneric({
  args: scoped,
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => executeShared(a.op, a.args, { db: convexDb(ctx.db), storage: convexStorage(ctx.storage), actor, now: Date.now(), scopePageId: a.scopePageId, linkToken: a.linkToken }, "query"));
  },
});

export const mutation = mutationGeneric({
  args: scoped,
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() =>
      executeShared(a.op, a.args, { db: convexDb((ctx as GenericMutationCtx<GenericDataModel>).db), storage: convexStorage(ctx.storage), actor, now: Date.now(), scopePageId: a.scopePageId, linkToken: a.linkToken }, "mutation"),
    );
  },
});

export const access = queryGeneric({
  args: { pageId: v.string(), linkToken: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => accessInfo(convexDb(ctx.db), actor.id, a.pageId, a.linkToken));
  },
});

export const withMe = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const actor = await actorOf(ctx);
    return guard(() => sharedWithMe(convexDb(ctx.db), actor.id));
  },
});

export const ping = mutationGeneric({
  args: { pageId: v.string(), linkToken: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => heartbeat(convexDb(ctx.db), actor, a.pageId, Date.now(), a.linkToken));
  },
});

export const here = queryGeneric({
  args: { pageId: v.string(), linkToken: v.optional(v.union(v.string(), v.null())), at: v.number() },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    // `at` (rounded by the client) keeps the list fresh as people leave without a write.
    return guard(() => present(convexDb(ctx.db), actor.id, a.pageId, a.at, a.linkToken));
  },
});

/** Pages published to the web: no sign-in, view-only, published links only (see resolveAccess). */
export const publicQuery = queryGeneric({
  args: { token: v.string(), scopePageId: v.string(), op: v.string(), args: v.any() },
  handler: async (ctx, a) =>
    guard(() =>
      executeShared(a.op, a.args, { db: convexDb(ctx.db), storage: convexStorage(ctx.storage), actor: { id: ANONYMOUS, name: "Visitor", image: null }, now: Date.now(), scopePageId: a.scopePageId, linkToken: a.token }, "query"),
    ),
});

/** Copies a page shared with you (or published) into your own workspace. */
export const duplicate = mutationGeneric({
  args: { pageId: v.string(), linkToken: v.optional(v.union(v.string(), v.null())), ws: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    const db = convexDb((ctx as GenericMutationCtx<GenericDataModel>).db);
    // Into the personal workspace the person has open (their main one while in an organization).
    return guard(async () => duplicateShared(db, actor, a.pageId, Date.now(), a.linkToken, await resolveOwner(db, actor.id, a.ws?.startsWith("org_") ? undefined : a.ws)));
  },
});

/** Accepts a link as an invitation: the page (or teamspace) joins the caller's sidebar. */
export const join = mutationGeneric({
  args: { pageId: v.string(), linkToken: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => joinByLink(convexDb((ctx as GenericMutationCtx<GenericDataModel>).db), actor, a.pageId, Date.now(), a.linkToken));
  },
});

/** Leaves a page or teamspace shared with the caller. */
export const leave = mutationGeneric({
  args: { pageId: v.string() },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => leaveShare(convexDb((ctx as GenericMutationCtx<GenericDataModel>).db), actor, a.pageId));
  },
});
