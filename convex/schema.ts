import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const nullableString = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());

export default defineSchema({
  notionConnections: defineTable({
    ownerId: v.string(),
    workspaceId: v.string(),
    workspaceName: v.string(),
    encryptedToken: v.string(),
    connectedAt: v.number(),
  }).index("by_owner", ["ownerId"]),
  notionStates: defineTable({ ownerId: v.string(), hash: v.string(), expiresAt: v.number(), consumed: v.optional(v.boolean()) })
    .index("by_hash", ["hash"])
    .index("by_owner", ["ownerId"]),
  notionJobs: defineTable({
    ownerId: v.string(),
    workspaceId: v.string(),
    key: v.string(),
    parentId: nullableString,
    includeDescendants: v.boolean(),
    status: v.string(),
    phase: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    created: v.number(),
    failed: v.number(),
    skipped: v.number(),
    attachments: v.number(),
    warnings: v.array(v.object({ sourceId: v.string(), message: v.string() })),
    error: nullableString,
    rootIds: v.array(v.string()),
    leaseUntil: v.number(),
    generation: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_key", ["ownerId", "key"]),
  notionItems: defineTable({
    ownerId: v.string(),
    jobId: v.id("notionJobs"),
    key: v.string(),
    sourceId: v.string(),
    kind: v.string(),
    parentSourceId: nullableString,
    parentId: nullableString,
    databaseId: nullableString,
    cursor: nullableString,
    depth: v.number(),
    status: v.string(),
    destinationId: nullableString,
    revision: v.number(),
    error: nullableString,
  })
    .index("by_owner", ["ownerId"])
    .index("by_job_status", ["jobId", "status"])
    .index("by_job_key", ["jobId", "key"])
    .index("by_job", ["jobId"]),
  // Max 2.0 authorization-only shadow model. No shared-content routes or writers
  // are enabled by this schema; legacy owner-scoped tables are unchanged.
  workspaces: defineTable({
    workspaceId: v.string(),
    ownerId: v.string(),
    status: v.union(v.literal("active"), v.literal("disabled")),
  }).index("by_workspaceId", ["workspaceId"]),
  workspaceMemberships: defineTable({
    workspaceId: v.string(),
    accountId: v.string(),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest")),
    status: v.union(v.literal("active"), v.literal("suspended"), v.literal("revoked")),
  }).index("by_workspace_account", ["workspaceId", "accountId"]).index("by_account", ["accountId"]),
  // Identity-bound invitations contain no bearer credentials. Acceptance verifies
  // the caller's authenticated subject, not an email or user-supplied role.
  workspaceInvitations: defineTable({
    workspaceId: v.string(),
    targetAccountId: v.string(),
    role: v.union(v.literal("admin"), v.literal("member"), v.literal("guest")),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired"), v.literal("declined")),
    createdByAccountId: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    resolvedAt: nullableNumber,
  })
    .index("by_workspace_target_status", ["workspaceId", "targetAccountId", "status"])
    .index("by_target_status", ["targetAccountId", "status"])
    .index("by_workspace", ["workspaceId"]),
  // Registry for shadow teamspaces ONLY, not for personal content or user-facing pages.
  workspaceTeamspaces: defineTable({
    workspaceId: v.string(),
    teamspaceId: v.string(),
    createdByAccountId: v.string(),
    createdAt: v.number(),
  }).index("by_workspace_teamspace", ["workspaceId", "teamspaceId"]),
  // Registered shadow workspace groups. Unknown group IDs cannot become ACL subjects.
  workspaceGroups: defineTable({
    workspaceId: v.string(), groupId: v.string(),
    createdByAccountId: v.string(), createdAt: v.number(),
  }).index("by_workspace_group", ["workspaceId", "groupId"]),
  workspaceGroupMemberships: defineTable({
    workspaceId: v.string(),
    accountId: v.string(),
    groupId: v.string(),
    status: v.union(v.literal("active"), v.literal("suspended"), v.literal("revoked")),
  }).index("by_workspace_account", ["workspaceId", "accountId"]),
  workspaceTeamspaceMemberships: defineTable({
    workspaceId: v.string(),
    accountId: v.string(),
    teamspaceId: v.string(),
    status: v.union(v.literal("active"), v.literal("suspended"), v.literal("revoked")),
  }).index("by_workspace_account", ["workspaceId", "accountId"]),
  workspacePageScopes: defineTable({
    workspaceId: v.string(),
    pageId: v.string(),
    parentId: nullableString,
    teamspaceId: nullableString,
  })
    .index("by_workspace_page", ["workspaceId", "pageId"])
    .index("by_pageId", ["pageId"]),
  workspacePageGrants: defineTable({
    workspaceId: v.string(),
    pageId: v.string(),
    subjectType: v.union(v.literal("account"), v.literal("group"), v.literal("workspace_role")),
    subjectId: v.string(),
    effect: v.union(v.literal("allow"), v.literal("deny")),
    level: v.union(v.literal("view"), v.literal("comment"), v.literal("edit_content"), v.literal("edit"), v.literal("full_access")),
  })
    .index("by_workspace_page", ["workspaceId", "pageId"])
    .index("by_workspace_subject", ["workspaceId", "subjectType", "subjectId"]),
  // Append-only audit for staged workspace security writers. No shared content.
  workspaceSecurityEvents: defineTable({
    workspaceId: v.string(),
    actorId: v.string(),
    operation: v.string(),
    targetId: v.string(),
    previous: nullableString,
    next: nullableString,
    at: v.number(),
  }).index("by_workspaceId", ["workspaceId"]),
  // PR32 shadow metadata only: no personal pages or content are shared.
  workspaceDatabaseBindings: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    kind: v.literal("database"),
    archivedAt: nullableNumber,
    createdAt: v.number(),
    createdBy: v.string(),
  })
    .index("by_workspace_database", ["workspaceId", "databaseId"])
    .index("by_databaseId", ["databaseId"]),
  workspaceRecordMetadata: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    pageId: v.string(),
    kind: v.literal("record"),
    archivedAt: nullableNumber,
    title: v.string(),
    updatedAt: v.number(),
  })
    .index("by_workspace_database", ["workspaceId", "databaseId"])
    .index("by_pageId", ["pageId"]),
  // PR33: separately gated semantics for registered shadow workspace records.
  // No personal document body, freeform properties, or embedded member directory.
  workspaceRecordSemantics: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    recordId: v.string(),
    kind: v.union(v.literal("task"), v.literal("project"), v.literal("wiki")),
    state: v.string(),
    assigneeId: nullableString,
    projectId: nullableString,
    dueAt: nullableNumber,
    archivedAt: nullableNumber,
    updatedAt: v.number(),
  })
    .index("by_recordId", ["recordId"])
    .index("by_workspace_database", ["workspaceId", "databaseId"]),
  // PR34: bounded task-only subtasks and dependencies, isolated from personal pages.
  workspaceTaskRelations: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    recordId: v.string(),
    parentTaskId: nullableString,
    dependsOn: v.array(v.string()),
    archivedAt: nullableNumber,
    updatedAt: v.number(),
  })
    .index("by_recordId", ["recordId"])
    .index("by_workspace_database", ["workspaceId", "databaseId"]),
  // PR36: shadow wiki ownership and expiring metadata-revision verification.
  workspaceWikiGovernance: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    recordId: v.string(),
    ownerId: v.string(),
    reviewerId: nullableString,
    verifiedAt: nullableNumber,
    verifiedSemanticUpdatedAt: nullableNumber,
    verifiedMetadataUpdatedAt: nullableNumber,
    expiresAt: v.number(),
    archivedAt: nullableNumber,
    updatedAt: v.number(),
  })
    .index("by_recordId", ["recordId"])
    .index("by_workspace_database", ["workspaceId", "databaseId"]),
  // PR37: identity-bound, expiring external-sharing PROPOSALS only.
  // No cross-tenant ACL, personal-document visibility or content routes.
  workspaceExternalShares: defineTable({
    originWorkspaceId: v.string(),
    scopeId: v.string(),
    targetWorkspaceId: nullableString,
    targetAccountId: v.string(),
    createdByAccountId: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"),
      v.literal("declined"), v.literal("revoked")),
    createdAt: v.number(),
    expiresAt: v.number(),
    resolvedAt: nullableNumber,
    updatedAt: v.number(),
  })
    .index("by_origin_scope", ["originWorkspaceId", "scopeId"])
    .index("by_target_account", ["targetAccountId"]),
  // PR38: independently gated, manager-only link policy registry. No bearer
  // tokens, public URLs, content gateway or legacy personal-page permissions.
  workspaceLinkPolicies: defineTable({
    originWorkspaceId: v.string(),
    scopeId: v.string(),
    issuedByAccountId: v.string(),
    audience: v.union(v.literal("workspace_members"), v.literal("anyone_with_link")),
    state: v.union(v.literal("active"), v.literal("revoked")),
    createdAt: v.number(),
    expiresAt: v.number(),
    updatedAt: v.number(),
    revokedAt: nullableNumber,
  })
    .index("by_origin_scope", ["originWorkspaceId", "scopeId"]),
  // PR40: dormant rule DESCRIPTORS for existing registered shadow databases.
  // All state is draft/paused/retired: no executor, scheduler, action delivery,
  // shared-document access, or MCP integration is enabled by this registry.
  workspaceAutomationRules: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    ruleKey: v.string(),
    createdByAccountId: v.string(),
    name: v.string(),
    trigger: v.union(v.literal("task_state_changed"), v.literal("manual_button")),
    condition: v.union(v.literal("always"), v.literal("state_equals")),
    conditionValue: nullableString,
    action: v.union(v.literal("notify_creator"), v.literal("set_task_state")),
    actionValue: nullableString,
    state: v.union(v.literal("draft"), v.literal("paused"), v.literal("retired")),
    createdAt: v.number(),
    updatedAt: v.number(),
    retiredAt: nullableNumber,
  })
    .index("by_workspace_database", ["workspaceId", "databaseId"])
    .index("by_database_rule_key", ["workspaceId", "databaseId", "ruleKey"]),
  // PR41: inert, manually recorded execution-intent journal. These rows are
  // NEVER consumed by background workers or allowed to mutate domain data.
  workspaceAutomationRunIntents: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    ruleKey: v.string(),
    runKey: v.string(),
    requestedByAccountId: v.string(),
    ruleUpdatedAt: v.number(),
    trigger: v.literal("manual_button"),
    depth: v.number(),
    attempt: v.number(),
    state: v.union(v.literal("recorded"), v.literal("canceled"), v.literal("dead_letter")),
    reason: v.union(v.literal("operator_cancelled"), v.literal("policy_blocked"),
      v.literal("retry_exhausted"), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
    terminalAt: nullableNumber,
  })
    .index("by_workspace_database", ["workspaceId", "databaseId"])
    .index("by_workspace_database_run_key", ["workspaceId", "databaseId", "runKey"]),
  // Append-only event rows written in the SAME Convex transaction as each
  // intent status change. Max two rows per intent in this safe foundation.
  workspaceAutomationRunEvents: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    runId: v.string(),
    sequence: v.number(),
    state: v.union(v.literal("recorded"), v.literal("canceled"), v.literal("dead_letter")),
    actorId: v.string(),
    at: v.number(),
  }).index("by_runId", ["runId"]),
  // PR42 shadow-only manual meeting drafts. These rows do not become pages,
  // calendar events, task actions, automation triggers or public content.
  workspaceMeetingNotes: defineTable({
    workspaceId: v.string(),
    databaseId: v.string(),
    meetingKey: v.string(),
    createdByAccountId: v.string(),
    title: v.string(),
    scheduledAt: v.number(),
    recurrence: v.union(v.literal("none"), v.literal("weekly"), v.literal("monthly")),
    meetingLink: nullableString,
    participants: v.array(v.string()),
    agenda: v.array(v.string()),
    decisions: v.array(v.string()),
    actions: v.array(v.object({
      text: v.string(),
      status: v.union(v.literal("open"), v.literal("done")),
      dueAt: nullableNumber,
    })),
    state: v.union(v.literal("draft"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
    archivedAt: nullableNumber,
  }).index("by_workspace_database", ["workspaceId", "databaseId"]),
  pages: defineTable({
    ownerId: v.string(),
    kind: v.union(v.literal("page"), v.literal("database")),
    parentId: nullableString,
    databaseId: nullableString,
    title: v.string(),
    icon: nullableString,
    cover: nullableString,
    coverPosition: v.optional(v.number()),
    rank: v.string(),
    favoriteRank: nullableString,
    archivedAt: nullableNumber,
    archivedRootId: nullableString,
    lastOpenedAt: nullableNumber,
    fullWidth: v.boolean(),
    smallText: v.boolean(),
    locked: v.boolean(),
    isTemplate: v.boolean(),
    teamspace: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
    properties: v.optional(v.any()),
    views: v.optional(v.any()),
    values: v.optional(v.any()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_parentId", ["ownerId", "parentId"])
    .index("by_owner_databaseId", ["ownerId", "databaseId"]),
  documents: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    content: v.string(),
    text: v.string(),
    revision: v.number(),
    schemaVersion: v.number(),
    wordCount: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"]),
  settings: defineTable(v.any()).index("by_owner", ["ownerId"]),
  assets: defineTable({
    ownerId: v.string(),
    pageId: nullableString,
    storageId: v.string(),
    name: v.string(),
    type: v.string(),
    size: v.number(),
    alt: v.string(),
    createdAt: v.number(),
    borrowed: v.optional(v.boolean()),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"]),
  tokens: defineTable({
    ownerId: v.string(),
    name: v.string(),
    hash: v.string(),
    prefix: v.string(),
    createdAt: v.number(),
    lastUsedAt: nullableNumber,
    revokedAt: nullableNumber,
  })
    .index("by_owner", ["ownerId"])
    .index("by_hash", ["hash"]),
  comments: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    blockId: v.union(v.string(), v.null()),
    body: v.string(),
    resolvedAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
    source: v.string(),
    authorId: v.optional(v.union(v.string(), v.null())),
    authorName: v.optional(v.union(v.string(), v.null())),
    authorImage: v.optional(v.union(v.string(), v.null())),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"]),
  shares: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    granteeId: v.string(),
    email: v.union(v.string(), v.null()),
    name: v.union(v.string(), v.null()),
    image: v.union(v.string(), v.null()),
    level: v.union(v.literal("view"), v.literal("comment"), v.literal("edit"), v.literal("full_access")),
    invitedBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"])
    .index("by_granteeId", ["granteeId"])
    .index("by_pageId", ["pageId"]),
  shareLinks: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    token: v.string(),
    level: v.union(v.literal("view"), v.literal("comment"), v.literal("edit")),
    public: v.optional(v.boolean()),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"])
    .index("by_token", ["token"])
    .index("by_pageId", ["pageId"]),
  sites: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    slug: v.string(),
    name: v.string(),
    icon: v.union(v.string(), v.null()),
    description: v.string(),
    search: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"])
    .index("by_slug", ["slug"])
    .index("by_pageId", ["pageId"]),
  presence: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    accountId: v.string(),
    name: v.string(),
    image: v.union(v.string(), v.null()),
    at: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"])
    .index("by_pageId", ["pageId"]),
  collabRooms: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    epoch: v.number(),
    seededRevision: v.union(v.number(), v.null()),
    seeding: v.union(v.string(), v.null()),
    seedingAt: v.number(),
    nextSeq: v.number(),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"])
    .index("by_pageId", ["pageId"]),
  collabUpdates: defineTable({
    ownerId: v.string(),
    roomId: v.string(),
    pageId: v.string(),
    epoch: v.number(),
    seq: v.number(),
    data: v.string(),
    at: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_roomId", ["roomId", "seq"]),
  collabAwareness: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    roomId: v.string(),
    clientId: v.string(),
    accountId: v.string(),
    data: v.string(),
    at: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"])
    .index("by_pageId", ["pageId"]),
  versions: defineTable({
    ownerId: v.string(),
    pageId: v.string(),
    revision: v.number(),
    title: v.string(),
    content: v.string(),
    wordCount: v.number(),
    at: v.number(),
    source: v.string(),
    reason: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"]),
  idempotency: defineTable({ ownerId: v.string(), key: v.string(), op: v.string(), result: v.string(), at: v.number() })
    .index("by_owner", ["ownerId"])
    .index("by_owner_key", ["ownerId", "key"]),
  audit: defineTable({
    ownerId: v.string(),
    op: v.string(),
    source: v.string(),
    targetId: nullableString,
    ok: v.boolean(),
    code: nullableString,
    at: v.number(),
  }).index("by_owner", ["ownerId"]),
});
