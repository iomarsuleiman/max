import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericQueryCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { canAccessWorkspacePageFromServer } from "../lib/domain/workspaceAccessGateway";
import { canEditSharedRecord, pageAuthorizedSharedRecords, type SharedDatabaseReadStore } from "../lib/domain/sharedDatabasePolicy";
import { validPrincipalId, validScopeId, validWorkspaceId } from "../lib/domain/workspaceManagementPolicy";

/** Gated shadow-metadata endpoints. No owner-only content, UI or MCP access. */
type ReadCtx = Pick<GenericQueryCtx<GenericDataModel>, "db" | "auth">;
const nullableCursor = v.union(v.string(), v.null());
const pageResult = v.object({
  records: v.array(v.object({ pageId: v.string(), title: v.string(), updatedAt: v.number() })),
  nextCursor: nullableCursor,
});
function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "Shared metadata operation denied." });
}
function canRead(): boolean {
  return process.env.MAX_V2_SHARED_DATABASE_READS_ENABLED === "true";
}
function canWrite(): void {
  if (process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true" ||
      process.env.MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED !== "true") denied();
}
async function who(ctx: ReadCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}

/** Same workspace permission engine and bounded queries as workspaceAccess.ts. */
function sharedStore(ctx: ReadCtx): SharedDatabaseReadStore {
  return {
    workspaces: (id) =>
      ctx.db.query("workspaces").withIndex("by_workspaceId", (q) => q.eq("workspaceId", id)).take(2),
    memberships: (id, account) =>
      ctx.db.query("workspaceMemberships").withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(2),
    groups: async (id, account) =>
      (await ctx.db.query("workspaceGroupMemberships").withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(101))
        .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.groupId, status: row.status })),
    teamspaces: async (id, account) =>
      (await ctx.db.query("workspaceTeamspaceMemberships").withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(101))
        .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.teamspaceId, status: row.status })),
    groupRegistrations: (id, groupId) =>
      ctx.db.query("workspaceGroups").withIndex("by_workspace_group", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("groupId", groupId)).take(2),
    teamspaceRegistrations: (id, teamspaceId) =>
      ctx.db.query("workspaceTeamspaces").withIndex("by_workspace_teamspace", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("teamspaceId", teamspaceId)).take(2),
    scopes: (id, pageId) =>
      ctx.db.query("workspacePageScopes").withIndex("by_workspace_page", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId)).take(2),
    grants: async (id, pageId) =>
      (await ctx.db.query("workspacePageGrants").withIndex("by_workspace_page", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId)).take(101))
        .map((row) => ({
          workspaceId: row.workspaceId, pageId: row.pageId, subjectType: row.subjectType,
          subjectId: row.subjectId, effect: row.effect, level: row.level,
        })),
    databaseBindings: async (id, databaseId) =>
      (await ctx.db.query("workspaceDatabaseBindings").withIndex("by_workspace_database", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("databaseId", databaseId)).take(2))
        .map((row) => ({
          workspaceId: row.workspaceId as string, pageId: row.databaseId as string,
          kind: row.kind as "database", archivedAt: row.archivedAt as number | null,
        })),
    recordCandidates: async (id, databaseId) =>
      (await ctx.db.query("workspaceRecordMetadata").withIndex("by_workspace_database", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("databaseId", databaseId)).take(101))
        .map((row) => ({
          workspaceId: row.workspaceId as string, databaseId: row.databaseId as string,
          pageId: row.pageId as string, kind: row.kind as "record",
          archivedAt: row.archivedAt as number | null, title: row.title as string,
          updatedAt: row.updatedAt as number,
        })),
  };
}

/** Validate global page identity and ancestry before registering metadata. */
async function exactScope(ctx: ReadCtx, workspaceId: string, pageId: string, parent?: string): Promise<void> {
  if (!validWorkspaceId(workspaceId) || !validScopeId(pageId)) denied();
  const global = await ctx.db.query("workspacePageScopes")
    .withIndex("by_pageId", (q) => q.eq("pageId", pageId)).take(2);
  if (global.length !== 1 || global[0].workspaceId !== workspaceId ||
      global[0].pageId !== pageId || (parent !== undefined && global[0].parentId !== parent)) denied();
}

/** Authorized database descriptor; no row totals, columns, or private metadata. */
export const readMetadata = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string() },
  returns: v.union(v.null(), v.object({ databaseId: v.string(), kind: v.literal("database") })),
  handler: async (ctx, a) => {
    if (!canRead() || !validWorkspaceId(a.workspaceId) || !validScopeId(a.databaseId)) return null;
    try {
      const actor = await who(ctx), store = sharedStore(ctx);
      const rows = await store.databaseBindings(a.workspaceId, a.databaseId);
      if (rows.length !== 1 || rows[0].workspaceId !== a.workspaceId ||
          rows[0].pageId !== a.databaseId || rows[0].kind !== "database" ||
          rows[0].archivedAt !== null ||
          !(await canAccessWorkspacePageFromServer(store, actor, a.workspaceId, a.databaseId, "view"))) return null;
      return { databaseId: a.databaseId, kind: "database" as const };
    } catch { return null; }
  },
});

/** Cursor is the currently authorized ID of the preceding visible record. */
export const listRecordMetadata = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(), limit: v.number(), after: nullableCursor },
  returns: pageResult,
  handler: async (ctx, a) => {
    const empty = { records: [], nextCursor: null };
    if (!canRead() || !validWorkspaceId(a.workspaceId) || !validScopeId(a.databaseId)) return empty;
    try {
      const actor = await who(ctx);
      const page = await pageAuthorizedSharedRecords(
        sharedStore(ctx), actor, a.workspaceId, a.databaseId, a.limit, a.after,
      );
      return { records: [...page.records], nextCursor: page.nextCursor };
    } catch { return empty; }
  },
});

/** Registers an existing shadow workspace scope, not a personal database. */
export const registerMetadataDatabase = mutationGeneric({
  args: { workspaceId: v.string(), databaseId: v.string() },
  returns: v.string(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx);
    await exactScope(ctx, a.workspaceId, a.databaseId);
    const store = sharedStore(ctx);
    if (!(await canAccessWorkspacePageFromServer(store, actor, a.workspaceId, a.databaseId, "manage"))) denied();
    const global = await ctx.db.query("workspaceDatabaseBindings")
      .withIndex("by_databaseId", (q) => q.eq("databaseId", a.databaseId)).take(2);
    if (global.length !== 0) denied();
    await ctx.db.insert("workspaceDatabaseBindings", {
      workspaceId: a.workspaceId, databaseId: a.databaseId, kind: "database",
      archivedAt: null, createdBy: actor, createdAt: Date.now(),
    });
    return a.databaseId;
  },
});

/** Metadata-only compare-and-set; authorization rechecked inside mutation. */
export const upsertRecordMetadata = mutationGeneric({
  args: {
    workspaceId: v.string(), databaseId: v.string(), recordId: v.string(),
    title: v.string(), expectedUpdatedAt: v.union(v.number(), v.null()),
  },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx);
    if (!validScopeId(a.recordId) || a.recordId === a.databaseId ||
        !a.title.trim() || a.title !== a.title.trim() || a.title.length > 512 ||
        /[\u0000-\u001F\u007F]/.test(a.title)) denied();
    await exactScope(ctx, a.workspaceId, a.databaseId);
    await exactScope(ctx, a.workspaceId, a.recordId, a.databaseId);
    if (!(await canEditSharedRecord(sharedStore(ctx), actor, a.workspaceId, a.databaseId, a.recordId))) denied();
    const global = await ctx.db.query("workspaceRecordMetadata")
      .withIndex("by_pageId", (q) => q.eq("pageId", a.recordId)).take(2);
    if (global.length > 1) denied();
    const current = global[0];
    if (current && (current.workspaceId !== a.workspaceId || current.databaseId !== a.databaseId ||
        current.kind !== "record" || current.archivedAt !== null ||
        current.updatedAt !== a.expectedUpdatedAt)) denied();
    if (!current && a.expectedUpdatedAt !== null) denied();
    if (!current) {
      const existing = await ctx.db.query("workspaceRecordMetadata").withIndex("by_workspace_database", (q) =>
        (q.eq("workspaceId", a.workspaceId) as unknown as { eq(field: string, value: string): never })
          .eq("databaseId", a.databaseId)).take(101);
      if (existing.length >= 100) denied();
    }
    const oldTimestamp = current?.updatedAt;
    const next = Math.max(Date.now(), typeof oldTimestamp === "number" ? oldTimestamp + 1 : 0);
    if (!Number.isSafeInteger(next)) denied();
    if (current) await ctx.db.patch(current._id as never, { title: a.title, updatedAt: next });
    else await ctx.db.insert("workspaceRecordMetadata", {
      workspaceId: a.workspaceId, databaseId: a.databaseId, pageId: a.recordId,
      kind: "record", archivedAt: null, title: a.title, updatedAt: next,
    });
    return next;
  },
});
