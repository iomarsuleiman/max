import { validPrincipalId, validWorkspaceId } from "./workspaceManagementPolicy";
import type { MembershipStatus, WorkspaceRole } from "./workspacePolicy";

/** Only trusted Convex reads may implement this store. Never pass a client role,
 * email, owner ID, membership ID, or workspace list into this policy. */
export interface NavigationMembership {
  workspaceId: string;
  accountId: string;
  role: WorkspaceRole;
  status: MembershipStatus;
}

export interface NavigationWorkspace {
  workspaceId: string;
  ownerId: string;
  status: "active" | "disabled";
}

export interface NavigationStore {
  membershipsForAccount(accountId: string): Promise<readonly NavigationMembership[]>;
  workspaces(workspaceId: string): Promise<readonly NavigationWorkspace[]>;
  ownerMemberships(workspaceId: string, ownerAccountId: string): Promise<readonly NavigationMembership[]>;
}

export interface WorkspaceNavigationSummary {
  workspaceId: string;
  role: WorkspaceRole;
}

const MAX_NAV_WORKSPACES = 50;
const ROLES: readonly string[] = ["owner", "admin", "member", "guest"];
const STATUSES: readonly string[] = ["active", "suspended", "revoked"];

/** Authenticated, bounded, fail-closed membership-only navigation projection.
 * A summary is NOT proof of page access and must never authorize content/MCP.
 * One corrupt or unbounded membership snapshot denies the entire navigation
 * result rather than silently presenting a potentially forged workspace. */
export async function listAuthorizedWorkspaceSummaries(
  store: NavigationStore,
  verifiedAccountId: string | null,
): Promise<WorkspaceNavigationSummary[]> {
  if (!verifiedAccountId || !validPrincipalId(verifiedAccountId)) return [];
  const memberships = await store.membershipsForAccount(verifiedAccountId);
  if (memberships.length > MAX_NAV_WORKSPACES) return [];
  const seen = new Set<string>();
  const result: WorkspaceNavigationSummary[] = [];

  for (const member of memberships) {
    if (member.accountId !== verifiedAccountId ||
      !validWorkspaceId(member.workspaceId) ||
      seen.has(member.workspaceId) ||
      !ROLES.includes(member.role) ||
      !STATUSES.includes(member.status)) return [];
    seen.add(member.workspaceId);
    if (member.status !== "active") continue;

    const workspaces = await store.workspaces(member.workspaceId);
    if (workspaces.length !== 1) return [];
    const workspace = workspaces[0];
    if (workspace.workspaceId !== member.workspaceId ||
      workspace.status !== "active" ||
      !validPrincipalId(workspace.ownerId) ||
      (member.role === "owner") !== (workspace.ownerId === verifiedAccountId)) return [];

    const owners = await store.ownerMemberships(member.workspaceId, workspace.ownerId);
    if (owners.length !== 1 ||
      owners[0].workspaceId !== workspace.workspaceId ||
      owners[0].accountId !== workspace.ownerId ||
      owners[0].role !== "owner" ||
      owners[0].status !== "active") return [];

    result.push({ workspaceId: member.workspaceId, role: member.role });
  }
  return result.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
}

/** IDs are never interpolated into a navigation URL before validation. */
export function workspacePreviewHref(workspaceId: string): string | null {
  return validWorkspaceId(workspaceId) ? `/w/${workspaceId}` : null;
}
