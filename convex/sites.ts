import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { siteNav, siteRead, siteSearch } from "../lib/domain/sites";
import { convexDb, convexStorage } from "./convexDb";
import { guard } from "./sharing";

/** Published websites: read by anyone with the address, no sign-in (lib/domain/sites.ts). */

export const nav = queryGeneric({
  args: { slug: v.string() },
  handler: async (ctx, a) => guard(() => siteNav(convexDb(ctx.db), a.slug)),
});

export const read = queryGeneric({
  args: { slug: v.string(), op: v.string(), args: v.any() },
  handler: async (ctx, a) => guard(() => siteRead(convexDb(ctx.db), convexStorage(ctx.storage), a.slug, a.op, a.args, Date.now())),
});

export const search = queryGeneric({
  args: { slug: v.string(), q: v.string() },
  handler: async (ctx, a) => guard(() => siteSearch(convexDb(ctx.db), a.slug, a.q)),
});
