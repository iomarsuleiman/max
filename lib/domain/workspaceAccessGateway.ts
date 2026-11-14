import {
  canAccessPage,
  type Capability,
  type MembershipStatus,
  type PageAccessLevel,
  type PageGrant,
  type PageScope,
  type WorkspaceRole,
} from "./workspacePolicy";

export interface WorkspaceRow {
  workspaceId: string;
  ownerId: string;
  status: "active" | "disabled";
}

export interface MembershipRow {
  accountId: string;
  role: WorkspaceRole;
  status: MembershipStatus;
}

export interface AffiliationRow {
  id: string;
  status: MembershipStatus;
}

export interface ScopeRow {
  pageId: string;
  workspaceId: string;
  parentId: string | null;
  teamspaceId: string | null;
}

export interface GrantRow {
  subjectType: "account" | "group" | "workspace_role";
  subjectId: string;
  effect: "allow" | "deny";
  level: PageAccessLevel;
}

/** Only the trusted backend implements this data source. There are no client-supplied
 * membership, role, grant, group or ancestor arguments to the Convex query. */
export interface WorkspaceAuthorizationStore {
  workspaces(workspaceId: string): Promise<readonly WorkspaceRow[]>;
  memberships(workspaceId: string, accountId: string): Promise<readonly MembershipRow[]>;
  groups(workspaceId: string, accountId: string): Promise<readonly AffiliationRow[]>;
  teamspaces(workspaceId: string, accountId: string): Promise<readonly AffiliationRow[]>;
  scopes(workspaceId: string, pageId: string): Promise<readonly ScopeRow[]>;
  grants(workspaceId: string, pageId: string): Promise<readonly GrantRow[]>;
}

const MAX_DEPTH = 64;

/**
 * Fail-closed backend authorization. Verifies a Clerk/Convex identity against
 * server-stored workspace membership, page ancestry and permission grants.
 * Denied and nonexistent scopes have the same response: false.
 *
 * This is a safe read-only integration seam; it DOES NOT grant access to legacy
 * owner-scoped pages, media, MCP resources, mutations or workspace writes.
 */
export async function canAccessWorkspacePageFromServer(
  store: WorkspaceAuthorizationStore,
  verifiedAccountId: string | null,
  workspaceId: string,
  pageId: string,
  capability: Capability,
): Promise<boolean> {
  if (!verifiedAccountId?.trim() || !workspaceId.trim() || !pageId.trim() ||
      workspaceId.length > 128 || pageId.length > 128) return false;

  const workspaces = await store.workspaces(workspaceId);
  if (workspaces.length !== 1 || workspaces[0].workspaceId !== workspaceId ||
      workspaces[0].status !== "active" || !workspaces[0].ownerId) return false;

  const memberships = await store.memberships(workspaceId, verifiedAccountId);
  if (memberships.length !== 1) return false;
  const member = memberships[0];
  if (member.accountId !== verifiedAccountId || member.status !== "active") return false;
  // A forged or stale owner membership cannot override the actual workspace owner.
  if ((member.role === "owner") !== (workspaces[0].ownerId === verifiedAccountId)) return false;

  const [groups, teamspaces] = await Promise.all([
    store.groups(workspaceId, verifiedAccountId),
    store.teamspaces(workspaceId, verifiedAccountId),
  ]);
  const principal = {
    accountId: verifiedAccountId,
    workspaceId,
    role: member.role,
    membershipStatus: member.status,
    groupIds: [...new Set(groups.filter((row) => row.status === "active").map((row) => row.id))],
    teamspaceIds: [...new Set(teamspaces.filter((row) => row.status === "active").map((row) => row.id))],
  };

  const pages: PageScope[] = [];
  const grants: PageGrant[] = [];
  const visited = new Set<string>();
  let cursor: string | null = pageId;
  for (let depth = 0; cursor !== null; depth++) {
    if (depth >= MAX_DEPTH || visited.has(cursor)) return false;
    visited.add(cursor);
    const matching = await store.scopes(workspaceId, cursor);
    if (matching.length !== 1) return false;
    const row = matching[0];
    if (row.workspaceId !== workspaceId || row.pageId !== cursor) return false;
    pages.push({ id: row.pageId, workspaceId: row.workspaceId, parentId: row.parentId, teamspaceId: row.teamspaceId });
    const storedGrants = await store.grants(workspaceId, cursor);
    for (const grant of storedGrants) {
      if (!grant.subjectId.trim()) return false;
      grants.push({
        pageId: cursor,
        subject: { type: grant.subjectType, id: grant.subjectId },
        effect: grant.effect,
        level: grant.level,
      });
    }
    cursor = row.parentId;
  }

  return canAccessPage(principal, pageId, capability, { pages, grants });
}
