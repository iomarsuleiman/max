import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { AuthorizedYjsProvider } from "./provider.mjs";

/** Synthetic event source, NOT Clerk or Convex. Real-identity tests are opt-in. */
function fakeServer({ ttl = 300_000 } = {}) {
  const subscribers = new Set();
  const server = {
    role: "edit", appends: [], watched: 0, deadline: null,
    transport: {
      async join() {
        server.deadline = Date.now() + ttl;
        return { sessionId: "fake_session", accountId: "alice",
          expiresAt: server.deadline, headSeq: 0, canEdit: server.role === "edit" };
      },
      async readUpdates() {
        if (server.role === "revoked") throw Error("FORBIDDEN");
        return { headSeq: 0, hasMore: false, updates: [] };
      },
      async appendUpdate(args) {
        if (server.role !== "edit") throw Error("FORBIDDEN");
        server.appends.push(args);
        return { seq: server.appends.length, duplicate: false };
      },
      watch: () => () => {},
      watchStatus(_scope, onUpdate, onError) {
        const subscriber = { onUpdate, onError };
        subscribers.add(subscriber);
        server.watched++;
        queueMicrotask(() => onUpdate(server.status()));
        return () => subscribers.delete(subscriber);
      },
      close() {},
    },
    status() {
      return { accountId: "alice", expiresAt: server.deadline, canEdit: server.role === "edit" };
    },
    changeRole(role) {
      server.role = role;
      for (const s of subscribers) {
        if (role === "revoked") s.onError(Error("FORBIDDEN"));
        else s.onUpdate(server.status());
      }
    },
    badStatus() {
      for (const s of subscribers) s.onUpdate({ ...server.status(), accountId: "intruder" });
    },
    get activeSubscriptions() { return subscribers.size; },
  };
  return server;
}
function peer(server) {
  const doc = new Y.Doc();
  const provider = new AuthorizedYjsProvider({
    doc, transport: server.transport, workspaceId: "pr20-synthetic",
    pageId: "synthetic-page",
  });
  return { doc, provider, async close() { await provider.destroy(); doc.destroy(); } };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("reactive permission downgrade immediately disables editing and keeps read transport", async () => {
  const server = fakeServer(), p = peer(server);
  try {
    await p.provider.connect();
    assert.equal(p.provider.canEdit, true);
    server.changeRole("view");
    assert.equal(p.provider.canEdit, false);
    assert.equal(p.provider.lastAuthorizedCanEdit, false);
    assert.equal(p.provider.state, "online");
    p.doc.getText("body").insert(0, "local draft not uploaded");
    assert.equal(p.provider.pending.length, 1);
    await p.provider.flush();
    assert.equal(server.appends.length, 0);
    assert.equal(p.provider.state, "online");
    server.changeRole("edit"); // stale/late status cannot silently regrant
    assert.equal(p.provider.canEdit, false);
  } finally { await p.close(); }
});
test("read-only rejoin preserves explicit reviewed offline edits without uploading", async () => {
  const server = fakeServer(), p = peer(server);
  try {
    await p.provider.connect();
    p.provider.disconnect();
    p.doc.getText("body").insert(0, "offline retained");
    assert.equal(p.provider.pending.length, 1);
    server.changeRole("view");
    await assert.rejects(() => p.provider.connect(), /OFFLINE_REPLAY_REQUIRES_REVIEW/);
    await p.provider.connect({ reviewedPending: true });
    assert.equal(p.provider.state, "online");
    assert.equal(p.provider.canEdit, false);
    assert.equal(p.provider.pending.length, 1);
    assert.equal(p.doc.getText("body").toString(), "offline retained");
    assert.equal(server.appends.length, 0);
    assert.match(p.provider.lastError.message, /READ_ONLY_PENDING_EXPORT_REQUIRED/);
  } finally { await p.close(); }
});
test("local deadline blocks without waiting for server reactivity and unsubscribes", async () => {
  const server = fakeServer({ ttl: 70 }), p = peer(server);
  try {
    await p.provider.connect();
    assert.equal(server.activeSubscriptions, 1);
    await sleep(140);
    assert.equal(p.provider.state, "blocked");
    assert.equal(p.provider.canEdit, false);
    assert.match(p.provider.lastError.message, /LEASE_EXPIRED/);
    assert.equal(server.activeSubscriptions, 0);
  } finally { await p.close(); }
});
test("status identity mismatch and revocation both fence ongoing subscriptions", async () => {
  for (const failure of ["badStatus", "revoked"]) {
    const server = fakeServer(), p = peer(server);
    try {
      await p.provider.connect();
      if (failure === "revoked") server.changeRole("revoked");
      else server.badStatus();
      assert.equal(p.provider.state, "blocked");
      assert.equal(p.provider.canEdit, false);
      assert.equal(server.activeSubscriptions, 0);
    } finally { await p.close(); }
  }
});
