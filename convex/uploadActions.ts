import { ConvexError, v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { createUploadRuntime } from "../lib/domain/uploadRuntime";

async function issue(ctx: ActionCtx, ownerId: string): Promise<{ uploadUrl: string; expiresAt: number }> {
  const runtime = createUploadRuntime();
  const capability = runtime.createCapability();
  const { expiresAt } = await ctx.runMutation(internal.uploadMutations.issue, {
    ownerId,
    id: runtime.newId(),
    capabilityHash: await runtime.hashCapability(capability),
  });
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new ConvexError({ code: "INTERNAL", message: "File uploads are not configured." });
  const url = new URL("/uploads", site);
  url.searchParams.set("capability", capability);
  return { uploadUrl: url.href, expiresAt };
}

export const start = action({
  args: {},
  returns: v.object({ uploadUrl: v.string(), expiresAt: v.number() }),
  handler: async (ctx): Promise<{ uploadUrl: string; expiresAt: number }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to upload files." });
    return issue(ctx, identity.subject);
  },
});

export const serverStart = action({
  args: { secret: v.string(), ownerId: v.string() },
  returns: v.object({ uploadUrl: v.string(), expiresAt: v.number() }),
  handler: async (ctx, { secret, ownerId }): Promise<{ uploadUrl: string; expiresAt: number }> => {
    const expected = process.env.MAX_SERVER_SECRET;
    if (!expected || expected.length < 32 || secret !== expected)
      throw new ConvexError({ code: "UNAUTHENTICATED", message: "Server credentials are not configured." });
    return issue(ctx, ownerId);
  },
});
