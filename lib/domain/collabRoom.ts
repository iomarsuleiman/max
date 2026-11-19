import type { Db } from "./db";
import type { CollabRoomRow } from "./types";

/**
 * Empties a live room and bumps its epoch: everyone in it reloads the page from the saved content.
 * Kept apart from collab.ts so document writes can call it without an import cycle.
 */
export async function clearRoom(db: Db, room: CollabRoomRow) {
  for (let guard = 0; guard < 200; guard++) {
    const batch = await db.updatesAfter(room._id, -1, 400);
    if (!batch.length) break;
    for (const u of batch) await db.delete("collabUpdates", u._id);
  }
  for (const a of await db.list("collabAwareness", room.ownerId, { field: "pageId", value: room.pageId })) await db.delete("collabAwareness", a._id);
  await db.patch("collabRooms", room._id, { epoch: room.epoch + 1, seededRevision: null, seeding: null, seedingAt: 0, nextSeq: 1 });
}

export async function findRoom(db: Db, ownerId: string, pageId: string): Promise<CollabRoomRow | null> {
  return (await db.list("collabRooms", ownerId, { field: "pageId", value: pageId }))[0] ?? null;
}
