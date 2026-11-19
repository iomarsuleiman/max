import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { v } from "convex/values";
import { commitRoom, joinRoom, leaveRoom, pullRoom, pushRoom, setAwareness } from "../lib/domain/collab";
import { convexDb, convexStorage } from "./convexDb";
import { actorOf, guard } from "./sharing";

/** Live co-editing on shared pages (lib/domain/collab.ts). Access is checked on every call. */

const link = { linkToken: v.optional(v.union(v.string(), v.null())) };
const writer = (ctx: unknown) => convexDb((ctx as GenericMutationCtx<GenericDataModel>).db);

export const join = mutationGeneric({
  args: { pageId: v.string(), clientId: v.string(), ...link },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => joinRoom({ db: writer(ctx), actor, now: Date.now(), linkToken: a.linkToken }, a.pageId, a.clientId));
  },
});

export const pull = queryGeneric({
  args: { roomId: v.string(), afterSeq: v.number(), ...link },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => pullRoom({ db: convexDb(ctx.db), actor, now: Date.now(), linkToken: a.linkToken }, a.roomId, a.afterSeq));
  },
});

export const push = mutationGeneric({
  args: { roomId: v.string(), epoch: v.number(), clientId: v.string(), data: v.string(), seedRevision: v.optional(v.number()), ...link },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => pushRoom({ db: writer(ctx), actor, now: Date.now(), linkToken: a.linkToken }, a));
  },
});

export const awareness = mutationGeneric({
  args: { roomId: v.string(), epoch: v.number(), clientId: v.string(), data: v.string(), ...link },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => setAwareness({ db: writer(ctx), actor, now: Date.now(), linkToken: a.linkToken }, a));
  },
});

export const commit = mutationGeneric({
  args: { roomId: v.string(), epoch: v.number(), clientId: v.string(), blocks: v.array(v.any()), state: v.optional(v.string()), upTo: v.optional(v.number()), ...link },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => commitRoom({ db: writer(ctx), storage: convexStorage(ctx.storage), actor, now: Date.now(), linkToken: a.linkToken }, a));
  },
});

export const leave = mutationGeneric({
  args: { roomId: v.string(), clientId: v.string(), ...link },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => leaveRoom({ db: writer(ctx), actor, now: Date.now(), linkToken: a.linkToken }, a.roomId, a.clientId));
  },
});
