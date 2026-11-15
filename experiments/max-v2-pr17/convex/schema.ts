/**
 * PR17 ONLY: standalone Convex sandbox schema.
 * Not imported by Max's root convex/schema.ts or any deployed application.
 * Deploy only as a separate, disposable Convex project; never use real pages.
 */
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const status = v.union(v.literal("active"), v.literal("suspended"), v.literal("revoked"));
const role = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest"));
const nullable = v.union(v.string(), v.null());

export default defineSchema({
  workspaces: defineTable({
    workspaceId: v.string(), ownerId: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
  }).index("by_workspaceId", ["workspaceId"]),
  workspaceMemberships: defineTable({
    workspaceId: v.string(), accountId: v.string(), role, status,
  }).index("by_workspace_account", ["workspaceId", "accountId"]),
  workspaceGroups: defineTable({
    workspaceId: v.string(), groupId: v.string(),
  }).index("by_workspace_group", ["workspaceId", "groupId"]),
  workspaceTeamspaces: defineTable({
    workspaceId: v.string(), teamspaceId: v.string(),
  }).index("by_workspace_teamspace", ["workspaceId", "teamspaceId"]),
  workspaceGroupMemberships: defineTable({
    workspaceId: v.string(), accountId: v.string(), groupId: v.string(), status,
  }).index("by_workspace_account", ["workspaceId", "accountId"]),
  workspaceTeamspaceMemberships: defineTable({
    workspaceId: v.string(), accountId: v.string(), teamspaceId: v.string(), status,
  }).index("by_workspace_account", ["workspaceId", "accountId"]),
  workspacePageScopes: defineTable({
    workspaceId: v.string(), pageId: v.string(),
    parentId: nullable, teamspaceId: nullable,
  }).index("by_workspace_page", ["workspaceId", "pageId"]),
  workspacePageGrants: defineTable({
    workspaceId: v.string(), pageId: v.string(),
    subjectType: v.union(v.literal("account"), v.literal("group"), v.literal("workspace_role")),
    subjectId: v.string(), effect: v.union(v.literal("allow"), v.literal("deny")),
    level: v.union(v.literal("view"), v.literal("comment"), v.literal("edit_content"), v.literal("edit"), v.literal("full_access")),
  }).index("by_workspace_page", ["workspaceId", "pageId"]),
  labRooms: defineTable({
    workspaceId: v.string(), pageId: v.string(), provider: v.literal("blocknote-yjs"),
    nextSeq: v.number(), storedBytes: v.number(), checkpointThrough: v.optional(v.number()), createdBy: v.string(), createdAt: v.number(),
  }).index("by_scope", ["workspaceId", "pageId"]),
  // Lossless immutable packs, not Yjs semantic snapshots.
  labCheckpointSegments: defineTable({
    roomId: v.id("labRooms"), startSeq: v.number(), endSeq: v.number(),
    updates: v.array(v.object({ seq: v.number(), actorId: v.string(), operationId: v.string(),
      base64: v.string(), createdAt: v.number() })),
    bytes: v.number(), createdBy: v.string(), createdAt: v.number(),
  }).index("by_room_start", ["roomId", "startSeq"]),
  labSessions: defineTable({
    roomId: v.id("labRooms"), workspaceId: v.string(), pageId: v.string(),
    accountId: v.string(), issuedAt: v.number(), expiresAt: v.number(),
    revokedAt: v.union(v.number(), v.null()),
  }).index("by_workspace_account", ["workspaceId", "accountId"]),
  labUpdates: defineTable({
    roomId: v.id("labRooms"), seq: v.number(), actorId: v.string(),
    operationId: v.string(), base64: v.string(), createdAt: v.number(),
  }).index("by_room_seq", ["roomId", "seq"])
    .index("by_room_actor_operation", ["roomId", "actorId", "operationId"]),
  // PR24 sandbox only: short-lived awareness, not CRDT data or history.
  labPresence: defineTable({
    roomId: v.id("labRooms"), sessionId: v.id("labSessions"), accountId: v.string(),
    state: v.union(v.literal("viewing"), v.literal("editing")),
    blockId: nullable, anchor: v.union(v.number(), v.null()),
    head: v.union(v.number(), v.null()),
    updatedAt: v.number(), expiresAt: v.number(),
  }).index("by_room", ["roomId"]).index("by_session", ["sessionId"]),
  // PR26: durable ONLY in the disposable lab, never the production notes DB.
  // Anchors are stable BlockNote block IDs, not mutable text offsets.
  labCommentThreads: defineTable({
    roomId: v.id("labRooms"), blockId: v.string(),
    createdBy: v.string(), createdAt: v.number(), updatedAt: v.number(),
    resolvedAt: v.union(v.number(), v.null()), revision: v.number(),
  }).index("by_room", ["roomId"]),
  labThreadComments: defineTable({
    roomId: v.id("labRooms"), threadId: v.id("labCommentThreads"),
    authorId: v.string(), operationId: v.string(),
    kind: v.union(v.literal("initial"), v.literal("reply")),
    body: v.string(), mentions: v.array(v.string()), createdAt: v.number(),
  }).index("by_thread", ["threadId"])
    .index("by_room_actor_operation", ["roomId", "authorId", "operationId"]),

  // PR27: sandbox-only review proposals, separate from authoritative Yjs.
  labSuggestions: defineTable({
    roomId: v.id("labRooms"), blockId: v.string(), proposedBy: v.string(),
    operationId: v.string(), baseSeq: v.number(), originalText: v.string(),
    replacementText: v.string(), note: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("rejected")),
    revision: v.number(), reviewedBy: v.union(v.string(), v.null()),
    reviewedAt: v.union(v.number(), v.null()),
    reviewOperationId: v.union(v.string(), v.null()), createdAt: v.number(),
  }).index("by_room", ["roomId"])
    .index("by_room_actor_operation", ["roomId", "proposedBy", "operationId"]),
  // PR28: private, metadata-only sandbox inbox. Never copied to production.
  labNotifications: defineTable({
    roomId: v.id("labRooms"), recipientId: v.string(), actorId: v.string(),
    kind: v.union(v.literal("mention"), v.literal("thread_reply"),
      v.literal("suggestion_decision")),
    targetId: v.string(), createdAt: v.number(),
    readAt: v.union(v.number(), v.null()),
  }).index("by_room_recipient", ["roomId", "recipientId"]),
  labAuditEvents: defineTable({
    workspaceId: v.string(), actorId: v.string(), targetId: v.string(),
    operation: v.string(), at: v.number(),
  }).index("by_workspace", ["workspaceId"]),
});
