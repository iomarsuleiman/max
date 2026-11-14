import type { DatabaseReader } from "./_generated/server";
import type { PagePolicyReader } from "../lib/domain/collaboration/authorization";
import { MaxError } from "../lib/domain/errors";
import { convexCollaborationStore } from "./collaborationStore";
import { COLLABORATION_LIMITS } from "../lib/domain/collaboration/collaborationStore";

/**
 * Read alongside membership/ACL evaluation in the SAME Convex transaction.
 * No cache survives a call, so earlier batch writes cannot leave stale grants.
 * This reader is not connected to the legacy content dispatcher yet.
 */
export function convexPagePolicies(db: DatabaseReader): PagePolicyReader {
  const metadata = convexCollaborationStore(db);
  return {
    async getPolicyPage(pageId) {
      const id = db.normalizeId("pages", pageId);
      if (!id) return null;
      const page = await db.get(id);
      if (!page || (page.parentId !== null && page.databaseId !== null)) return null;
      if (page.databaseId !== null) {
        const databaseId = db.normalizeId("pages", page.databaseId);
        const database = databaseId ? await db.get(databaseId) : null;
        if (!database || database.kind !== "database") return null;
      }
      const workspace = await metadata.transaction(async (tx) =>
        page.workspaceId === undefined ? tx.getPersonalWorkspace(page.ownerId) : tx.getWorkspace(page.workspaceId),
      );
      if (!workspace || workspace.state !== "active") return null;
      if (workspace.kind === "personal" && workspace.ownerId !== page.ownerId) return null;
      const access = await db
        .query("collabPageAccess")
        .withIndex("by_pageId", (q) => q.eq("pageId", page._id))
        .take(2);
      if (access.length > 1) throw new MaxError("INTERNAL", "Page access metadata is inconsistent. No content was returned.");
      const rule = access[0];
      if (rule && rule.workspaceId !== workspace.id) return null;
      if (rule && rule.grants.length > COLLABORATION_LIMITS.grantsPerPage) throw new MaxError("LIMIT", "This page exceeds the supported access-grant limit.");
      return {
        id: page._id,
        workspaceId: workspace.id,
        parentId: page.parentId ?? page.databaseId,
        teamspaceId: page.teamspaceId ?? null,
        access: rule ? { mode: rule.mode, grants: rule.grants } : { mode: "inherit", grants: [] },
      };
    },
  };
}
