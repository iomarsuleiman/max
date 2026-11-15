import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericQueryCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { canAccessWorkspacePageFromServer } from "../lib/domain/workspaceAccessGateway";
import { canEditSharedRecord, pageAuthorizedSharedRecords, type SharedDatabaseReadStore } from "../lib/domain/sharedDatabasePolicy";
import { validPrincipalId, validScopeId, validWorkspaceId } from "../lib/domain/workspaceManagementPolicy";
import { readAuthorizedRecordSemantics, validSemanticInput, type SemanticKind, type SharedSemanticStore } from "../lib/domain/workspaceRecordSemantics";
import { canLinkTask, readAuthorizedTaskRelations, validTaskRelationGraph, validTaskRelationInput, type TaskRelationRow, type TaskRelationStore } from "../lib/domain/workspaceTaskRelations";

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
    workspaces: (id: string) =>
      ctx.db.query("workspaces").withIndex("by_workspaceId", (q) => q.eq("workspaceId", id)).take(2),
    memberships: (id: string, account: string) =>
      ctx.db.query("workspaceMemberships").withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(2),
    groups: async (id: string, account: string) =>
      (await ctx.db.query("workspaceGroupMemberships").withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(101))
        .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.groupId, status: row.status })),
    teamspaces: async (id: string, account: string) =>
      (await ctx.db.query("workspaceTeamspaceMemberships").withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("accountId", account)).take(101))
        .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.teamspaceId, status: row.status })),
    groupRegistrations: (id: string, groupId: string) =>
      ctx.db.query("workspaceGroups").withIndex("by_workspace_group", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("groupId", groupId)).take(2),
    teamspaceRegistrations: (id: string, teamspaceId: string) =>
      ctx.db.query("workspaceTeamspaces").withIndex("by_workspace_teamspace", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("teamspaceId", teamspaceId)).take(2),
    scopes: (id: string, pageId: string) =>
      ctx.db.query("workspacePageScopes").withIndex("by_workspace_page", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId)).take(2),
    grants: async (id: string, pageId: string) =>
      (await ctx.db.query("workspacePageGrants").withIndex("by_workspace_page", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId)).take(101))
        .map((row) => ({
          workspaceId: row.workspaceId, pageId: row.pageId, subjectType: row.subjectType,
          subjectId: row.subjectId, effect: row.effect, level: row.level,
        })),
    databaseBindings: async (id: string, databaseId: string) =>
      (await ctx.db.query("workspaceDatabaseBindings").withIndex("by_workspace_database", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("databaseId", databaseId)).take(2))
        .map((row) => ({
          workspaceId: row.workspaceId as string, pageId: row.databaseId as string,
          kind: row.kind as "database", archivedAt: row.archivedAt as number | null,
        })),
    recordCandidates: async (id: string, databaseId: string) =>
      (await ctx.db.query("workspaceRecordMetadata").withIndex("by_workspace_database", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("databaseId", databaseId)).take(101))
        .map((row) => ({
          workspaceId: row.workspaceId as string, databaseId: row.databaseId as string,
          pageId: row.pageId as string, kind: row.kind as "record",
          archivedAt: row.archivedAt as number | null, title: row.title as string,
          updatedAt: row.updatedAt as number,
        })),
  } as unknown as SharedDatabaseReadStore;
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

/** PR33: in the same Convex query snapshot as the authorization gateway. */
function semanticStore(ctx: ReadCtx): SharedSemanticStore {
  return {
    ...sharedStore(ctx),
    recordMetadata: async (recordId: string) =>
      (await ctx.db.query("workspaceRecordMetadata")
        .withIndex("by_pageId", (q) => q.eq("pageId", recordId)).take(2))
        .map((row) => ({
          workspaceId: row.workspaceId as string, databaseId: row.databaseId as string,
          pageId: row.pageId as string, kind: row.kind as "record",
          archivedAt: row.archivedAt as number | null,
          title: row.title as string, updatedAt: row.updatedAt as number,
        })),
    semanticRows: async (recordId: string) =>
      (await ctx.db.query("workspaceRecordSemantics")
        .withIndex("by_recordId", (q) => q.eq("recordId", recordId)).take(2))
        .map((row) => ({
          workspaceId: row.workspaceId as string, databaseId: row.databaseId as string,
          recordId: row.recordId as string, kind: row.kind as SemanticKind,
          state: row.state as string,
          assigneeId: row.assigneeId as string | null,
          projectId: row.projectId as string | null,
          dueAt: row.dueAt as number | null,
          archivedAt: row.archivedAt as number | null,
          updatedAt: row.updatedAt as number,
        })),
  };
}

function semanticReadsEnabled(): boolean {
  return canRead() && process.env.MAX_V2_WORKSPACE_RECORD_SEMANTICS_READS_ENABLED === "true";
}
function semanticWritesEnabled(): void {
  canWrite();
  if (process.env.MAX_V2_WORKSPACE_RECORD_SEMANTICS_WRITES_ENABLED !== "true") denied();
}
const nullableString = v.union(v.string(), v.null());
const nullableNumber = v.union(v.number(), v.null());
const semanticKind = v.union(v.literal("task"), v.literal("project"), v.literal("wiki"));

/**
 * View access is reevaluated independently for the database, record and linked
 * project. Exposes no third-party assignee identity, record body or hidden IDs.
 */
export const readRecordSemantics = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(), recordId: v.string() },
  returns: v.union(v.null(), v.object({
    recordId: v.string(), kind: semanticKind, state: v.string(),
    dueAt: nullableNumber, assignedToMe: v.boolean(),
    projectId: nullableString, updatedAt: v.number(),
  })),
  handler: async (ctx, a) => {
    if (!semanticReadsEnabled()) return null;
    try {
      return await readAuthorizedRecordSemantics(
        semanticStore(ctx), await who(ctx), a.workspaceId, a.databaseId, a.recordId
      );
    } catch {
      return null;
    }
  },
});

/**
 * Metadata-only typed semantics for an EXISTING registered record.
 * No scope creation, shared content, public wiki publishing or account search.
 */
export const upsertRecordSemantics = mutationGeneric({
  args: {
    workspaceId: v.string(), databaseId: v.string(), recordId: v.string(),
    kind: semanticKind, state: v.string(), assigneeId: nullableString,
    projectId: nullableString, dueAt: nullableNumber,
    expectedUpdatedAt: nullableNumber,
  },
  returns: v.number(),
  handler: async (ctx, a) => {
    semanticWritesEnabled();
    const actor = await who(ctx);
    if (!validWorkspaceId(a.workspaceId) || !validScopeId(a.databaseId) ||
        !validSemanticInput(a, a.recordId) || a.databaseId === a.recordId) denied();

    // An existing unique shadow scope + registered metadata is mandatory.
    await exactScope(ctx, a.workspaceId, a.databaseId);
    await exactScope(ctx, a.workspaceId, a.recordId, a.databaseId);
    const metadata = await ctx.db.query("workspaceRecordMetadata")
      .withIndex("by_pageId", (q) => q.eq("pageId", a.recordId)).take(2);
    if (metadata.length !== 1 || metadata[0].workspaceId !== a.workspaceId ||
        metadata[0].databaseId !== a.databaseId || metadata[0].pageId !== a.recordId ||
        metadata[0].kind !== "record" || metadata[0].archivedAt !== null) denied();

    const store = semanticStore(ctx);
    if (!(await canEditSharedRecord(store, actor, a.workspaceId, a.databaseId, a.recordId))) denied();

    if (a.assigneeId !== null) {
      const members = await ctx.db.query("workspaceMemberships")
        .withIndex("by_workspace_account", (q) =>
          (q.eq("workspaceId", a.workspaceId) as unknown as { eq(field: string, value: string): never })
            .eq("accountId", a.assigneeId as string)).take(2);
      if (members.length !== 1 || members[0].workspaceId !== a.workspaceId ||
          members[0].accountId !== a.assigneeId || members[0].status !== "active") denied();
      // No assignment to an account that cannot actually view the task.
      if (!(await canAccessWorkspacePageFromServer(
        store, a.assigneeId, a.workspaceId, a.recordId, "view"
      ))) denied();
    }
    if (a.projectId !== null) {
      // Only a registered, readable, same-database PROJECT can be linked.
      await exactScope(ctx, a.workspaceId, a.projectId, a.databaseId);
      const [projectMetadata, projectRows] = await Promise.all([
        store.recordMetadata(a.projectId), store.semanticRows(a.projectId),
      ]);
      if (projectMetadata.length !== 1 || projectMetadata[0].workspaceId !== a.workspaceId ||
          projectMetadata[0].databaseId !== a.databaseId ||
          projectMetadata[0].pageId !== a.projectId ||
          projectMetadata[0].kind !== "record" || projectMetadata[0].archivedAt !== null ||
          projectRows.length !== 1 || projectRows[0].workspaceId !== a.workspaceId ||
          projectRows[0].databaseId !== a.databaseId || projectRows[0].recordId !== a.projectId ||
          projectRows[0].kind !== "project" || projectRows[0].archivedAt !== null ||
          !validSemanticInput(projectRows[0], a.projectId)) denied();
      if (!(await canAccessWorkspacePageFromServer(
        store, actor, a.workspaceId, a.projectId, "view"
      ))) denied();
    }

    const existing = await ctx.db.query("workspaceRecordSemantics")
      .withIndex("by_recordId", (q) => q.eq("recordId", a.recordId)).take(2);
    if (existing.length > 1) denied();
    const prior = existing[0];
    if (prior && (prior.workspaceId !== a.workspaceId ||
        prior.databaseId !== a.databaseId || prior.recordId !== a.recordId ||
        prior.kind !== a.kind || prior.archivedAt !== null ||
        !validSemanticInput(prior, a.recordId) ||
        prior.updatedAt !== a.expectedUpdatedAt)) denied();
    if (!prior && a.expectedUpdatedAt !== null) denied();
    const updatedAt = Math.max(Date.now(), prior ? prior.updatedAt + 1 : 0);
    if (!Number.isSafeInteger(updatedAt)) denied();
    const patch = {
      kind: a.kind, state: a.state, assigneeId: a.assigneeId,
      projectId: a.projectId, dueAt: a.dueAt, updatedAt,
    };
    if (prior) await ctx.db.patch(prior._id as never, patch);
    else await ctx.db.insert("workspaceRecordSemantics", {
      workspaceId: a.workspaceId, databaseId: a.databaseId, recordId: a.recordId,
      archivedAt: null, ...patch,
    });
    return updatedAt;
  },
});

/** PR34: isolated relation adapter. All reads and writes use one Convex snapshot. */
function taskRelationStore(ctx: ReadCtx): TaskRelationStore {
  return {
    ...semanticStore(ctx),
    taskRelations: async (recordId: string) =>
      (await ctx.db.query("workspaceTaskRelations")
        .withIndex("by_recordId", (q) => q.eq("recordId", recordId)).take(2))
        .map((row) => ({
          workspaceId: row.workspaceId as string, databaseId: row.databaseId as string,
          recordId: row.recordId as string, parentTaskId: row.parentTaskId as string | null,
          dependsOn: row.dependsOn as string[], archivedAt: row.archivedAt as number | null,
          updatedAt: row.updatedAt as number,
        })),
  };
}
function taskRelationReadsEnabled(): boolean {
  return semanticReadsEnabled() && process.env.MAX_V2_TASK_RELATIONS_READS_ENABLED === "true";
}
function taskRelationWritesEnabled(): void {
  semanticWritesEnabled();
  if (process.env.MAX_V2_TASK_RELATIONS_WRITES_ENABLED !== "true") denied();
}

/** Only currently visible task targets are returned; no hidden IDs or totals. */
export const readTaskRelations = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(), recordId: v.string() },
  returns: v.union(v.null(), v.object({
    recordId: v.string(), parentTaskId: nullableString,
    dependsOn: v.array(v.string()), updatedAt: v.number(),
  })),
  handler: async (ctx, a) => {
    if (!taskRelationReadsEnabled()) return null;
    try {
      return await readAuthorizedTaskRelations(
        taskRelationStore(ctx), await who(ctx), a.workspaceId, a.databaseId, a.recordId
      );
    } catch { return null; }
  },
});

/**
 * CAS replacement of one task's parent/dependency metadata.
 * Every proposed target must be an existing registered visible task in the
 * same workspace/database. A bounded transaction snapshot rejects graph cycles.
 */
export const upsertTaskRelations = mutationGeneric({
  args: {
    workspaceId: v.string(), databaseId: v.string(), recordId: v.string(),
    parentTaskId: nullableString, dependsOn: v.array(v.string()),
    expectedUpdatedAt: nullableNumber,
  },
  returns: v.number(),
  handler: async (ctx, a) => {
    taskRelationWritesEnabled();
    const actor = await who(ctx);
    if (!validWorkspaceId(a.workspaceId) || !validScopeId(a.databaseId) ||
        a.recordId === a.databaseId || !validTaskRelationInput(a, a.recordId)) denied();
    await exactScope(ctx, a.workspaceId, a.databaseId);
    await exactScope(ctx, a.workspaceId, a.recordId, a.databaseId);
    const store = taskRelationStore(ctx);
    if (!(await canEditSharedRecord(store, actor, a.workspaceId, a.databaseId, a.recordId)) ||
        !(await canLinkTask(store, actor, a.workspaceId, a.databaseId, a.recordId))) denied();

    const targets = [...(a.parentTaskId === null ? [] : [a.parentTaskId]), ...a.dependsOn];
    for (const target of targets) {
      await exactScope(ctx, a.workspaceId, target, a.databaseId);
      if (!(await canLinkTask(store, actor, a.workspaceId, a.databaseId, target))) denied();
    }

    const oldRows = await ctx.db.query("workspaceTaskRelations")
      .withIndex("by_recordId", (q) => q.eq("recordId", a.recordId)).take(2);
    if (oldRows.length > 1) denied();
    const prior = oldRows[0];
    if (prior && (prior.workspaceId !== a.workspaceId ||
        prior.databaseId !== a.databaseId || prior.recordId !== a.recordId ||
        prior.archivedAt !== null || !validTaskRelationInput(prior, a.recordId) ||
        prior.updatedAt !== a.expectedUpdatedAt)) denied();
    if (!prior && a.expectedUpdatedAt !== null) denied();

    const all = await ctx.db.query("workspaceTaskRelations")
      .withIndex("by_workspace_database", (q) =>
        (q.eq("workspaceId", a.workspaceId) as unknown as { eq(field: string, value: string): never })
          .eq("databaseId", a.databaseId)).take(101);
    const currentUpdatedAt = Math.max(Date.now(), prior ? prior.updatedAt + 1 : 0);
    if (!Number.isSafeInteger(currentUpdatedAt)) denied();
    const proposed: TaskRelationRow = {
      workspaceId: a.workspaceId, databaseId: a.databaseId, recordId: a.recordId,
      parentTaskId: a.parentTaskId, dependsOn: [...a.dependsOn],
      archivedAt: null, updatedAt: currentUpdatedAt,
    };
    if (!validTaskRelationGraph(
      all.map((row) => ({
        workspaceId: row.workspaceId as string, databaseId: row.databaseId as string,
        recordId: row.recordId as string, parentTaskId: row.parentTaskId as string | null,
        dependsOn: row.dependsOn as string[], archivedAt: row.archivedAt as number | null,
        updatedAt: row.updatedAt as number,
      })), proposed, a.workspaceId, a.databaseId
    )) denied();
    if (prior) {
      await ctx.db.patch(prior._id as never, {
        parentTaskId: a.parentTaskId, dependsOn: [...a.dependsOn], updatedAt: currentUpdatedAt,
      });
    } else {
      await ctx.db.insert("workspaceTaskRelations", proposed);
    }
    return currentUpdatedAt;
  },
});
