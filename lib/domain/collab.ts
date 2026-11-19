import { MaxError, notFound } from "./errors";
import type { Db, Storage } from "./db";
import { normalizeBlocks } from "./blocks";
import { ANONYMOUS, atLeast, resolveAccess, type Actor } from "./sharing";
import { clearRoom, findRoom } from "./collabRoom";
import { writeContent } from "./ops/documents";
import type { CollabRoomRow, ShareLevel } from "./types";

/**
 * Live co-editing. Everyone with a shared page open joins its room: an append-only, ordered
 * stream of Yjs updates (opaque base64 to the server) that each editor applies to its own copy.
 *
 *  - The first editor to join seeds the room from the saved page and records which revision it
 *    seeded from. Until then, others wait (a stale seeder is replaced after SEED_TIMEOUT_MS).
 *  - Editors save the merged result to the page every second or so (`commit`), which also folds
 *    the stream into one snapshot so it never grows without bound.
 *  - Any other write to the page (an assistant, a restore) clears the room and bumps its epoch:
 *    clients reload the saved page instead of overwriting the change.
 *  - Cursors are Yjs awareness states, one row per open editor.
 */

export const SEED_TIMEOUT_MS = 10_000;
export const AWARENESS_TTL_MS = 60_000;
const MAX_UPDATE_CHARS = 700_000;
const PULL_LIMIT = 200;

interface RoomCaller {
  db: Db;
  actor: Actor;
  now: number;
  linkToken?: string | null;
}

async function access(c: RoomCaller, pageId: string, min: ShareLevel) {
  if (c.actor.id === ANONYMOUS) throw new MaxError("UNAUTHENTICATED", "Sign in to edit together.");
  let a;
  try {
    a = await resolveAccess(c.db, c.actor.id, pageId, c.linkToken);
  } catch {
    throw notFound();
  }
  if (a.page.kind === "database") throw new MaxError("VALIDATION", "Databases don't have a live room.");
  if (!atLeast(a.level, min)) throw new MaxError("FORBIDDEN", min === "view" ? "This page isn't shared with you." : "You need “Can edit” access to change this page.");
  const writable = (a.level === "owner" || atLeast(a.level, "edit")) && !a.page.locked && !a.page.archivedAt;
  return { ...a, writable };
}

async function roomFor(c: RoomCaller, roomId: string, min: ShareLevel, epoch: number) {
  const room = await c.db.get("collabRooms", roomId);
  if (!room) throw notFound("room");
  const a = await access(c, room.pageId, min);
  if (room.ownerId !== a.ownerId) throw notFound("room");
  if (min !== "view" && !a.writable) throw new MaxError("READ_ONLY", "This page can't be edited right now.");
  if (room.epoch !== epoch) throw new MaxError("CONFLICT", "This page was changed somewhere else. Reloading it.", { epoch: room.epoch });
  return { room, access: a };
}

async function revisionOf(db: Db, ownerId: string, pageId: string) {
  return (await db.list("documents", ownerId, { field: "pageId", value: pageId }))[0]?.revision ?? 0;
}

/**
 * Opens the room for a page. `seed` tells this client to load the saved page into the room;
 * `ready` false (and no seed) means someone else is seeding it: ask again shortly.
 */
export async function joinRoom(c: RoomCaller, pageId: string, clientId: string) {
  const a = await access(c, pageId, "view");
  const revision = await revisionOf(c.db, a.ownerId, pageId);
  let room: CollabRoomRow | null = await findRoom(c.db, a.ownerId, pageId);
  if (!room) {
    const row = { ownerId: a.ownerId, pageId, epoch: 1, seededRevision: null, seeding: null, seedingAt: 0, nextSeq: 1, createdAt: c.now };
    room = { ...row, _id: await c.db.insert("collabRooms", row) };
  } else if (room.seededRevision !== null && room.seededRevision !== revision) {
    // The page was saved by something outside the room that didn't clear it (e.g. an import).
    await clearRoom(c.db, room);
    room = (await c.db.get("collabRooms", room._id))!;
  }
  let seed = false;
  if (room.seededRevision === null && a.writable && (!room.seeding || room.seeding === clientId || c.now - room.seedingAt > SEED_TIMEOUT_MS)) {
    await c.db.patch("collabRooms", room._id, { seeding: clientId, seedingAt: c.now });
    seed = true;
  }
  return { roomId: room._id, epoch: room.epoch, ready: room.seededRevision !== null, seed, revision, canEdit: a.writable };
}

/** Updates after `afterSeq`, plus everyone's cursors. `epoch` changing means: reload. */
export async function pullRoom(c: RoomCaller, roomId: string, afterSeq: number) {
  const room = await c.db.get("collabRooms", roomId);
  if (!room) throw notFound("room");
  const a = await access(c, room.pageId, "view");
  if (room.ownerId !== a.ownerId) throw notFound("room");
  const updates = room.seededRevision === null ? [] : await c.db.updatesAfter(roomId, afterSeq, PULL_LIMIT);
  const cursors = (await c.db.list("collabAwareness", room.ownerId, { field: "pageId", value: room.pageId })).filter((r) => r.roomId === roomId);
  return {
    epoch: room.epoch,
    ready: room.seededRevision !== null,
    head: room.nextSeq - 1,
    updates: updates.map((u) => ({ seq: u.seq, data: u.data })),
    awareness: cursors.map((r) => ({ clientId: r.clientId, data: r.data, at: r.at })),
  };
}

/** Appends one Yjs update. With `seedRevision`, this is the seed: the saved page at that revision. */
export async function pushRoom(c: RoomCaller, args: { roomId: string; epoch: number; clientId: string; data: string; seedRevision?: number }) {
  if (!args.data || args.data.length > MAX_UPDATE_CHARS) throw new MaxError("LIMIT", "That change is too large to send at once.");
  const { room } = await roomFor(c, args.roomId, "edit", args.epoch);
  if (args.seedRevision !== undefined) {
    const current = await revisionOf(c.db, room.ownerId, room.pageId);
    if (room.seededRevision !== null || room.seeding !== args.clientId || current !== args.seedRevision) {
      throw new MaxError("CONFLICT", "Someone else opened this page first. Reloading it.", { epoch: room.epoch });
    }
    await c.db.patch("collabRooms", room._id, { seededRevision: args.seedRevision, seeding: null });
  } else if (room.seededRevision === null) {
    throw new MaxError("CONFLICT", "This page isn't ready yet. Reloading it.", { epoch: room.epoch });
  }
  const seq = room.nextSeq;
  await c.db.insert("collabUpdates", { ownerId: room.ownerId, roomId: room._id, pageId: room.pageId, epoch: room.epoch, seq, data: args.data, at: c.now });
  await c.db.patch("collabRooms", room._id, { nextSeq: seq + 1 });
  return { seq };
}

/** Stores this editor's cursor and selection (a Yjs awareness update) and drops stale ones. */
export async function setAwareness(c: RoomCaller, args: { roomId: string; epoch: number; clientId: string; data: string }) {
  if (args.data.length > 8_000) throw new MaxError("LIMIT", "Cursor data is too large.");
  const { room } = await roomFor(c, args.roomId, "view", args.epoch);
  const rows = await c.db.list("collabAwareness", room.ownerId, { field: "pageId", value: room.pageId });
  const mine = rows.find((r) => r.clientId === args.clientId && r.roomId === room._id);
  for (const r of rows) if (r !== mine && c.now - r.at > AWARENESS_TTL_MS) await c.db.delete("collabAwareness", r._id);
  if (mine) await c.db.patch("collabAwareness", mine._id, { data: args.data, at: c.now, accountId: c.actor.id });
  else await c.db.insert("collabAwareness", { ownerId: room.ownerId, pageId: room.pageId, roomId: room._id, clientId: args.clientId, accountId: c.actor.id, data: args.data, at: c.now });
  return { ok: true };
}

/**
 * Saves the room's merged content to the page (so search, history, exports and assistants see
 * it) and, given `state` covering every update up to `upTo`, replaces those updates with it.
 */
export async function commitRoom(
  c: RoomCaller & { storage: Storage | null },
  args: { roomId: string; epoch: number; clientId: string; blocks: unknown[]; state?: string; upTo?: number },
) {
  const { room } = await roomFor(c, args.roomId, "edit", args.epoch);
  if (room.seededRevision === null) throw new MaxError("CONFLICT", "This page isn't ready yet. Reloading it.", { epoch: room.epoch });
  const ctx = { db: c.db, storage: c.storage, ownerId: room.ownerId, now: c.now, source: "ui" as const, actor: c.actor };
  const saved = await writeContent(ctx, room.pageId, normalizeBlocks(args.blocks), undefined, { fromRoom: true });
  const patch: Partial<CollabRoomRow> = { seededRevision: saved.revision };
  let compacted = false;
  if (args.state && args.upTo !== undefined && args.upTo > 1 && args.upTo < room.nextSeq && args.state.length <= MAX_UPDATE_CHARS) {
    const old = await c.db.updatesAfter(room._id, -1, 10_000);
    const folded = old.filter((u) => u.seq <= args.upTo!);
    if (folded.length > 1) {
      for (const u of folded) await c.db.delete("collabUpdates", u._id);
      await c.db.insert("collabUpdates", { ownerId: room.ownerId, roomId: room._id, pageId: room.pageId, epoch: room.epoch, seq: args.upTo, data: args.state, at: c.now });
      compacted = true;
    }
  }
  await c.db.patch("collabRooms", room._id, { seededRevision: patch.seededRevision! });
  return { revision: saved.revision, compacted };
}

/** Removes this editor's cursor when the page is closed. */
export async function leaveRoom(c: RoomCaller, roomId: string, clientId: string) {
  const room = await c.db.get("collabRooms", roomId);
  if (!room) return { ok: true };
  await access(c, room.pageId, "view");
  for (const r of await c.db.list("collabAwareness", room.ownerId, { field: "pageId", value: room.pageId })) {
    if (r.clientId === clientId) await c.db.delete("collabAwareness", r._id);
  }
  return { ok: true };
}
