import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { convexCollaborationStore } from "./collaborationStore";

/** Read-only operator probe. No content or membership metadata leaves this query. */
export const probeStorage = internalQuery({
  args: {},
  returns: v.object({ checkedIndexes: v.number() }),
  handler: async (ctx) =>
    convexCollaborationStore(ctx.db).transaction(async (tx) => {
      const absent = "__max_storage_probe__";
      const checks = [
        tx.getWorkspace(absent),
        tx.getPersonalWorkspace(absent),
        tx.getMembership(absent, absent),
        tx.listWorkspaceMemberships(absent),
        tx.listUserMemberships(absent),
        tx.getGroup(absent),
        tx.listGroups(absent),
        tx.listGroupMemberships(absent, absent),
        tx.listUserGroupMemberships(absent, absent),
        tx.getTeamspace(absent),
        tx.listTeamspaces(absent),
        tx.getInvitation(absent),
        tx.getInvitationByHash(absent),
        tx.listOpenInvitations(absent, 0),
        ctx.db
          .query("collabAudit")
          .withIndex("by_logicalId", (q) => q.eq("logicalId", absent))
          .take(1),
        ctx.db
          .query("collabAudit")
          .withIndex("by_workspaceId_at", (q) => q.eq("workspaceId", absent))
          .take(1),
        ctx.db.query("collabPageAccess").withIndex("by_pageId").take(1),
        ctx.db
          .query("collabPageAccess")
          .withIndex("by_workspaceId_pageId", (q) => q.eq("workspaceId", absent))
          .take(1),
      ];
      await Promise.all(checks);
      return { checkedIndexes: checks.length };
    }),
});
