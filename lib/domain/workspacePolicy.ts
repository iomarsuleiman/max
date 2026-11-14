/**
 * Phase 00 policy contract ONLY. It is deliberately not wired to a public API,
 * Convex table, MCP tool, or UI while collaboration is disabled.
 *
 * All inputs must be supplied from server-verified identity and membership.
 * Never trust a role or grant submitted by a browser or MCP caller.
 */
export type WorkspaceRole = "owner" | "admin" | "member" | "guest";
export type MembershipStatus = "active" | "suspended" | "revoked";
export type Capability = "view" | "comment" | "edit_content" | "edit" | "manage";
export type PageAccessLevel = "view" | "comment" | "edit_content" | "edit" | "full_access";

export interface VerifiedPrincipal {
  accountId: string;
  workspaceId: string;
  role: WorkspaceRole;
  membershipStatus: MembershipStatus;
  groupIds: readonly string[];
  teamspaceIds: readonly string[];
}

export interface PageScope {
  id: string;
  workspaceId: string;
  parentId: string | null;
  /** Null means ordinary workspace content. Non-null requires teamspace membership. */
  teamspaceId: string | null;
}

export interface PageGrant {
  pageId: string;
  subject: { type: "account" | "group" | "workspace_role"; id: string };
  effect: "allow" | "deny";
  /** A deny blocks access regardless of level. */
  level: PageAccessLevel;
}

export interface PermissionSnapshot {
  pages: readonly PageScope[];
  grants: readonly PageGrant[];
}

const rank: Record<Capability | PageAccessLevel, number> = {
  view: 1,
  comment: 2,
  edit_content: 3,
  edit: 4,
  manage: 5,
  full_access: 5,
};

function matches(grant: PageGrant, principal: VerifiedPrincipal): boolean {
  const { type, id } = grant.subject;
  if (type === "account") return id === principal.accountId;
  if (type === "group") return principal.groupIds.includes(id);
  return type === "workspace_role" && id === principal.role;
}

/**
 * Default deny. Broken/missing ancestry, cycles, tenant mismatches, revoked
 * memberships and explicit inherited denies always fail closed. A caller
 * receives only a boolean, never the existence of a hidden page.
 *
 * This intentionally conservative contract does not confer permissions through
 * a teamspace just because the caller can view a workspace shell.
 */
export function canAccessPage(
  principal: VerifiedPrincipal | null,
  pageId: string,
  capability: Capability,
  policy: PermissionSnapshot,
): boolean {
  if (!principal || principal.membershipStatus !== "active" || !principal.accountId || !principal.workspaceId) return false;
  const pages = new Map(policy.pages.map((page) => [page.id, page]));
  if (pages.size !== policy.pages.length) return false;
  const ancestry: PageScope[] = [];
  const visited = new Set<string>();
  let current: string | null = pageId;
  let teamspace: string | null = null;
  while (current !== null) {
    if (visited.has(current)) return false;
    visited.add(current);
    const page = pages.get(current);
    if (!page || page.workspaceId !== principal.workspaceId) return false;
    if (teamspace && page.teamspaceId && teamspace !== page.teamspaceId) return false;
    teamspace ??= page.teamspaceId;
    ancestry.push(page);
    current = page.parentId;
  }
  if (!ancestry.length) return false;
  if (teamspace && !principal.teamspaceIds.includes(teamspace)) return false;

  // Explicit denial at any level beats all inherited and direct allows,
  // including elevated workspace roles (except future server-only break-glass).
  const ancestorIds = new Set(ancestry.map((page) => page.id));
  const applicable = policy.grants.filter((grant) => ancestorIds.has(grant.pageId) && matches(grant, principal));
  if (applicable.some((grant) => grant.effect === "deny")) return false;

  // Workspace owners/admins have full access inside their active membership.
  if (principal.role === "owner" || principal.role === "admin") return true;
  const needed = rank[capability];
  return applicable.some((grant) => grant.effect === "allow" && rank[grant.level] >= needed);
}

/** Reject removal/demotion of the last ACTIVE owner, before the write. */
export function retainsWorkspaceOwner(
  members: readonly { accountId: string; role: WorkspaceRole; status: MembershipStatus }[],
  accountId: string,
  nextRole: WorkspaceRole | null,
  nextStatus: MembershipStatus,
): boolean {
  const activeOwnerIds = new Set(members.filter((member) => member.role === "owner" && member.status === "active").map((member) => member.accountId));
  if (!activeOwnerIds.has(accountId)) return activeOwnerIds.size > 0;
  if (nextRole === "owner" && nextStatus === "active") return true;
  return activeOwnerIds.size > 1;
}
