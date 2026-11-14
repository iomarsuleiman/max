import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { canAccessWorkspacePageFromServer } from "../lib/domain/workspaceAccessGateway";

/**
 * PR15 — read-only authentication + permission probe for isolated experiments.
 * Off by default. This is NOT a session issuer or a provider token. Never use a
 * previous positive result in place of rechecking authorization on a write.
 *
 * No provider, document reader/writer, room, session, storage or migration exists.
 */
export const preflight = queryGeneric({
  args: {
    workspaceId: v.string(),
    pageId: v.string(),
    candidate: v.union(v.literal("blocknote-yjs"), v.literal("convex-prosemirror-sync")),
    operation: v.union(
      v.literal("join"), v.literal("read-snapshot"), v.literal("subscribe"),
      v.literal("submit-steps"), v.literal("reconnect"),
    ),
  },
  returns: v.object({
    policyEligible: v.boolean(),
    canReadSharedContent: v.literal(false),
    canSubmitSteps: v.literal(false),
    canActivateProvider: v.literal(false),
  }),
  handler: async (ctx, { workspaceId, pageId, operation }) => {
    const denied = {
      policyEligible: false, canReadSharedContent: false as const,
      canSubmitSteps: false as const, canActivateProvider: false as const,
    };
    if (process.env.MAX_V2_COLLAB_LAB_ENABLED !== "true") return denied;
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return denied;
    try {
      const capability = operation === "submit-steps" || operation === "reconnect"
        ? "edit_content" : "view";
      const policyEligible = await canAccessWorkspacePageFromServer({
        workspaces: (id) =>
          ctx.db.query("workspaces").withIndex("by_workspaceId", (q) => q.eq("workspaceId", id)).collect(),
        memberships: (id, account) =>
          ctx.db.query("workspaceMemberships").withIndex("by_workspace_account", (q) =>
            (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(2),
        groups: async (id, account) =>
          (await ctx.db.query("workspaceGroupMemberships").withIndex("by_workspace_account", (q) =>
            (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(101))
            .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.groupId, status: row.status })),
        teamspaces: async (id, account) =>
          (await ctx.db.query("workspaceTeamspaceMemberships").withIndex("by_workspace_account", (q) =>
            (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(101))
            .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.teamspaceId, status: row.status })),
        groupRegistrations: (id, groupId) =>
          ctx.db.query("workspaceGroups").withIndex("by_workspace_group", (q) =>
            (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("groupId", groupId)).take(2),
        teamspaceRegistrations: (id, teamspaceId) =>
          ctx.db.query("workspaceTeamspaces").withIndex("by_workspace_teamspace", (q) =>
            (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("teamspaceId", teamspaceId)).take(2),
        scopes: (id, page) =>
          ctx.db.query("workspacePageScopes").withIndex("by_workspace_page", (q) =>
            (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", page)).take(2),
        grants: async (id, page) =>
          (await ctx.db.query("workspacePageGrants").withIndex("by_workspace_page", (q) =>
            (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", page)).take(101))
            .map((row) => ({
              workspaceId: row.workspaceId, pageId: row.pageId,
              subjectType: row.subjectType, subjectId: row.subjectId,
              effect: row.effect, level: row.level,
            })),
      }, identity.subject, workspaceId, pageId, capability);
      return { ...denied, policyEligible };
    } catch {
      return denied;
    }
  },
});
