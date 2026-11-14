/**
 * Collaboration policy contract. Not connected to the v1 operation dispatcher.
 * Adapters must supply a fresh, server-resolved snapshot, never client claims.
 * See docs/COLLABORATION_POLICY.md for precedence and rollout constraints.
 */
export type WorkspaceRole = "owner" | "admin" | "member" | "guest";
export const PAGE_GRANTS = ["view", "comment", "edit_content", "edit", "full"] as const;
export type PageGrant = (typeof PAGE_GRANTS)[number];

export type PageCapability =
  | "page.read"
  | "page.export"
  | "page.comment"
  | "page.edit_content"
  | "page.edit_metadata"
  | "page.create_child"
  | "page.move"
  | "page.archive"
  | "page.restore"
  | "page.share"
  | "database.edit_values"
  | "database.edit_schema"
  | "history.restore";

const grantLevel: Record<PageGrant, number> = { view: 1, comment: 2, edit_content: 3, edit: 4, full: 5 };
const capabilityLevel: Record<PageCapability, number> = {
  "page.read": 1,
  "page.export": 1,
  "page.comment": 2,
  "page.edit_content": 3,
  "page.edit_metadata": 4,
  "page.create_child": 4,
  "page.move": 5,
  "page.archive": 4,
  "page.restore": 4,
  "page.share": 5,
  "database.edit_values": 3,
  "database.edit_schema": 4,
  "history.restore": 4,
};

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  state: "active" | "revoked";
}

export interface GroupMembership {
  workspaceId: string;
  groupId: string;
  userId: string;
  state: "active" | "revoked";
}

export type GrantPrincipal = { kind: "user"; userId: string } | { kind: "group"; groupId: string } | { kind: "workspace_members" };

export type AccessGrant = { principal: GrantPrincipal } & ({ effect: "allow"; grant: PageGrant; expiresAt: number | null } | { effect: "deny" });

export interface PolicyPage {
  id: string;
  workspaceId: string;
  parentId: string | null;
  teamspaceId: string | null;
  /** Replace starts a restricted subtree; an ancestor deny still applies. */
  access: { mode: "inherit" | "replace"; grants: readonly AccessGrant[] };
}

export interface PolicyTeamspace {
  id: string;
  workspaceId: string;
  visibility: "open" | "closed" | "private";
  memberUserIds: readonly string[];
  memberGroupIds: readonly string[];
  /** The initial grant for admitted non-guest members. Guests need page grants. */
  defaultGrant: PageGrant;
}

export type PolicyWorkspace = { id: string; state: "active" | "archived" } & ({ kind: "personal"; ownerId: string } | { kind: "organization" });

export interface PolicySnapshot {
  workspace: PolicyWorkspace;
  userId: string;
  membership: WorkspaceMembership | null;
  groupMemberships: readonly GroupMembership[];
  teamspaces: readonly PolicyTeamspace[];
  pages: readonly PolicyPage[];
  now: number;
}

export type PageAccess =
  | { allowed: true; grant: PageGrant; source: { kind: "workspace" } | { kind: "teamspace"; teamspaceId: string } | { kind: "page"; pageId: string } }
  | { allowed: false };

const denied: PageAccess = Object.freeze({ allowed: false });
const MAX_ANCESTORS = 100;

function activeMembership(snapshot: PolicySnapshot): WorkspaceMembership | null {
  const member = snapshot.membership;
  if (
    snapshot.workspace.state !== "active" ||
    !Number.isFinite(snapshot.now) ||
    !member ||
    member.state !== "active" ||
    member.userId !== snapshot.userId ||
    member.workspaceId !== snapshot.workspace.id ||
    (snapshot.workspace.kind === "personal" && (member.role !== "owner" || member.userId !== snapshot.workspace.ownerId))
  )
    return null;
  return member;
}

/** A duplicate membership with a revoked state is never treated as active. */
function activeGroups(snapshot: PolicySnapshot): Set<string> {
  const active = new Set<string>();
  const revoked = new Set<string>();
  for (const membership of snapshot.groupMemberships) {
    if (membership.workspaceId !== snapshot.workspace.id || membership.userId !== snapshot.userId) continue;
    if (membership.state === "active") active.add(membership.groupId);
    else revoked.add(membership.groupId);
  }
  for (const groupId of revoked) active.delete(groupId);
  return active;
}

function principalMatches(principal: GrantPrincipal, member: WorkspaceMembership, groups: ReadonlySet<string>): boolean {
  switch (principal.kind) {
    case "user":
      return principal.userId === member.userId;
    case "group":
      return groups.has(principal.groupId);
    case "workspace_members":
      return member.role !== "guest";
    default: {
      const exhaustive: never = principal;
      return exhaustive;
    }
  }
}

/** Validate the complete ancestry before applying any grant, including owner access. */
function pagePath(snapshot: PolicySnapshot, pageId: string): PolicyPage[] | null {
  const pages = new Map<string, PolicyPage>();
  for (const page of snapshot.pages) {
    if (pages.has(page.id)) return null;
    pages.set(page.id, page);
  }
  const path: PolicyPage[] = [];
  const seen = new Set<string>();
  let cursor: string | null = pageId;
  while (cursor !== null) {
    if (seen.has(cursor) || path.length >= MAX_ANCESTORS) return null;
    seen.add(cursor);
    const page = pages.get(cursor);
    if (!page || page.workspaceId !== snapshot.workspace.id) return null;
    if (path.length && path[0].teamspaceId !== page.teamspaceId) return null;
    path.push(page);
    cursor = page.parentId;
  }
  return path.reverse();
}

/** No denial reason is exposed, so absent and unauthorized IDs have the same result. */
export function evaluatePageAccess(snapshot: PolicySnapshot, pageId: string): PageAccess {
  const member = activeMembership(snapshot);
  if (!member) return denied;
  const path = pagePath(snapshot, pageId);
  if (!path?.length) return denied;
  const groups = activeGroups(snapshot);
  const root = path[0];
  let access: PageAccess = denied;

  if (root.teamspaceId !== null) {
    if (snapshot.workspace.kind !== "organization") return denied;
    const matches = snapshot.teamspaces.filter((teamspace) => teamspace.id === root.teamspaceId);
    const teamspace = matches[0];
    if (matches.length !== 1 || !teamspace || teamspace.workspaceId !== snapshot.workspace.id) return denied;
    const explicitlyAdmitted = teamspace.memberUserIds.includes(member.userId) || teamspace.memberGroupIds.some((id) => groups.has(id));
    if (!explicitlyAdmitted && !(teamspace.visibility === "open" && member.role !== "guest")) return denied;
    if (member.role !== "guest") {
      access = { allowed: true, grant: teamspace.defaultGrant, source: { kind: "teamspace", teamspaceId: teamspace.id } };
    }
  } else if (snapshot.workspace.kind === "personal") {
    access = { allowed: true, grant: "full", source: { kind: "workspace" } };
  }

  for (const page of path) {
    if (page.access.mode === "replace") access = denied;
    for (const entry of page.access.grants) {
      if (!principalMatches(entry.principal, member, groups)) continue;
      if (entry.effect === "deny") return denied;
      if (entry.expiresAt !== null && (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= snapshot.now)) continue;
      if (!access.allowed || grantLevel[entry.grant] > grantLevel[access.grant]) {
        access = { allowed: true, grant: entry.grant, source: { kind: "page", pageId: page.id } };
      }
    }
  }
  return access;
}

export function canPage(snapshot: PolicySnapshot, pageId: string, capability: PageCapability): boolean {
  const access = evaluatePageAccess(snapshot, pageId);
  return access.allowed && grantLevel[access.grant] >= capabilityLevel[capability];
}

/** Structural moves stay inside one teamspace. Cross-boundary moves need a separate reviewed transfer contract. */
export function canMovePage(snapshot: PolicySnapshot, sourceId: string, destinationId: string): boolean {
  if (!canPage(snapshot, sourceId, "page.move") || !canPage(snapshot, destinationId, "page.create_child")) return false;
  const sourcePath = pagePath(snapshot, sourceId);
  const destinationPath = pagePath(snapshot, destinationId);
  if (!sourcePath?.length || !destinationPath?.length || destinationPath.some((page) => page.id === sourceId)) return false;
  return sourcePath[0].teamspaceId === destinationPath[0].teamspaceId;
}

/** Both the readable source and writable destination must be checked before a copy. */
export function canDuplicatePage(snapshot: PolicySnapshot, sourceId: string, destinationId: string): boolean {
  return canPage(snapshot, sourceId, "page.read") && canPage(snapshot, destinationId, "page.create_child");
}

export type WorkspaceCapability = "workspace.manage_settings" | "workspace.manage_members" | "workspace.manage_groups" | "workspace.delete";

const workspaceRoles: Record<WorkspaceCapability, readonly WorkspaceRole[]> = {
  "workspace.manage_settings": ["owner", "admin"],
  "workspace.manage_members": ["owner", "admin"],
  "workspace.manage_groups": ["owner", "admin"],
  "workspace.delete": ["owner"],
};

export function canWorkspace(snapshot: PolicySnapshot, capability: WorkspaceCapability): boolean {
  const member = activeMembership(snapshot);
  if (snapshot.workspace.kind === "personal" && (capability === "workspace.manage_members" || capability === "workspace.manage_groups")) return false;
  return member !== null && workspaceRoles[capability].includes(member.role);
}

/** Use inside the transaction that writes the membership, with a fresh complete member list. */
export function canChangeMembership(
  snapshot: PolicySnapshot,
  members: readonly WorkspaceMembership[],
  targetUserId: string,
  next: { state: "active"; role: WorkspaceRole } | { state: "revoked" },
): boolean {
  const actor = activeMembership(snapshot);
  if (!actor || snapshot.workspace.kind !== "organization" || !canWorkspace(snapshot, "workspace.manage_members")) return false;
  const seen = new Set<string>();
  for (const member of members) {
    if (member.workspaceId !== snapshot.workspace.id) continue;
    if (seen.has(member.userId)) return false;
    seen.add(member.userId);
  }
  const storedActor = members.find((member) => member.workspaceId === snapshot.workspace.id && member.userId === actor.userId);
  if (!storedActor || storedActor.state !== actor.state || storedActor.role !== actor.role) return false;
  const matching = members.filter((member) => member.workspaceId === snapshot.workspace.id && member.userId === targetUserId);
  if (matching.length !== 1) return false;
  const target = matching[0];
  if ((target.role === "owner" || (next.state === "active" && next.role === "owner")) && actor.role !== "owner") return false;
  const demotesOwner = target.state === "active" && target.role === "owner" && (next.state !== "active" || next.role !== "owner");
  if (demotesOwner) {
    const remainingOwners = new Set(
      members
        .filter(
          (member) => member.workspaceId === snapshot.workspace.id && member.userId !== targetUserId && member.state === "active" && member.role === "owner",
        )
        .map((member) => member.userId),
    );
    if (!remainingOwners.size) return false;
  }
  return true;
}
