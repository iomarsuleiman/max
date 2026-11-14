import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { MaxError } from "../lib/domain/errors";
import {
  COLLABORATION_LIMITS,
  type CollaborationStore,
  type CollaborationTransaction,
  type CollaborationWorkspace,
  type CollaborationInvitation,
} from "../lib/domain/collaboration/collaborationStore";

function unique<T>(rows: T[]): T | null {
  if (rows.length > 1) throw new MaxError("INTERNAL", "Workspace metadata is inconsistent. No change was applied.");
  return rows[0] ?? null;
}

function bounded<T>(rows: T[], limit: number, identity: readonly (keyof T)[]): T[] {
  if (rows.length > limit) throw new MaxError("LIMIT", "This workspace exceeds the supported collaboration limit.");
  const seen = new Set<string>();
  for (const row of rows) {
    const key = JSON.stringify(identity.map((field) => row[field]));
    if (seen.has(key)) throw new MaxError("INTERNAL", "Workspace metadata is inconsistent. No change was applied.");
    seen.add(key);
  }
  return rows;
}

function plain<T extends { _id: unknown; _creationTime: number }>(row: T): Omit<T, "_id" | "_creationTime"> {
  const { _id: _id, _creationTime: _at, ...value } = row;
  return value;
}

function workspaceRow(row: Doc<"collabWorkspaces">): CollaborationWorkspace {
  const common = { id: row.logicalId, name: row.name, state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt };
  return row.kind === "personal" ? { ...common, kind: "personal", ownerId: row.ownerId } : { ...common, kind: "organization" };
}

function invitationRow(row: Doc<"collabInvitations">): CollaborationInvitation {
  const base = {
    id: row.logicalId,
    workspaceId: row.workspaceId,
    invitedBy: row.invitedBy,
    recipientEmail: row.recipientEmail,
    role: row.role,
    tokenHash: row.tokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
  switch (row.state) {
    case "pending":
      return { ...base, state: "pending" };
    case "accepted":
      return { ...base, state: "accepted", acceptedBy: row.acceptedBy, acceptedAt: row.acceptedAt };
    case "revoked":
      return { ...base, state: "revoked", revokedBy: row.revokedBy, revokedAt: row.revokedAt };
  }
}

/**
 * Internal storage adapter only. No authenticated public endpoint is added here.
 * Every service transaction must run inside ONE outer Convex mutation/query.
 * Convex supplies rollback/OCC; splitting body calls across mutations is unsafe.
 */
export function convexCollaborationStore(db: DatabaseReader | DatabaseWriter): CollaborationStore {
  const writer = (): DatabaseWriter => {
    if (!("insert" in db)) throw new MaxError("READ_ONLY", "Workspace changes require a mutation.");
    return db;
  };
  const workspace = async (id: string) =>
    unique(
      await db
        .query("collabWorkspaces")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", id))
        .take(2),
    );
  const group = async (id: string) =>
    unique(
      await db
        .query("collabGroups")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", id))
        .take(2),
    );
  const teamspace = async (id: string) =>
    unique(
      await db
        .query("collabTeamspaces")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", id))
        .take(2),
    );
  const invitation = async (id: string) =>
    unique(
      await db
        .query("collabInvitations")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", id))
        .take(2),
    );
  const membership = async (workspaceId: string, userId: string) =>
    unique(
      await db
        .query("collabMemberships")
        .withIndex("by_workspaceId_userId", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId))
        .take(2),
    );
  const groupMembership = async (workspaceId: string, groupId: string, userId: string) =>
    unique(
      await db
        .query("collabGroupMemberships")
        .withIndex("by_workspaceId_groupId_userId", (q) => q.eq("workspaceId", workspaceId).eq("groupId", groupId).eq("userId", userId))
        .take(2),
    );
  const duplicate = () => new MaxError("VALIDATION", "That workspace identifier is already in use.");
  const missing = () => new MaxError("NOT_FOUND", "This workspace resource does not exist.");

  const tx: CollaborationTransaction = {
    async getWorkspace(id) {
      const row = await workspace(id);
      return row ? workspaceRow(row) : null;
    },
    async getPersonalWorkspace(ownerId) {
      const row = unique(
        await db
          .query("collabWorkspaces")
          .withIndex("by_kind_ownerId", (q) => q.eq("kind", "personal").eq("ownerId", ownerId))
          .take(2),
      );
      return row ? workspaceRow(row) : null;
    },
    async insertWorkspace(value) {
      if (await workspace(value.id)) throw duplicate();
      if (value.kind === "personal" && (await tx.getPersonalWorkspace(value.ownerId))) throw duplicate();
      const { id, ...fields } = value;
      await writer().insert("collabWorkspaces", { ...fields, logicalId: id });
    },
    async patchWorkspace(id, patch) {
      const row = await workspace(id);
      if (!row) throw missing();
      await writer().patch(row._id, {
        updatedAt: patch.updatedAt,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
      });
    },
    async getMembership(workspaceId, userId) {
      const row = await membership(workspaceId, userId);
      return row ? plain(row) : null;
    },
    async listWorkspaceMemberships(workspaceId) {
      return bounded(
        await db
          .query("collabMemberships")
          .withIndex("by_workspaceId_userId", (q) => q.eq("workspaceId", workspaceId))
          .take(COLLABORATION_LIMITS.membersPerWorkspace + 1),
        COLLABORATION_LIMITS.membersPerWorkspace,
        ["workspaceId", "userId"],
      ).map(plain);
    },
    async listUserMemberships(userId) {
      return bounded(
        await db
          .query("collabMemberships")
          .withIndex("by_userId_workspaceId", (q) => q.eq("userId", userId))
          .take(COLLABORATION_LIMITS.membershipsPerUser + 1),
        COLLABORATION_LIMITS.membershipsPerUser,
        ["workspaceId", "userId"],
      ).map(plain);
    },
    async putMembership(value) {
      const row = await membership(value.workspaceId, value.userId);
      if (row) await writer().replace(row._id, value);
      else await writer().insert("collabMemberships", value);
    },
    async getGroup(id) {
      const row = await group(id);
      if (!row) return null;
      const { logicalId, ...fields } = plain(row);
      return { ...fields, id: logicalId };
    },
    async listGroups(workspaceId) {
      return bounded(
        await db
          .query("collabGroups")
          .withIndex("by_workspaceId_state", (q) => q.eq("workspaceId", workspaceId).eq("state", "active"))
          .take(COLLABORATION_LIMITS.groupsPerWorkspace + 1),
        COLLABORATION_LIMITS.groupsPerWorkspace,
        ["logicalId"],
      ).map((row) => {
        const { logicalId, ...fields } = plain(row);
        return { ...fields, id: logicalId };
      });
    },
    async insertGroup(value) {
      if (await group(value.id)) throw duplicate();
      const { id, ...fields } = value;
      await writer().insert("collabGroups", { ...fields, logicalId: id });
    },
    async patchGroup(id, patch) {
      const row = await group(id);
      if (!row) throw missing();
      await writer().patch(row._id, {
        updatedAt: patch.updatedAt,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
      });
    },
    async listGroupMemberships(workspaceId, groupId) {
      return bounded(
        await db
          .query("collabGroupMemberships")
          .withIndex("by_workspaceId_groupId_userId", (q) => q.eq("workspaceId", workspaceId).eq("groupId", groupId))
          .take(COLLABORATION_LIMITS.membersPerWorkspace + 1),
        COLLABORATION_LIMITS.membersPerWorkspace,
        ["workspaceId", "groupId", "userId"],
      ).map(plain);
    },
    async listUserGroupMemberships(workspaceId, userId) {
      const rows = bounded(
        await db
          .query("collabGroupMemberships")
          .withIndex("by_workspaceId_userId_state", (q) => q.eq("workspaceId", workspaceId).eq("userId", userId).eq("state", "active"))
          .take(COLLABORATION_LIMITS.groupsPerWorkspace + 1),
        COLLABORATION_LIMITS.groupsPerWorkspace,
        ["workspaceId", "groupId", "userId"],
      );
      // Detect a contradictory revoked duplicate outside the active index range.
      // Each verification reads at most two rows; historical memberships are not scanned.
      await Promise.all(rows.map((row) => groupMembership(row.workspaceId, row.groupId, row.userId)));
      return rows.map(plain);
    },
    async putGroupMembership(value) {
      const row = await groupMembership(value.workspaceId, value.groupId, value.userId);
      if (row) await writer().replace(row._id, value);
      else await writer().insert("collabGroupMemberships", value);
    },
    async getTeamspace(id) {
      const row = await teamspace(id);
      if (!row) return null;
      const { logicalId, ...fields } = plain(row);
      return { ...fields, id: logicalId };
    },
    async listTeamspaces(workspaceId) {
      return bounded(
        await db
          .query("collabTeamspaces")
          .withIndex("by_workspaceId_state", (q) => q.eq("workspaceId", workspaceId).eq("state", "active"))
          .take(COLLABORATION_LIMITS.teamspacesPerWorkspace + 1),
        COLLABORATION_LIMITS.teamspacesPerWorkspace,
        ["logicalId"],
      ).map((row) => {
        const { logicalId, ...fields } = plain(row);
        return { ...fields, id: logicalId };
      });
    },
    async insertTeamspace(value) {
      if (await teamspace(value.id)) throw duplicate();
      const { id, ...fields } = value;
      await writer().insert("collabTeamspaces", {
        ...fields,
        logicalId: id,
        memberUserIds: [...value.memberUserIds],
        memberGroupIds: [...value.memberGroupIds],
        managerUserIds: [...value.managerUserIds],
      });
    },
    async patchTeamspace(id, patch) {
      const row = await teamspace(id);
      if (!row) throw missing();
      await writer().patch(row._id, {
        updatedAt: patch.updatedAt,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.state !== undefined ? { state: patch.state } : {}),
        ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
        ...(patch.defaultGrant !== undefined ? { defaultGrant: patch.defaultGrant } : {}),
        ...(patch.memberUserIds !== undefined ? { memberUserIds: [...patch.memberUserIds] } : {}),
        ...(patch.memberGroupIds !== undefined ? { memberGroupIds: [...patch.memberGroupIds] } : {}),
        ...(patch.managerUserIds !== undefined ? { managerUserIds: [...patch.managerUserIds] } : {}),
      });
    },
    async getInvitation(id) {
      const row = await invitation(id);
      return row ? invitationRow(row) : null;
    },
    async getInvitationByHash(hash) {
      const row = unique(
        await db
          .query("collabInvitations")
          .withIndex("by_tokenHash", (q) => q.eq("tokenHash", hash))
          .take(2),
      );
      return row ? invitationRow(row) : null;
    },
    async listOpenInvitations(workspaceId, now) {
      return bounded(
        await db
          .query("collabInvitations")
          .withIndex("by_workspaceId_state_expiresAt", (q) => q.eq("workspaceId", workspaceId).eq("state", "pending").gt("expiresAt", now))
          .take(COLLABORATION_LIMITS.openInvitationsPerWorkspace + 1),
        COLLABORATION_LIMITS.openInvitationsPerWorkspace,
        ["logicalId"],
      ).map(invitationRow);
    },
    async insertInvitation(value) {
      if ((await invitation(value.id)) || (await tx.getInvitationByHash(value.tokenHash))) throw duplicate();
      const { id, ...fields } = value;
      await writer().insert("collabInvitations", { ...fields, logicalId: id });
    },
    async putInvitation(value) {
      const row = await invitation(value.id);
      if (!row) throw missing();
      if (
        row.workspaceId !== value.workspaceId ||
        row.tokenHash !== value.tokenHash ||
        row.invitedBy !== value.invitedBy ||
        row.recipientEmail !== value.recipientEmail ||
        row.createdAt !== value.createdAt ||
        row.expiresAt !== value.expiresAt ||
        row.role !== value.role
      )
        throw new MaxError("VALIDATION", "An invitation's original identity cannot change.");
      if (row.state !== "pending") {
        const sameTerminalState =
          (row.state === "accepted" && value.state === "accepted" && row.acceptedBy === value.acceptedBy && row.acceptedAt === value.acceptedAt) ||
          (row.state === "revoked" && value.state === "revoked" && row.revokedBy === value.revokedBy && row.revokedAt === value.revokedAt);
        if (!sameTerminalState) throw new MaxError("CONFLICT", "This invitation has already been consumed or revoked.");
        return;
      }
      const { id, ...fields } = value;
      await writer().replace(row._id, { ...fields, logicalId: id });
    },
    async appendAudit(value) {
      if (
        unique(
          await db
            .query("collabAudit")
            .withIndex("by_logicalId", (q) => q.eq("logicalId", value.id))
            .take(2),
        )
      )
        throw duplicate();
      const { id, ...fields } = value;
      await writer().insert("collabAudit", { ...fields, logicalId: id });
    },
  };
  return { transaction: async (body) => body(tx) };
}
