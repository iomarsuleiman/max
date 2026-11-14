import { queryGeneric } from "convex/server";
import { v } from "convex/values";
import { canAccessWorkspacePageFromServer } from "../lib/domain/workspaceAccessGateway";

/**
 * Read-only, fail-closed authorization probe. No workspace contents are served,
 * no membership may be written, and no requested role/grants are accepted.
 * Future shared-content queries MUST perform this check in their own trusted
 * handler; clients cannot use a true result as an authorization token.
 */
export const canAccessPage = queryGeneric({
  args: {
    workspaceId: v.string(),
    pageId: v.string(),
    capability: v.union(
      v.literal("view"),
      v.literal("comment"),
      v.literal("edit_content"),
      v.literal("edit"),
      v.literal("manage"),
    ),
  },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId, pageId, capability }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject) return false;
    return canAccessWorkspacePageFromServer({
      workspaces: (id) =>
        ctx.db.query("workspaces").withIndex("by_workspaceId", (q) => q.eq("workspaceId", id)).collect(),
      memberships: (id, account) =>
        ctx.db.query("workspaceMemberships").withIndex("by_workspace_account", (q) => (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(2),
      groups: async (id, account) =>
        (await ctx.db.query("workspaceGroupMemberships").withIndex("by_workspace_account", (q) => (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(101))
          .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.groupId, status: row.status })),
      teamspaces: async (id, account) =>
        (await ctx.db.query("workspaceTeamspaceMemberships").withIndex("by_workspace_account", (q) => (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(101))
          .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.teamspaceId, status: row.status })),
      groupRegistrations: (id, groupId) =>
        ctx.db.query("workspaceGroups").withIndex("by_workspace_group", (q) =>
          (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("groupId", groupId)).take(2),
      teamspaceRegistrations: (id, teamspaceId) =>
        ctx.db.query("workspaceTeamspaces").withIndex("by_workspace_teamspace", (q) =>
          (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("teamspaceId", teamspaceId)).take(2),
      scopes: (id, page) =>
        ctx.db.query("workspacePageScopes").withIndex("by_workspace_page", (q) => (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", page)).take(2),
      grants: async (id, page) =>
        (await ctx.db.query("workspacePageGrants").withIndex("by_workspace_page", (q) => (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", page)).take(101))
          .map((row) => ({
            workspaceId: row.workspaceId, pageId: row.pageId,
            subjectType: row.subjectType,
            subjectId: row.subjectId,
            effect: row.effect,
            level: row.level,
          })),
    }, identity.subject, workspaceId, pageId, capability);
  },
});
