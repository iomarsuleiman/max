import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { listAuthorizedWorkspaceSummaries } from "../lib/domain/workspaceNavigation";

/** Max 2.0 PR09: membership summaries only, never page lists or documents.
 * Private deployment flag is independent of the opt-in frontend shell flag.
 * No caller-supplied account/role/workspace filters are accepted. */
export const list = queryGeneric({
  args: {},
  returns: v.array(v.object({
    workspaceId: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest")),
  })),
  handler: async (ctx) => {
    if (process.env.MAX_V2_NAVIGATION_PREVIEW_ENABLED !== "true") return [];
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return [];
    return listAuthorizedWorkspaceSummaries({
      membershipsForAccount: (accountId) =>
        ctx.db.query("workspaceMemberships").withIndex("by_account", (q) => q.eq("accountId", accountId)).take(51),
      workspaces: (workspaceId) =>
        ctx.db.query("workspaces").withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId)).take(2),
      ownerMemberships: (workspaceId, accountId) =>
        ctx.db.query("workspaceMemberships").withIndex("by_workspace_account", (q) =>
          (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never })
            .eq("accountId", accountId)).take(2),
    }, identity.subject);
  },
});
