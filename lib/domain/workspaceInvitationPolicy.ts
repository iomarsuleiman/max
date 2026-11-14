import type { MembershipStatus, WorkspaceRole } from "./workspacePolicy";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";

export type InviteRole = Exclude<WorkspaceRole, "owner">;
export type InviteActor = { accountId: string; role: WorkspaceRole; status: MembershipStatus };
export type InviteTarget = { accountId: string; role: WorkspaceRole; status: MembershipStatus };

/** A verified invitation is tied to a Clerk/Convex subject; never to an
 * unverified email, invite URL, or a browser-asserted actor role. */
export function canIssueInvitation(
  actor: InviteActor | null, ownerId: string, targetId: string,
  role: InviteRole, target: InviteTarget | null,
): boolean {
  if (!actor || actor.status !== "active" || !validPrincipalId(targetId) ||
      actor.accountId === targetId || targetId === ownerId) return false;
  if ((actor.role === "owner") !== (actor.accountId === ownerId)) return false;
  if (actor.role !== "owner" && actor.role !== "admin") return false;
  if (role !== "admin" && role !== "member" && role !== "guest") return false;
  if (target && (target.accountId !== targetId || target.role === "owner" ||
      target.status !== "revoked")) return false;
  if (actor.role === "admin" && (role === "admin" || target?.role === "admin")) return false;
  return true;
}

export type ScopeAncestor = {
  workspaceId: string; pageId: string; parentId: string | null; teamspaceId: string | null;
};
/** A new scope is a declaration only, never a reference to existing personal
 * page content. All ancestors must be in one tenant and one teamspace. */
export function validNewPageScope(
  workspaceId: string, pageId: string, parentId: string | null,
  teamspaceId: string | null, ancestors: readonly ScopeAncestor[], teamspaceExists: boolean,
): boolean {
  if (!validWorkspaceId(workspaceId) || !validScopeId(pageId) ||
      (parentId !== null && !validScopeId(parentId)) ||
      (teamspaceId !== null && (!validScopeId(teamspaceId) || !teamspaceExists))) return false;
  if (ancestors.length > 63 || (parentId === null) !== (ancestors.length === 0)) return false;
  const visited = new Set<string>([pageId]);
  let expected = parentId;
  for (const ancestor of ancestors) {
    if (expected === null || visited.has(expected) ||
        ancestor.pageId !== expected || ancestor.workspaceId !== workspaceId ||
        ancestor.teamspaceId !== teamspaceId) return false;
    visited.add(expected);
    expected = ancestor.parentId;
  }
  return expected === null;
}
