import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { profileByUsername } from "../lib/domain/usernames";
import { linkPreview } from "../lib/domain/sharing";
import { siteHandle as handleForSite } from "../lib/domain/usernames";
import { convexDb } from "./convexDb";

/**
 * Public, read-only lookups for invite pages and link previews. They return only what the page
 * shows anyone: a person's name, member number and card artwork; a shared page's title and icon.
 */
export const profile = queryGeneric({
  args: { username: v.string() },
  handler: async (ctx, { username }) => profileByUsername(convexDb(ctx.db as never), username.slice(0, 40)),
});

export const preview = queryGeneric({
  args: { token: v.string(), pageId: v.string() },
  handler: async (ctx, { token, pageId }) => linkPreview(convexDb(ctx.db as never), token.slice(0, 80), pageId.slice(0, 80)),
});

/** The username a published site lives under (max.chaos.fail/<username>/<site>), or null. */
export const siteHandle = queryGeneric({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => handleForSite(convexDb(ctx.db as never), slug.slice(0, 60)),
});
