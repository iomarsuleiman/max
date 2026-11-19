import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { commitRoom, joinRoom, leaveRoom, pullRoom, pushRoom, setAwareness, SEED_TIMEOUT_MS } from "@/lib/domain/collab";
import { ANONYMOUS } from "@/lib/domain/sharing";

const alice = { id: "user_alice", name: "Alice", image: null };
const bob = { id: "user_bob", name: "Bob", image: null };
const cara = { id: "user_cara", name: "Cara", image: null };

async function world() {
  const h = setup();
  const owner = h.as(alice.id);
  const page = (await owner<{ page: { _id: string } }>("pages.create", { title: "Plan" })).page;
  await owner("documents.writeMarkdown", { pageId: page._id, markdown: "First line" });
  await owner("shares.invite", { pageId: page._id, granteeId: bob.id, level: "edit" });
  await owner("shares.invite", { pageId: page._id, granteeId: cara.id, level: "view" });
  let now = Date.UTC(2026, 10, 19);
  const as = (actor: typeof alice) => ({ db: h.db, storage: h.storage, actor, get now() { return (now += 100); } });
  const tick = (ms: number) => (now += ms);
  const tx = <T,>(fn: () => Promise<T>) => h.db.transaction(fn) as Promise<T>;
  return { h, owner, page, as, tick, tx };
}

describe("live co-editing rooms", () => {
  it("has the first editor seed the room while others wait, then streams updates in order", async () => {
    const { page, as, tx } = await world();
    const a = await tx(() => joinRoom(as(alice), page._id, "tab-a"));
    expect(a).toMatchObject({ ready: false, seed: true, canEdit: true });
    const b = await tx(() => joinRoom(as(bob), page._id, "tab-b"));
    expect(b).toMatchObject({ roomId: a.roomId, ready: false, seed: false });

    // Only the seeder may seed, and only from the revision the page is at.
    await expect(tx(() => pushRoom(as(bob), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-b", data: "AAA", seedRevision: a.revision }))).rejects.toThrow(/first/);
    await expect(tx(() => pushRoom(as(alice), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-a", data: "AAA", seedRevision: a.revision - 1 }))).rejects.toThrow(/first/);
    await tx(() => pushRoom(as(alice), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-a", data: "SEED", seedRevision: a.revision }));
    await tx(() => pushRoom(as(bob), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-b", data: "B1" }));
    await tx(() => pushRoom(as(alice), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-a", data: "A1" }));

    const all = await pullRoom(as(bob), a.roomId, 0);
    expect(all).toMatchObject({ ready: true, head: 3, epoch: a.epoch });
    expect(all.updates.map((u) => u.data)).toEqual(["SEED", "B1", "A1"]);
    expect((await pullRoom(as(bob), a.roomId, 2)).updates.map((u) => u.data)).toEqual(["A1"]);
    // A later visitor joins a ready room without seeding.
    expect(await tx(() => joinRoom(as(cara), page._id, "tab-c"))).toMatchObject({ ready: true, seed: false, canEdit: false });
  });

  it("hands seeding to someone else when the seeder goes away", async () => {
    const { page, as, tick, tx } = await world();
    await tx(() => joinRoom(as(alice), page._id, "tab-a"));
    tick(SEED_TIMEOUT_MS + 1);
    expect(await tx(() => joinRoom(as(bob), page._id, "tab-b"))).toMatchObject({ seed: true });
  });

  it("keeps viewers, strangers and visitors out of the edit stream", async () => {
    const { page, as, tx } = await world();
    const a = await tx(() => joinRoom(as(alice), page._id, "tab-a"));
    await tx(() => pushRoom(as(alice), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-a", data: "SEED", seedRevision: a.revision }));
    await expect(tx(() => pushRoom(as(cara), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-c", data: "X" }))).rejects.toThrow(/Can edit/);
    // Viewers still see cursors and may show their own.
    await tx(() => setAwareness(as(cara), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-c", data: "cursor" }));
    const stranger = { id: "user_dan", name: "Dan", image: null };
    await expect(tx(() => joinRoom(as(stranger), page._id, "tab-d"))).rejects.toThrow(/doesn't exist|not found/i);
    await expect(pullRoom(as(stranger), a.roomId, 0)).rejects.toThrow();
    await expect(tx(() => joinRoom(as({ id: ANONYMOUS, name: "Visitor", image: null }), page._id, "tab-v"))).rejects.toThrow(/Sign in/);
  });

  it("saves the room to the page and folds old updates into one snapshot", async () => {
    const { owner, page, as, tx } = await world();
    const a = await tx(() => joinRoom(as(alice), page._id, "tab-a"));
    await tx(() => pushRoom(as(alice), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-a", data: "SEED", seedRevision: a.revision }));
    for (const d of ["U2", "U3", "U4"]) await tx(() => pushRoom(as(bob), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-b", data: d }));
    const blocks = [{ type: "paragraph", content: "Typed together" }];
    const saved = await tx(() => commitRoom(as(bob), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-b", blocks, state: "MERGED", upTo: 3 }));
    expect(saved.compacted).toBe(true);
    const doc = await owner<{ markdown: string; revision: number }>("documents.get", { pageId: page._id, format: "markdown" });
    expect(doc.markdown).toContain("Typed together");
    expect(doc.revision).toBe(saved.revision);
    // The room survives its own saves: nobody is asked to reload.
    const pulled = await pullRoom(as(alice), a.roomId, 0);
    expect(pulled.epoch).toBe(a.epoch);
    expect(pulled.updates.map((u) => [u.seq, u.data])).toEqual([
      [3, "MERGED"],
      [4, "U4"],
    ]);
    expect(await tx(() => joinRoom(as(cara), page._id, "tab-c"))).toMatchObject({ ready: true, epoch: a.epoch });
  });

  it("resets the room when the page is changed from outside it, so nobody overwrites the change", async () => {
    const { owner, page, as, tx } = await world();
    const a = await tx(() => joinRoom(as(alice), page._id, "tab-a"));
    await tx(() => pushRoom(as(alice), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-a", data: "SEED", seedRevision: a.revision }));
    await tx(() => setAwareness(as(bob), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-b", data: "cursor" }));
    // An assistant rewrites the page.
    await owner("documents.writeMarkdown", { pageId: page._id, markdown: "Rewritten by an assistant" });
    const after = await pullRoom(as(bob), a.roomId, 0);
    expect(after).toMatchObject({ epoch: a.epoch + 1, ready: false, updates: [], awareness: [] });
    await expect(tx(() => pushRoom(as(bob), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-b", data: "stale" }))).rejects.toThrow(/changed somewhere else/);
    await expect(tx(() => commitRoom(as(bob), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-b", blocks: [] }))).rejects.toThrow(/changed somewhere else/);
    const doc = await owner<{ markdown: string }>("documents.get", { pageId: page._id, format: "markdown" });
    expect(doc.markdown).toContain("Rewritten by an assistant");
    // Rejoining seeds the new epoch from the new content.
    expect(await tx(() => joinRoom(as(bob), page._id, "tab-b"))).toMatchObject({ epoch: a.epoch + 1, seed: true });
  });

  it("removes a cursor when its editor closes", async () => {
    const { page, as, tx } = await world();
    const a = await tx(() => joinRoom(as(alice), page._id, "tab-a"));
    await tx(() => setAwareness(as(bob), { roomId: a.roomId, epoch: a.epoch, clientId: "tab-b", data: "cursor" }));
    expect((await pullRoom(as(alice), a.roomId, 0)).awareness).toHaveLength(1);
    await tx(() => leaveRoom(as(bob), a.roomId, "tab-b"));
    expect((await pullRoom(as(alice), a.roomId, 0)).awareness).toHaveLength(0);
  });
});
