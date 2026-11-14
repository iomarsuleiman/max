/**
 * PR15 isolated real-library runtime experiments.
 *
 * Uses real Yjs CRDT merge/update APIs and real ProseMirror OT rebase APIs.
 * Loads the actual Convex ProseMirror Sync package. Does NOT claim either
 * provider has been connected to a live Convex backend or a BlockNote editor.
 * Only disposable synthetic fixtures: NEVER load user or workspace content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { collab, receiveTransaction, sendableSteps } from "prosemirror-collab";

const sync = (...documents) => {
  const updates = documents.map((doc) => Y.encodeStateAsUpdate(doc));
  for (const document of documents) {
    for (const update of updates) Y.applyUpdate(document, update);
  }
};

const yClient = () => {
  const doc = new Y.Doc();
  return { doc, blocks: doc.getMap("blocks"), text: doc.getText("arabic-english") };
};

test("Yjs real library converges concurrent 2-client Arabic + Latin text and preserves custom block metadata", () => {
  const alice = yClient();
  const bob = yClient();
  const custom = new Y.Map();
  custom.set("id", "gold-diagram");
  custom.set("type", "diagram");
  custom.set("props", JSON.stringify({ text: "flowchart LR\n A-->B", dir: "rtl", extra: { x: 1 } }));
  alice.blocks.set("gold-diagram", custom);
  alice.text.insert(0, "مرحبا");
  sync(alice.doc, bob.doc);
  alice.text.insert(5, " Alice");
  bob.text.insert(0, "بالعالم ");
  sync(alice.doc, bob.doc);
  assert.equal(alice.text.toString(), bob.text.toString());
  assert.match(alice.text.toString(), /Alice/);
  assert.match(alice.text.toString(), /بالعالم/);
  assert.deepEqual(alice.blocks.get("gold-diagram").toJSON(), bob.blocks.get("gold-diagram").toJSON());
  assert.equal(alice.blocks.get("gold-diagram").get("id"), "gold-diagram");
  alice.doc.destroy();
  bob.doc.destroy();
});

test("Yjs three peers converge after divergent offline changes and reconnect", () => {
  const peers = [yClient(), yClient(), yClient()];
  peers[0].text.insert(0, "الحمد");
  sync(...peers.map((peer) => peer.doc));
  peers[0].text.insert(peers[0].text.length, " A");
  peers[1].text.insert(0, "B ");
  peers[2].text.insert(2, " C");
  sync(...peers.map((peer) => peer.doc));
  assert.equal(new Set(peers.map((peer) => peer.text.toString())).size, 1);
  assert.match(peers[0].text.toString(), /A/);
  assert.match(peers[0].text.toString(), /B/);
  assert.match(peers[0].text.toString(), /C/);
  peers.forEach((peer) => peer.doc.destroy());
});

test("Yjs survives a synthetic crash/restart with an explicit persisted update and merges remote edits", () => {
  const first = yClient();
  first.text.insert(0, "offline مرحبا");
  // This byte buffer simulates a completed persistence write; it is NOT
  // IndexedDB persistence, and the test says nothing about real crash durability.
  const persisted = Y.encodeStateAsUpdate(first.doc);
  first.doc.destroy();
  const restored = yClient();
  Y.applyUpdate(restored.doc, persisted);
  const remote = yClient();
  Y.applyUpdate(remote.doc, persisted);
  restored.text.insert(restored.text.length, " local");
  remote.text.insert(0, "remote ");
  sync(restored.doc, remote.doc);
  assert.equal(restored.text.toString(), remote.text.toString());
  assert.match(restored.text.toString(), /local/);
  assert.match(restored.text.toString(), /remote/);
  restored.doc.destroy();
  remote.doc.destroy();
});

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block", toDOM: () => ["p", 0] },
    text: { group: "inline" },
  },
});
const initialDocument = () => schema.node("doc", null, [
  schema.node("paragraph", null, [schema.text("مرحبا")]),
]);
const createPeer = (id) => EditorState.create({
  schema, doc: initialDocument(), plugins: [collab({ version: 0, clientID: id })],
});

test("ProseMirror real OT library rebases concurrent edits from two clients", () => {
  let alice = createPeer("alice");
  let bob = createPeer("bob");
  alice = alice.apply(alice.tr.insertText("Alice ", 1));
  bob = bob.apply(bob.tr.insertText("Bob ", 1));
  const aSteps = sendableSteps(alice);
  assert.ok(aSteps && aSteps.steps.length > 0);
  alice = alice.apply(receiveTransaction(alice, aSteps.steps, aSteps.steps.map(() => aSteps.clientID)));
  bob = bob.apply(receiveTransaction(bob, aSteps.steps, aSteps.steps.map(() => aSteps.clientID)));
  const bSteps = sendableSteps(bob);
  assert.ok(bSteps && bSteps.steps.length > 0);
  alice = alice.apply(receiveTransaction(alice, bSteps.steps, bSteps.steps.map(() => bSteps.clientID)));
  bob = bob.apply(receiveTransaction(bob, bSteps.steps, bSteps.steps.map(() => bSteps.clientID)));
  assert.deepEqual(alice.doc.toJSON(), bob.doc.toJSON());
  assert.match(alice.doc.textContent, /Alice/);
  assert.match(alice.doc.textContent, /Bob/);
});

test("Convex ProseMirror Sync real package resolves without opening any backend session", async () => {
  const provider = await import("@convex-dev/prosemirror-sync");
  assert.equal(typeof provider.ProsemirrorSync, "function");
  // No Convex deployment, auth token, database or network call is created.
});

test("Max-pinned BlockNote 0.55 exposes the real Yjs collaboration adapter entrypoint", async () => {
  const adapter = await import("@blocknote/core/yjs");
  assert.equal(typeof adapter.withCollaboration, "function");
  // Actual BlockNote editor mounting, maxSchema hydration and network-backed
  // awareness are deliberately not considered proven by this import probe.
});
