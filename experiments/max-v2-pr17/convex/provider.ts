/**
 * Max PR17 — isolated, server-authorized, durable *opaque-update* lab.
 *
 * Use ONLY in a dedicated Convex sandbox deployment with synthetic workspaces.
 * This file is NOT mounted in the app's root convex/ tree or production editor.
 * A session ID is an identifier, NOT a bearer credential: every operation
 * authenticates the current Clerk/Convex subject and rereads live ACLs.
 *
 * The server stores Yjs-format update bytes as opaque base64. It does not
 * currently validate CRDT content/schema or guarantee a provider wire adapter.
 * No snapshot overwrite, migration, untrusted replay or room-wide data export.
 */
import { mutationGeneric, queryGeneric, type DataModelFromSchemaDefinition, type GenericMutationCtx, type GenericQueryCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { canAccessWorkspacePageFromServer, type WorkspaceAuthorizationStore } from "../../../lib/domain/workspaceAccessGateway";
import { validPrincipalId, validScopeId, validWorkspaceId } from "../../../lib/domain/workspaceManagementPolicy";
import schema from "./schema";

type LabDataModel = DataModelFromSchemaDefinition<typeof schema>;
type SessionId = string & { __tableName: "labSessions" };
type Ctx = GenericQueryCtx<LabDataModel> | GenericMutationCtx<LabDataModel>;
const MAX_AGE_MS = 5 * 60_000;
const MAX_UPDATE_BASE64 = 21_848; // <= 16 KiB decoded
const MAX_ROOM_BYTES = 1024 * 1024;
const MAX_ROOM_UPDATES = 256;
const MAX_PACK_ENTRIES = 8;
const MAX_PACK_BYTES = 64 * 1024;
const MAX_SESSIONS_PER_ACCOUNT = 32;
const MIN_OP = /^[A-Za-z0-9_-]{8,96}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "Sandbox collaboration operation denied" });
}
function gate(): void {
  // Must be set on the separate sandbox deployment, never NEXT_PUBLIC_*.
  if (process.env.MAX_V2_PR17_PROVIDER_SANDBOX !== "true") denied();
}
async function principal(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}

/** Same fail-closed registered-group/teamspace/ancestor checks as the main app.
 * Adapters read only server tables, never a caller-provided permissions object. */
function aclStore(ctx: Ctx): WorkspaceAuthorizationStore {
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
    grants: (id, pageId) =>
      ctx.db.query("workspacePageGrants").withIndex("by_workspace_page", (q) =>
        (q.eq("workspaceId", id) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId)).take(101),
  } as WorkspaceAuthorizationStore;
}
async function authorized(ctx: Ctx, accountId: string, workspaceId: string, pageId: string,
  capability: "view" | "edit_content" | "manage"): Promise<boolean> {
  if (!validWorkspaceId(workspaceId) || !validScopeId(pageId)) return false;
  try {
    return await canAccessWorkspacePageFromServer(
      aclStore(ctx), accountId, workspaceId, pageId, capability,
    );
  } catch {
    return false;
  }
}
async function roomByScope(ctx: Ctx, workspaceId: string, pageId: string) {
  const rows = await ctx.db.query("labRooms").withIndex("by_scope", (q) =>
    (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId)).take(2);
  if (rows.length > 1 || (rows[0] && (rows[0].workspaceId !== workspaceId ||
      rows[0].pageId !== pageId || rows[0].provider !== "blocknote-yjs"))) denied();
  return rows[0] ?? null;
}

/** All session checks take place in the SAME Convex transaction as the data read
 * or write. A prior successful join is never an access capability. */
async function requireSession(ctx: Ctx, sessionId: SessionId, capability: "view" | "edit_content") {
  gate();
  const accountId = await principal(ctx);
  const session = await ctx.db.get(sessionId);
  const now = Date.now();
  if (!session || session.accountId !== accountId || session.revokedAt !== null ||
      !Number.isSafeInteger(session.issuedAt) || !Number.isSafeInteger(session.expiresAt) ||
      session.issuedAt > now || session.expiresAt <= now ||
      session.expiresAt <= session.issuedAt ||
      session.expiresAt - session.issuedAt > MAX_AGE_MS) denied();
  const room = await ctx.db.get(session.roomId);
  if (!room || session.workspaceId !== room.workspaceId ||
      session.pageId !== room.pageId || room.provider !== "blocknote-yjs") denied();
  if (!(await authorized(ctx, accountId, session.workspaceId, session.pageId, capability))) denied();
  return { accountId, session, room };
}

/** Joins an existing synthetic room; an editor may create a missing room.
 * Read-only members cannot create content or gain write permission by joining. */
export const join = mutationGeneric({
  args: { workspaceId: v.string(), pageId: v.string() },
  returns: v.object({ sessionId: v.id("labSessions"), expiresAt: v.number(), headSeq: v.number(), accountId: v.string(), canEdit: v.boolean() }),
  handler: async (ctx, { workspaceId, pageId }) => {
    gate();
    const accountId = await principal(ctx);
    if (!(await authorized(ctx, accountId, workspaceId, pageId, "view"))) denied();
    let room = await roomByScope(ctx, workspaceId, pageId);
    if (!room) {
      if (!(await authorized(ctx, accountId, workspaceId, pageId, "edit_content"))) denied();
      const roomId = await ctx.db.insert("labRooms", {
        workspaceId, pageId, provider: "blocknote-yjs", nextSeq: 0,
        storedBytes: 0, checkpointThrough: 0, createdBy: accountId, createdAt: Date.now(),
      });
      room = await ctx.db.get(roomId);
      if (!room) denied();
    }
    const oldSessions = await ctx.db.query("labSessions")
      .withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("accountId", accountId)).take(MAX_SESSIONS_PER_ACCOUNT + 1);
    if (oldSessions.length >= MAX_SESSIONS_PER_ACCOUNT) denied();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + MAX_AGE_MS;
    const sessionId = await ctx.db.insert("labSessions", {
      roomId: room._id, workspaceId, pageId, accountId, issuedAt,
      expiresAt, revokedAt: null,
    });
    return { sessionId, expiresAt, headSeq: room.nextSeq, accountId, canEdit: await authorized(ctx, accountId, workspaceId, pageId, "edit_content") };
  },
});


function decodedBytes(base64: string) {
  return Math.floor(base64.length * 3 / 4) -
    (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
}
/** Cross-check every archived record, watermark and ordering before trusting
 * checkpointed content. All packs retain ORIGINAL bytes and operation IDs. */
async function checkpointPacks(ctx: Ctx, room: { _id: string; nextSeq: number; checkpointThrough?: number }) {
  const watermark = room.checkpointThrough ?? 0;
  if (!Number.isSafeInteger(watermark) || watermark < 0 || watermark > room.nextSeq) denied();
  const packs = await ctx.db.query("labCheckpointSegments")
    .withIndex("by_room_start", q => q.eq("roomId", room._id as never)).take(257);
  if (packs.length > 256) denied();
  let expected = 1;
  for (const pack of packs) {
    if (pack.roomId !== room._id || pack.startSeq !== expected ||
        !Number.isSafeInteger(pack.endSeq) || pack.endSeq < expected ||
        pack.updates.length < 1 || pack.updates.length > MAX_PACK_ENTRIES) denied();
    let total = 0;
    for (const item of pack.updates) {
      if (item.seq !== expected++ || !MIN_OP.test(item.operationId) ||
          !validPrincipalId(item.actorId) || !BASE64.test(item.base64) ||
          item.base64.length > MAX_UPDATE_BASE64) denied();
      const n = decodedBytes(item.base64);
      if (n < 1 || n > 16_384) denied();
      total += n;
    }
    if (pack.endSeq !== expected - 1 || pack.bytes !== total || total > MAX_PACK_BYTES) denied();
  }
  if (expected - 1 !== watermark) denied();
  return packs;
}

/** A reactive Convex query is a server-authorized subscription source. Each
 * reexecution revalidates identity, room scope, lease and live read ACL. */
export const readUpdates = queryGeneric({
  args: { sessionId: v.id("labSessions"), afterSeq: v.number(), limit: v.optional(v.number()) },
  returns: v.object({
    headSeq: v.number(), hasMore: v.boolean(),
    updates: v.array(v.object({
      seq: v.number(), actorId: v.string(), operationId: v.string(),
      base64: v.string(),
    })),
  }),
  handler: async (ctx, { sessionId, afterSeq, limit }) => {
    const { room } = await requireSession(ctx, sessionId, "view");
    const count = limit ?? 32;
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || afterSeq > room.nextSeq ||
        !Number.isSafeInteger(count) || count < 1 || count > 64) denied();
    const watermark = room.checkpointThrough ?? 0;
    const result: Array<{ seq: number; actorId: string; operationId: string; base64: string }> = [];
    if (afterSeq < watermark) {
      for (const pack of await checkpointPacks(ctx, room)) for (const item of pack.updates) {
        if (item.seq > afterSeq && result.length < count + 1) result.push(item);
      }
    }
    if (result.length < count + 1) {
      const start = Math.max(afterSeq, watermark);
      const rows = await ctx.db.query("labUpdates")
        .withIndex("by_room_seq", q => (q.eq("roomId", room._id) as unknown as { gt(field: string, value: number): never }).gt("seq", start))
        .take(count + 1 - result.length);
      if (rows.some(row => row.roomId !== room._id || row.seq <= start)) denied();
      result.push(...rows);
    }
    const visible = result.slice(0, count);
    for (let i = 0; i < visible.length; i++)
      if (visible[i].seq !== afterSeq + i + 1) denied();
    const cursor = visible.at(-1)?.seq ?? afterSeq;
    if (cursor < room.nextSeq && !visible.length) denied();
    return {
      headSeq: room.nextSeq,
      hasMore: cursor < room.nextSeq,
      updates: visible.map(({ seq, actorId, operationId, base64 }) =>
        ({ seq, actorId, operationId, base64 })),
    };
  },
});

/** A reactive capability heartbeat. Authorization is recomputed inside the
 * query transaction; a 5-minute lease cannot override a changed page grant.
 * A permission downgrade updates the subscriber without waiting for a write
 * rejection. Expiry still requires the client's local deadline timer.
 */
export const sessionStatus = queryGeneric({
  args: { sessionId: v.id("labSessions") },
  returns: v.object({ accountId: v.string(), expiresAt: v.number(), canEdit: v.boolean() }),
  handler: async (ctx, { sessionId }) => {
    const { accountId, session } = await requireSession(ctx, sessionId, "view");
    return {
      accountId, expiresAt: session.expiresAt,
      canEdit: await authorized(ctx, accountId, session.workspaceId, session.pageId, "edit_content"),
    };
  },
});

/** Store one immutable opaque CRDT update; never overwrite a whole page.
 * Transactional idempotency protects retries; no client roles or author IDs. */
export const appendUpdate = mutationGeneric({
  args: {
    sessionId: v.id("labSessions"),
    operationId: v.string(), base64: v.string(),
  },
  returns: v.object({ seq: v.number(), duplicate: v.boolean() }),
  handler: async (ctx, { sessionId, operationId, base64 }) => {
    const { room, accountId } = await requireSession(ctx, sessionId, "edit_content");
    if (!MIN_OP.test(operationId) || base64.length === 0 ||
        base64.length > MAX_UPDATE_BASE64 || !BASE64.test(base64)) denied();
    const bytes = decodedBytes(base64);
    if (bytes < 1 || bytes > 16_384) denied();
    const duplicates = await ctx.db.query("labUpdates")
      .withIndex("by_room_actor_operation", (q) =>
        (q.eq("roomId", room._id) as unknown as { eq(field: string, value: string): { eq(field: string, value: string): never } }).eq("actorId", accountId).eq("operationId", operationId))
      .take(2);
    if (duplicates.length > 1) denied();
    const packed = (room.checkpointThrough ?? 0) > 0
      ? (await checkpointPacks(ctx, room)).flatMap(pack => pack.updates)
          .filter(item => item.actorId === accountId && item.operationId === operationId)
      : [];
    if (packed.length + duplicates.length > 1) denied();
    const existing = duplicates[0] ?? packed[0];
    if (existing) {
      if (existing.base64 !== base64) denied();
      return { seq: existing.seq, duplicate: true };
    }
    if (room.nextSeq >= MAX_ROOM_UPDATES || room.storedBytes + bytes > MAX_ROOM_BYTES) denied();
    const seq = room.nextSeq + 1;
    await ctx.db.insert("labUpdates", {
      roomId: room._id, seq, actorId: accountId, operationId, base64, createdAt: Date.now(),
    });
    await ctx.db.patch(room._id, { nextSeq: seq, storedBytes: room.storedBytes + bytes });
    return { seq, duplicate: false };
  },
});


/** Owner-only lossless repack. Original rows are deleted only in the same
 * Convex transaction that validates, inserts the pack and advances its cursor.
 * This is NOT Yjs merging; original byte and update quotas still apply. */
export const compactLog = mutationGeneric({
  args: { sessionId: v.id("labSessions") },
  returns: v.object({
    startSeq: v.number(), endSeq: v.number(), count: v.number(),
    headSeq: v.number(), complete: v.boolean(),
  }),
  handler: async (ctx, { sessionId }) => {
    const { accountId, session, room } = await requireSession(ctx, sessionId, "view");
    if (!(await authorized(ctx, accountId, session.workspaceId, session.pageId, "manage"))) denied();
    const owners = await ctx.db.query("workspaces")
      .withIndex("by_workspaceId", q => q.eq("workspaceId", session.workspaceId)).take(2);
    if (owners.length !== 1 || owners[0].ownerId !== accountId) denied();
    await checkpointPacks(ctx, room);
    const from = (room.checkpointThrough ?? 0) + 1;
    if (from > room.nextSeq) return { startSeq: from, endSeq: room.nextSeq,
      count: 0, headSeq: room.nextSeq, complete: true };
    const raw = await ctx.db.query("labUpdates")
      .withIndex("by_room_seq", q => (q.eq("roomId", room._id) as unknown as { gt(field: string, value: number): never }).gt("seq", from - 1))
      .take(MAX_PACK_ENTRIES);
    let bytes = 0;
    const chosen: typeof raw = [];
    for (const item of raw) {
      const size = decodedBytes(item.base64);
      if (item.roomId !== room._id || item.seq !== from + chosen.length ||
          !MIN_OP.test(item.operationId) || !validPrincipalId(item.actorId) ||
          !BASE64.test(item.base64) || size < 1 || size > 16_384) denied();
      if (bytes + size > MAX_PACK_BYTES) break;
      bytes += size;
      chosen.push(item);
    }
    if (!chosen.length) denied();
    const endSeq = chosen[chosen.length - 1].seq;
    await ctx.db.insert("labCheckpointSegments", {
      roomId: room._id, startSeq: from, endSeq,
      updates: chosen.map(({ seq, actorId, operationId, base64, createdAt }) =>
        ({ seq, actorId, operationId, base64, createdAt })),
      bytes, createdBy: accountId, createdAt: Date.now(),
    });
    for (const item of chosen) await ctx.db.delete(item._id);
    await ctx.db.patch(room._id, { checkpointThrough: endSeq });
    await ctx.db.insert("labAuditEvents", {
      workspaceId: room.workspaceId, actorId: accountId, targetId: room.pageId,
      operation: "room.lossless_pack_compacted", at: Date.now(),
    });
    return { startSeq: from, endSeq, count: chosen.length, headSeq: room.nextSeq,
      complete: endSeq === room.nextSeq };
  },
});

/** Self-disconnect disables a session at the server without deleting updates. */
export const leave = mutationGeneric({
  args: { sessionId: v.id("labSessions") },
  returns: v.boolean(),
  handler: async (ctx, { sessionId }) => {
    gate();
    const accountId = await principal(ctx);
    const session = await ctx.db.get(sessionId);
    if (!session || session.accountId !== accountId || session.revokedAt !== null) denied();
    await ctx.db.patch(sessionId, { revokedAt: Date.now() });
    return true;
  },
});

/** Sandbox-only owner revocation. Membership and outstanding session fences
 * are patched atomically. This never modifies real Max workspace membership. */
export const revokeMember = mutationGeneric({
  args: { workspaceId: v.string(), pageId: v.string(), targetAccountId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId, pageId, targetAccountId }) => {
    gate();
    const accountId = await principal(ctx);
    if (!validPrincipalId(targetAccountId) || targetAccountId === accountId ||
        !(await authorized(ctx, accountId, workspaceId, pageId, "manage"))) denied();
    const workspaces = await ctx.db.query("workspaces")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId)).take(2);
    if (workspaces.length !== 1 || workspaces[0].ownerId !== accountId) denied();
    const members = await ctx.db.query("workspaceMemberships")
      .withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("accountId", targetAccountId)).take(2);
    if (members.length !== 1 || members[0].role === "owner" ||
        members[0].status !== "active") denied();
    const leases = await ctx.db.query("labSessions")
      .withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("accountId", targetAccountId))
      .take(MAX_SESSIONS_PER_ACCOUNT + 1);
    if (leases.length > MAX_SESSIONS_PER_ACCOUNT) denied();
    await ctx.db.patch(members[0]._id, { status: "revoked" });
    for (const lease of leases) {
      if (lease.accountId !== targetAccountId || lease.workspaceId !== workspaceId) denied();
      if (lease.revokedAt === null) await ctx.db.patch(lease._id, { revokedAt: Date.now() });
    }
    await ctx.db.insert("labAuditEvents", {
      workspaceId, actorId: accountId, targetId: targetAccountId,
      operation: "member.revoked", at: Date.now(),
    });
    return true;
  },
});

/** Owner-only *synthetic* page-grant downgrade for exercising an active
 * subscription. Does not revoke view permission, modify a workspace role,
 * or touch the production app. Reject ambiguous grants or any other source
 * of edit permission; the transaction rolls back on rejection.
 */
export const downgradeMemberEdit = mutationGeneric({
  args: { workspaceId: v.string(), pageId: v.string(), targetAccountId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId, pageId, targetAccountId }) => {
    gate();
    const accountId = await principal(ctx);
    if (!validPrincipalId(targetAccountId) || targetAccountId === accountId ||
        !(await authorized(ctx, accountId, workspaceId, pageId, "manage"))) denied();
    const workspaces = await ctx.db.query("workspaces")
      .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId)).take(2);
    if (workspaces.length !== 1 || workspaces[0].ownerId !== accountId) denied();
    const memberships = await ctx.db.query("workspaceMemberships")
      .withIndex("by_workspace_account", (q) =>
        (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("accountId", targetAccountId)).take(2);
    if (memberships.length !== 1 || memberships[0].role === "owner" ||
        memberships[0].status !== "active") denied();
    const grants = await ctx.db.query("workspacePageGrants")
      .withIndex("by_workspace_page", (q) =>
        (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId)).take(101);
    const ownGrants = grants.filter(row => row.subjectType === "account" && row.subjectId === targetAccountId);
    if (ownGrants.length !== 1 || ownGrants[0].effect !== "allow" ||
        ownGrants[0].level !== "edit_content") denied();
    await ctx.db.patch(ownGrants[0]._id, { level: "view" });
    if (!(await authorized(ctx, targetAccountId, workspaceId, pageId, "view")) ||
        await authorized(ctx, targetAccountId, workspaceId, pageId, "edit_content")) denied();
    await ctx.db.insert("labAuditEvents", {
      workspaceId, actorId: accountId, targetId: targetAccountId,
      operation: "page.edit_downgraded", at: Date.now(),
    });
    return true;
  },
});
