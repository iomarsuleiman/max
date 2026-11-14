import { defineTable } from "convex/server";
import { v } from "convex/values";
import { COLLABORATION_AUDIT_TYPES } from "../lib/domain/collaboration/collaborationStore";
import { PAGE_GRANTS } from "../lib/domain/collaboration/policy";

const state = v.union(v.literal("active"), v.literal("archived"));
const memberState = v.union(v.literal("active"), v.literal("revoked"));
const role = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest"));
const invitationRole = v.union(v.literal("admin"), v.literal("member"), v.literal("guest"));
const grant = v.union(...PAGE_GRANTS.map((value) => v.literal(value)));
const principal = v.union(
  v.object({ kind: v.literal("user"), userId: v.string() }),
  v.object({ kind: v.literal("group"), groupId: v.string() }),
  v.object({ kind: v.literal("workspace_members") }),
);
const accessGrant = v.union(
  v.object({ principal, effect: v.literal("allow"), grant, expiresAt: v.union(v.number(), v.null()) }),
  v.object({ principal, effect: v.literal("deny") }),
);
const workspace = { logicalId: v.string(), name: v.string(), state, createdAt: v.number(), updatedAt: v.number() };
const invitation = {
  logicalId: v.string(),
  workspaceId: v.string(),
  invitedBy: v.string(),
  recipientEmail: v.string(),
  role: invitationRole,
  tokenHash: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
};

/** Additive metadata only. Logical IDs are portable identifiers, not Convex _ids. */
export const collaborationTables = {
  collabPageAccess: defineTable({
    pageId: v.id("pages"),
    workspaceId: v.string(),
    mode: v.union(v.literal("inherit"), v.literal("replace")),
    aclRevision: v.number(),
    grantCount: v.number(),
    updatedAt: v.number(),
    updatedBy: v.string(),
  })
    .index("by_pageId", ["pageId"])
    .index("by_workspaceId_pageId", ["workspaceId", "pageId"]),
  collabPageGrants: defineTable({
    logicalId: v.string(),
    workspaceId: v.string(),
    pageId: v.id("pages"),
    aclRevision: v.number(),
    principalKey: v.string(),
    value: accessGrant,
  })
    .index("by_logicalId", ["logicalId"])
    .index("by_pageId_aclRevision", ["pageId", "aclRevision"])
    .index("by_workspaceId_principalKey_effect_pageId", ["workspaceId", "principalKey", "value.effect", "pageId"]),
  collabWorkspaces: defineTable(
    v.union(v.object({ ...workspace, kind: v.literal("personal"), ownerId: v.string() }), v.object({ ...workspace, kind: v.literal("organization") })),
  )
    .index("by_logicalId", ["logicalId"])
    .index("by_kind_ownerId", ["kind", "ownerId"]),
  collabMemberships: defineTable({ workspaceId: v.string(), userId: v.string(), role, state: memberState, joinedAt: v.number(), updatedAt: v.number() })
    .index("by_workspaceId_userId", ["workspaceId", "userId"])
    .index("by_userId_workspaceId", ["userId", "workspaceId"]),
  collabGroups: defineTable({ logicalId: v.string(), workspaceId: v.string(), name: v.string(), state, createdAt: v.number(), updatedAt: v.number() })
    .index("by_logicalId", ["logicalId"])
    .index("by_workspaceId_state", ["workspaceId", "state"]),
  collabGroupMemberships: defineTable({
    workspaceId: v.string(),
    groupId: v.string(),
    userId: v.string(),
    state: memberState,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workspaceId_groupId_userId", ["workspaceId", "groupId", "userId"])
    .index("by_workspaceId_userId_state", ["workspaceId", "userId", "state"]),
  collabTeamspaces: defineTable({
    logicalId: v.string(),
    workspaceId: v.string(),
    name: v.string(),
    state,
    visibility: v.union(v.literal("open"), v.literal("closed"), v.literal("private")),
    defaultGrant: grant,
    memberUserIds: v.array(v.string()),
    memberGroupIds: v.array(v.string()),
    managerUserIds: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_logicalId", ["logicalId"])
    .index("by_workspaceId_state", ["workspaceId", "state"]),
  collabInvitations: defineTable(
    v.union(
      v.object({ ...invitation, state: v.literal("pending") }),
      v.object({ ...invitation, state: v.literal("accepted"), acceptedBy: v.string(), acceptedAt: v.number() }),
      v.object({ ...invitation, state: v.literal("revoked"), revokedBy: v.string(), revokedAt: v.number() }),
    ),
  )
    .index("by_logicalId", ["logicalId"])
    .index("by_tokenHash", ["tokenHash"])
    .index("by_workspaceId_state_expiresAt", ["workspaceId", "state", "expiresAt"]),
  collabAudit: defineTable({
    logicalId: v.string(),
    workspaceId: v.string(),
    actorId: v.string(),
    type: v.union(...COLLABORATION_AUDIT_TYPES.map((value) => v.literal(value))),
    targetId: v.string(),
    at: v.number(),
    detail: v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
  })
    .index("by_logicalId", ["logicalId"])
    .index("by_workspaceId_at", ["workspaceId", "at"]),
};
