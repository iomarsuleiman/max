import { queryGeneric, type GenericDataModel, type GenericQueryCtx } from "convex/server";
import { v } from "convex/values";
import { externalStore } from "./workspaceExternalShares";
import { storeFor } from "./workspaceLinkPolicies";
import {
  acceptedExternalSharePreflight, currentMemberLinkPreflight,
} from "../lib/domain/workspaceShareAccessPreflight";
import { validPrincipalId } from "../lib/domain/workspaceManagementPolicy";

/**
 * PR39: authenticated, boolean-only SHADOW PREFLIGHT, not resource delivery.
 * Nothing here returns page data, URLs, media, a capability token, or a
 * transferable access grant. All flags are default OFF.
 */
type Ctx = Pick<GenericQueryCtx<GenericDataModel>, "db" | "auth">;
const PREFLIGHT_GATE = "MAX_V2_SHARE_ACCESS_PREFLIGHT_READS_ENABLED";

async function actorFromAuth(ctx: Ctx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject && validPrincipalId(identity.subject)
    ? identity.subject : null;
}
function storeForPreflight(ctx: Ctx) {
  // Both adapters load trusted Convex ACLs, never caller-provided roles.
  return { ...externalStore(ctx), ...storeFor(ctx) };
}

export const previewAcceptedExternalShare = queryGeneric({
  args: { shareId: v.id("workspaceExternalShares") },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    if (process.env[PREFLIGHT_GATE] !== "true" ||
        process.env.MAX_V2_EXTERNAL_SHARES_READS_ENABLED !== "true") return false;
    try {
      return await acceptedExternalSharePreflight(
        storeForPreflight(ctx), await actorFromAuth(ctx), a.shareId, Date.now()
      );
    } catch { return false; }
  },
});

export const previewCurrentMemberLink = queryGeneric({
  args: { linkId: v.id("workspaceLinkPolicies") },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    if (process.env[PREFLIGHT_GATE] !== "true" ||
        process.env.MAX_V2_LINK_POLICIES_READS_ENABLED !== "true") return false;
    try {
      return await currentMemberLinkPreflight(
        storeForPreflight(ctx), await actorFromAuth(ctx), a.linkId, Date.now()
      );
    } catch { return false; }
  },
});
