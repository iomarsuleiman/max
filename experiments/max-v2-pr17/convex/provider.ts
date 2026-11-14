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
import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx, type GenericQueryCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { canAccessWorkspacePageFromServer, type WorkspaceAuthorizationStore } from "../../../lib/domain/workspaceAccessGateway";
import { validPrincipalId, validScopeId, validWorkspaceId } from "../../../lib/domain/workspaceManagementPolicy";

type Ctx = GenericQueryCtx<GenericDataModel> | GenericMutationCtx<GenericDataModel>;
type MutationCtx = GenericMutationCtx<GenericDataModel>;
const MAX_AGE_MS = 5 * 60_000;
const MAX_UPDATE_BASE64 = 21_848; // <= 16 KiB decoded
const MAX_ROOM_BYTES = 1024 * 1024;
const MAX_ROOM_UPDATES = 256;
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
        q.eq("workspaceId", id).eq("accountId", account)).take(2),
    groups: async (id, account) =>
      (await ctx.db.query("workspaceGroupMemberships").withIndex("by_workspace_account", (q) =>
        q.eq("workspaceId", id).eq("accountId", account)).take(101))
        .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.groupId, status: row.status })),
    teamspaces: async (id, account) =>
      (await ctx.db.query("workspaceTeamspaceMemberships").withIndex("by_workspace_account", (q) =>
        q.eq("workspaceId", id).eq("accountId", account)).take(101))
        .map((row) => ({ workspaceId: row.workspaceId, accountId: row.accountId, id: row.teamspaceId, status: row.status })),
    groupRegistrations: (id, groupId) =>
      ctx.db.query("workspaceGroups").withIndex("by_workspace_group", (q) =>
        q.eq("workspaceId", id).eq("groupId", groupId)).take(2),
    teamspaceRegistrations: (id, teamspaceId) =>
      ctx.db.query("workspaceTeamspaces").withIndex("by_workspace_teamspace", (q) =>
        q.eq("workspaceId", id).eq("teamspaceId", teamspaceId)).take(2),
    scopes: (id, pageId) =>
      ctx.db.query("workspacePageScopes").withIndex("by_workspace_page", (q) =>
        q.eq("workspaceId", id).eq("pageId", pageId)).take(2),
    grants: (id, pageId) =>
      ctx.db.query("workspacePageGrants").withIndex("by_workspace_page", (q) =>
        q.eq("workspaceId", id).eq("pageId", pageId)).take(101),
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
    q.eq("workspaceId", workspaceId).eq("pageId", pageId)).take(2);
  if (rows.length > 1 || (rows[0] && (rows[0].workspaceId !== workspaceId ||
      rows[0].pageId !== pageId || rows[0].provider !== "blocknote-yjs"))) denied();
  return rows[0] ?? null;
}

/** All session checks take place in the SAME Convex transaction as the data read
 * or write. A prior successful join is never an access capability. */
async function requireSession(ctx: Ctx, sessionId: string, capability: "view" | "edit_content") {
  gate();
  const accountId = await principal(ctx);
  const session = await ctx.db.get(sessionId as never);
  const now = Date.now();
  if (!session || session.accountId !== accountId || session.revokedAt !== null ||
      !Number.isSafeInteger(session.issuedAt) || !Number.isSafeInteger(session.expiresAt) ||
      session.issuedAt > now || session.expiresAt <= now ||
      session.expiresAt <= session.issuedAt ||
      session.expiresAt - session.issuedAt > MAX_AGE_MS) denied();
  const room = await ctx.db.get(session.roomId as never);
  if (!room || session.workspaceId !== room.workspaceId ||
      session.pageId !== room.pageId || room.provider !== "blocknote-yjs") denied();
  if (!(await authorized(ctx, accountId, session.workspaceId, session.pageId, capability))) denied();
  return { accountId, session, room };
}

/** Joins an existing synthetic room; an editor may create a missing room.
 * Read-only members cannot create content or gain write permission by joining. */
export const join = mutationGeneric({
  args: { workspaceId: v.string(), pageId: v.string() },
  returns: v.object({ sessionId: v.id("labSessions"), expiresAt: v.number(), headSeq: v.number() }),
  handler: async (ctx, { workspaceId, pageId }) => {
    gate();
    const accountId = await principal(ctx);
    if (!(await authorized(ctx, accountId, workspaceId, pageId, "view"))) denied();
    let room = await roomByScope(ctx, workspaceId, pageId);
    if (!room) {
      if (!(await authorized(ctx, accountId, workspaceId, pageId, "edit_content"))) denied();
      const roomId = await ctx.db.insert("labRooms", {
        workspaceId, pageId, provider: "blocknote-yjs", nextSeq: 0,
        storedBytes: 0, createdBy: accountId, createdAt: Date.now(),
      });
      room = await ctx.db.get(roomId);
      if (!room) denied();
    }
    const oldSessions = await ctx.db.query("labSessions")
      .withIndex("by_workspace_account", (q) =>
        q.eq("workspaceId", workspaceId).eq("accountId", accountId)).take(MAX_SESSIONS_PER_ACCOUNT + 1);
    if (oldSessions.length >= MAX_SESSIONS_PER_ACCOUNT) denied();
    const issuedAt = Date.now();
    const expiresAt = issuedAt + MAX_AGE_MS;
    const sessionId = await ctx.db.insert("labSessions", {
      roomId: room._id, workspaceId, pageId, accountId, issuedAt,
      expiresAt, revokedAt: null,
    });
    return { sessionId, expiresAt, headSeq: room.nextSeq };
  },
});

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
    const rows = await ctx.db.query("labUpdates")
      .withIndex("by_room_seq", (q) => q.eq("roomId", room._id).gt("seq", afterSeq))
      .take(count + 1);
    if (rows.some((row) => row.roomId !== room._id || row.seq <= afterSeq)) denied();
    return {
      headSeq: room.nextSeq,
      hasMore: rows.length > count,
      updates: rows.slice(0, count).map((row) => ({
        seq: row.seq, actorId: row.actorId,
        operationId: row.operationId, base64: row.base64,
      })),
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
    const bytes = Math.floor(base64.length * 3 / 4) - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
    if (bytes < 1 || bytes > 16_384) denied();
    const duplicates = await ctx.db.query("labUpdates")
      .withIndex("by_room_actor_operation", (q) =>
        q.eq("roomId", room._id).eq("actorId", accountId).eq("operationId", operationId))
      .take(2);
    if (duplicates.length > 1) denied();
    if (duplicates.length === 1) {
      if (duplicates[0].base64 !== base64) denied();
      return { seq: duplicates[0].seq, duplicate: true };
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
        q.eq("workspaceId", workspaceId).eq("accountId", targetAccountId)).take(2);
    if (members.length !== 1 || members[0].role === "owner" ||
        members[0].status !== "active") denied();
    const leases = await ctx.db.query("labSessions")
      .withIndex("by_workspace_account", (q) =>
        q.eq("workspaceId", workspaceId).eq("accountId", targetAccountId))
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
