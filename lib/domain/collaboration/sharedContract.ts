import { z } from "zod";

export const sharedRole = z.enum(["owner", "admin", "member", "guest"]);
export const sharedGrant = z.enum(["view", "comment", "edit_content", "edit", "full"]);
export const workspaceSummary = z.object({ id: z.string(), name: z.string(), role: sharedRole });
export const workspaceList = z.object({ actorId: z.string(), workspaces: z.array(workspaceSummary) });
export const workspaceMember = z.object({ userId: z.string(), displayName: z.string(), role: sharedRole });
export const workspaceOverview = z.object({
  actorId: z.string(), id: z.string(), name: z.string(), role: sharedRole, canManageMembers: z.boolean(),
  teamspaces: z.array(z.object({ id: z.string(), name: z.string() })),
  members: z.array(workspaceMember),
});
export const sharedPageSummary = z.object({ id: z.string(), title: z.string(), teamspaceId: z.string().nullable(), updatedAt: z.number() });
export const sharedPageList = z.object({ actorId: z.string(), pages: z.array(sharedPageSummary), nextCursor: z.string().nullable() });
export const sharedPageView = z.object({
  actorId: z.string(), workspaceId: z.string(), page: sharedPageSummary,
  document: z.object({ content: z.string(), revision: z.number(), updatedAt: z.number() }),
  canEdit: z.boolean(), canRename: z.boolean(), canShare: z.boolean(), aclRevision: z.number(),
  permissions: z.array(z.object({ userId: z.string(), displayName: z.string(), grant: sharedGrant })),
});
export type WorkspaceList = z.infer<typeof workspaceList>;
export type WorkspaceOverview = z.infer<typeof workspaceOverview>;
export type SharedPageList = z.infer<typeof sharedPageList>;
export type SharedPageView = z.infer<typeof sharedPageView>;
