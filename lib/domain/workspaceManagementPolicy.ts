import type { MembershipStatus, WorkspaceRole } from "./workspacePolicy";

type Actor = { accountId: string; role: WorkspaceRole };
type Member = { accountId: string; role: WorkspaceRole; status: MembershipStatus };

export const validWorkspaceId = (id: string): boolean =>
  /^[a-z0-9][a-z0-9-]{5,63}$/.test(id) && !id.endsWith("-");

export const validPrincipalId = (id: string): boolean =>
  id.length > 0 && id.length <= 256 && /^[A-Za-z0-9_.:@-]+$/.test(id);

export const validScopeId = (id: string): boolean =>
  id.length > 0 && id.length <= 128 && /^[A-Za-z0-9_.:@-]+$/.test(id);

/** Single-owner shadow model: an ownership change requires a separate atomic transfer. */
export function canManageMember(
  actor: Actor,
  ownerId: string,
  target: Member | null,
  next: { accountId: string; role: Exclude<WorkspaceRole, "owner">; status: MembershipStatus },
): boolean {
  if (actor.role !== "owner" && actor.role !== "admin") return false;
  if (actor.role === "owner" && actor.accountId !== ownerId) return false;
  if (actor.role === "admin" && actor.accountId === ownerId) return false;
  if (!validPrincipalId(next.accountId) || next.accountId === ownerId) return false;
  // PR 05: direct creation is forbidden. An account joins only by accepting
  // a pending invitation bound to its authenticated Clerk subject.
  if (!target) return false;
  if (target.accountId !== next.accountId) return false;
  if (target?.role === "owner" || target?.status === "revoked") return false;
  if (actor.role === "admin" &&
      (next.accountId === actor.accountId || next.role === "admin" || target?.role === "admin")) return false;
  // Never fabricate a suspended/revoked identity. Revoked accounts are terminal
  // until a separate verified invitation flow is implemented.
  if (!target && next.status !== "active") return false;
  return true;
}

export function canManageAffiliation(
  actor: Actor,
  ownerId: string,
  target: Member | null,
): boolean {
  if (!target) return false;
  if (actor.role === "owner") return actor.accountId === ownerId;
  return actor.role === "admin" && actor.accountId !== ownerId &&
    target.role !== "owner" && target.role !== "admin";
}

export function canTransferOwnership(
  actor: Actor,
  ownerId: string,
  oldOwner: Member | null,
  nextOwner: Member | null,
): boolean {
  return actor.accountId === ownerId &&
    actor.role === "owner" && oldOwner?.accountId === ownerId &&
    oldOwner.role === "owner" && oldOwner.status === "active" &&
    nextOwner !== null && nextOwner.accountId !== ownerId &&
    (nextOwner.role === "admin" || nextOwner.role === "member") &&
    nextOwner.status === "active";
}

export function canManageGrant(
  actor: Actor,
  ownerId: string,
  subjectType: "account" | "group" | "workspace_role",
  subjectId: string,
): boolean {
  if (actor.role === "owner") return actor.accountId === ownerId;
  if (actor.role !== "admin" || actor.accountId === ownerId) return false;
  // Admins cannot lock the sole owner (or themselves) out with deny grants,
  // nor modify the owner/admin role-wide ACL.
  if (subjectType === "account" && (subjectId === ownerId || subjectId === actor.accountId)) return false;
  if (subjectType !== "account") return false; // group/role grants may include the owner
  return true;
}
