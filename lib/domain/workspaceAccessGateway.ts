import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";
import { validPageGrantRows } from "./workspaceMutationIntegrity";
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
  workspaceId: string;
  accountId: string;
  role: WorkspaceRole;
  status: MembershipStatus;
}

export interface AffiliationRow {
  workspaceId: string;
  accountId: string;
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
  workspaceId: string;
  pageId: string;
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
  groupRegistrations(workspaceId: string, groupId: string): Promise<readonly { workspaceId: string; groupId: string }[]>;
  teamspaceRegistrations(workspaceId: string, teamspaceId: string): Promise<readonly { workspaceId: string; teamspaceId: string }[]>;
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
  if (!verifiedAccountId || !validPrincipalId(verifiedAccountId) ||
      !validWorkspaceId(workspaceId) || !validScopeId(pageId)) return false;

  const workspaces = await store.workspaces(workspaceId);
  if (workspaces.length !== 1 || workspaces[0].workspaceId !== workspaceId ||
      workspaces[0].status !== "active" || !validPrincipalId(workspaces[0].ownerId)) return false;

  const memberships = await store.memberships(workspaceId, verifiedAccountId);
  if (memberships.length !== 1) return false;
  const member = memberships[0];
  if (member.workspaceId !== workspaceId || member.accountId !== verifiedAccountId ||
      member.status !== "active" ||
      !["owner", "admin", "member", "guest"].includes(member.role)) return false;
  // A forged or stale owner membership cannot override the actual workspace owner.
  if ((member.role === "owner") !== (workspaces[0].ownerId === verifiedAccountId)) return false;

  const [groups, teamspaces] = await Promise.all([
    store.groups(workspaceId, verifiedAccountId),
    store.teamspaces(workspaceId, verifiedAccountId),
  ]);
  // Corrupted or phantom affiliations must fail closed before ACL evaluation.
  if (groups.length > 100 || teamspaces.length > 100) return false;
  const seenGroups = new Set<string>();
  const seenTeams = new Set<string>();
  for (const g of groups) {
    if (g.workspaceId !== workspaceId || g.accountId !== verifiedAccountId ||
        !validScopeId(g.id) || seenGroups.has(g.id) ||
        !["active", "suspended", "revoked"].includes(g.status)) return false;
    seenGroups.add(g.id);
    if (g.status === "active") {
      const rows = await store.groupRegistrations(workspaceId, g.id);
      if (rows.length !== 1 || rows[0].workspaceId !== workspaceId || rows[0].groupId !== g.id) return false;
    }
  }
  for (const t of teamspaces) {
    if (t.workspaceId !== workspaceId || t.accountId !== verifiedAccountId ||
        !validScopeId(t.id) || seenTeams.has(t.id) ||
        !["active", "suspended", "revoked"].includes(t.status)) return false;
    seenTeams.add(t.id);
    if (t.status === "active") {
      const rows = await store.teamspaceRegistrations(workspaceId, t.id);
      if (rows.length !== 1 || rows[0].workspaceId !== workspaceId || rows[0].teamspaceId !== t.id) return false;
    }
  }
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
    if (row.workspaceId !== workspaceId || row.pageId !== cursor ||
        (row.parentId !== null && (typeof row.parentId !== "string" || !validScopeId(row.parentId))) ||
        (row.teamspaceId !== null && (typeof row.teamspaceId !== "string" || !validScopeId(row.teamspaceId)))) return false;
    pages.push({ id: row.pageId, workspaceId: row.workspaceId, parentId: row.parentId, teamspaceId: row.teamspaceId });
    const storedGrants = await store.grants(workspaceId, cursor);
    // Validate EVERY ACL row before evaluating even an owner/admin allow. A
    // malformed or duplicate unrelated grant is data corruption, not access.
    if (!validPageGrantRows(storedGrants, workspaceId, cursor)) return false;
    for (const grant of storedGrants) {
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
