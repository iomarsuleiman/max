import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { adminOverview, isAdminEmail, listReports, setModeration, setReportStatus, submitReport } from "../lib/domain/admin";
import { convexDb } from "./convexDb";
import { guard } from "./sharing";

/**
 * The admin dashboard. Only signed-in people whose email is listed in the MAX_ADMIN_EMAILS
 * environment variable (npx convex env set MAX_ADMIN_EMAILS you@example.com) get past adminOf.
 */

type Identity = { subject: string; email?: string; name?: string };

async function adminOf(ctx: { auth: { getUserIdentity(): Promise<Identity | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity || !isAdminEmail(identity.email)) throw new ConvexError({ code: "FORBIDDEN", message: "This page is for Max's admins." });
  return identity;
}

const writer = (ctx: unknown) => convexDb((ctx as GenericMutationCtx<GenericDataModel>).db);

export const check = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    return { admin: !!identity && isAdminEmail(identity.email) };
  },
});

export const overview = queryGeneric({
  args: { at: v.number() },
  handler: async (ctx, a) => {
    await adminOf(ctx);
    return guard(() => adminOverview(convexDb(ctx.db), a.at));
  },
});

export const reports = queryGeneric({
  args: {},
  handler: async (ctx) => {
    await adminOf(ctx);
    return guard(() => listReports(convexDb(ctx.db)));
  },
});

export const setStatus = mutationGeneric({
  args: { userId: v.string(), status: v.union(v.literal("active"), v.literal("suspended"), v.literal("banned")), reason: v.string() },
  handler: async (ctx, a) => {
    const me = await adminOf(ctx);
    return guard(() => setModeration(writer(ctx), me.subject, a.userId, a.status, a.reason, Date.now()));
  },
});

export const setReport = mutationGeneric({
  args: { id: v.string(), status: v.union(v.literal("open"), v.literal("resolved")) },
  handler: async (ctx, a) => {
    await adminOf(ctx);
    return guard(() => setReportStatus(writer(ctx), a.id, a.status, Date.now()));
  },
});

/** Anyone can report a problem, signed in or not. */
export const report = mutationGeneric({
  args: {
    kind: v.union(v.literal("bug"), v.literal("content"), v.literal("other")),
    message: v.string(),
    url: v.optional(v.union(v.string(), v.null())),
    pageId: v.optional(v.union(v.string(), v.null())),
    siteSlug: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, a) => {
    const identity = (await ctx.auth.getUserIdentity()) as Identity | null;
    const reporter = identity ? { id: identity.subject, name: identity.name ?? null, email: identity.email ?? null } : null;
    return guard(() => submitReport(writer(ctx), reporter, a, Date.now()));
  },
});
