import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const nullableString = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());

export default defineSchema({
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
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_pageId", ["ownerId", "pageId"]),
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
