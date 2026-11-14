import type { DatabaseReader } from "./_generated/server";
import type { PagePolicyReader } from "../lib/domain/collaboration/authorization";
import { convexCollaborationStore } from "./collaborationStore";
import { readPageGrantSet } from "./pageGrantStore";

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
      const { header: rule, rows } = await readPageGrantSet(db, page._id, workspace.id);
      return {
        id: page._id,
        workspaceId: workspace.id,
        parentId: page.parentId ?? page.databaseId,
        teamspaceId: page.teamspaceId ?? null,
        access: rule ? { mode: rule.mode, grants: rows.map((row) => row.value) } : { mode: "inherit", grants: [] },
      };
    },
  };
}
