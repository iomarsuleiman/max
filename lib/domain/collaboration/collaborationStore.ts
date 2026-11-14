import type { GroupMembership, PolicyTeamspace, PolicyWorkspace, WorkspaceMembership, WorkspaceRole } from "./policy";

/** Bounded transaction reads. A real adapter must throw on limit+1, never truncate. */
export const COLLABORATION_LIMITS = {
  membersPerWorkspace: 1_000,
  membershipsPerUser: 100,
  groupsPerWorkspace: 200,
  teamspacesPerWorkspace: 200,
  openInvitationsPerWorkspace: 200,
  grantsPerPage: 200,
};

export type CollaborationWorkspace = PolicyWorkspace & { name: string; createdAt: number; updatedAt: number };
export type CollaborationMembership = WorkspaceMembership & { joinedAt: number; updatedAt: number };
export type CollaborationGroupMembership = GroupMembership & { createdAt: number; updatedAt: number };

export interface CollaborationGroup {
  id: string;
  workspaceId: string;
  name: string;
  state: "active" | "archived";
  createdAt: number;
  updatedAt: number;
}

export type CollaborationTeamspace = PolicyTeamspace & {
  name: string;
  state: "active" | "archived";
  /** Explicit stewardship, separate from workspace governance and content grants. */
  managerUserIds: readonly string[];
  createdAt: number;
  updatedAt: number;
};

export type InvitationRole = Exclude<WorkspaceRole, "owner">;
export type CollaborationInvitation = {
  id: string;
  workspaceId: string;
  invitedBy: string;
  recipientEmail: string;
  role: InvitationRole;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
} & ({ state: "pending" } | { state: "accepted"; acceptedBy: string; acceptedAt: number } | { state: "revoked"; revokedBy: string; revokedAt: number });

export const COLLABORATION_AUDIT_TYPES = [
  "workspace.created",
  "workspace.renamed",
  "workspace.archived",
  "membership.changed",
  "group.created",
  "group.renamed",
  "group.archived",
  "group.membership_changed",
  "teamspace.created",
  "teamspace.access_changed",
  "teamspace.recovered",
  "teamspace.archived",
  "invitation.created",
  "invitation.accepted",
  "invitation.revoked",
] as const;
export type CollaborationAuditType = (typeof COLLABORATION_AUDIT_TYPES)[number];

export interface CollaborationAuditEvent {
  id: string;
  workspaceId: string;
  actorId: string;
  type: CollaborationAuditType;
  targetId: string;
  at: number;
  /** Never store invitation tokens, token hashes, recipient emails or content here. */
  detail: Readonly<Record<string, string | number | boolean>>;
}

/**
 * All reads and writes below run in one serializable transaction. Lists must be
 * complete within enforced product limits; truncation must throw, never pretend
 * an owner/member is absent. Implement indexed, bounded reads in a real adapter.
 */
export interface CollaborationTransaction {
  getWorkspace(id: string): Promise<CollaborationWorkspace | null>;
  /** Unique by immutable personal owner, including archived workspaces. */
  getPersonalWorkspace(ownerId: string): Promise<CollaborationWorkspace | null>;
  /** Enforce unique id and unique personal owner in storage, not just the caller. */
  insertWorkspace(workspace: CollaborationWorkspace): Promise<void>;
  /** ownerId/kind/id are immutable; this method cannot change them. */
  patchWorkspace(id: string, patch: { name?: string; state?: "active" | "archived"; updatedAt: number }): Promise<void>;

  getMembership(workspaceId: string, userId: string): Promise<CollaborationMembership | null>;
  listWorkspaceMemberships(workspaceId: string): Promise<CollaborationMembership[]>;
  listUserMemberships(userId: string): Promise<CollaborationMembership[]>;
  /** Upsert by the unique composite key (workspaceId, userId). */
  putMembership(membership: CollaborationMembership): Promise<void>;

  getGroup(id: string): Promise<CollaborationGroup | null>;
  /** Active groups only. */
  listGroups(workspaceId: string): Promise<CollaborationGroup[]>;
  insertGroup(group: CollaborationGroup): Promise<void>;
  patchGroup(id: string, patch: { name?: string; state?: "active" | "archived"; updatedAt: number }): Promise<void>;
  listGroupMemberships(workspaceId: string, groupId: string): Promise<CollaborationGroupMembership[]>;
  /** Active memberships only; archived-group history must not block revocation. */
  listUserGroupMemberships(workspaceId: string, userId: string): Promise<CollaborationGroupMembership[]>;
  /** Unique composite key (workspaceId, groupId, userId). */
  putGroupMembership(membership: CollaborationGroupMembership): Promise<void>;

  getTeamspace(id: string): Promise<CollaborationTeamspace | null>;
  /** Active teamspaces only. */
  listTeamspaces(workspaceId: string): Promise<CollaborationTeamspace[]>;
  insertTeamspace(teamspace: CollaborationTeamspace): Promise<void>;
  patchTeamspace(
    id: string,
    patch: Partial<Pick<CollaborationTeamspace, "name" | "state" | "visibility" | "defaultGrant" | "memberUserIds" | "memberGroupIds" | "managerUserIds">> & {
      updatedAt: number;
    },
  ): Promise<void>;

  getInvitation(id: string): Promise<CollaborationInvitation | null>;
  /** Unique hash lookup. Raw tokens must never enter persisted rows. */
  getInvitationByHash(hash: string): Promise<CollaborationInvitation | null>;
  /** Pending and unexpired only, using a workspace/state/expiry index. */
  listOpenInvitations(workspaceId: string, now: number): Promise<CollaborationInvitation[]>;
  insertInvitation(invitation: CollaborationInvitation): Promise<void>;
  /** Replace the same row while preserving its id, hash, issuer and recipient. */
  putInvitation(invitation: CollaborationInvitation): Promise<void>;
  appendAudit(event: CollaborationAuditEvent): Promise<void>;
}

export interface CollaborationStore {
  /** Roll back every mutation, including audit and invitation consumption, on failure. */
  transaction<T>(body: (transaction: CollaborationTransaction) => Promise<T>): Promise<T>;
}

/** Adapter-owned identity. No workspace id, role or membership comes from a client. */
export interface ResolvedCollaborationActor {
  userId: string;
  /** Canonical identity-provider-verified email, or null. Never a request-body claim. */
  verifiedEmail: string | null;
}

/** Server-owned clock and cryptography. Do not let request bodies configure this. */
export interface CollaborationRuntime {
  now(): number;
  newId(): string;
  createInvitationToken(): string;
  hashInvitationToken(token: string): Promise<string>;
}
