import { test } from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import { AuthorizedYjsProvider } from "./provider.mjs";

// Synthetic transport with a lost response AFTER the server has committed.
// It models uncertain acknowledgments without pretending to be a cloud test.
function server() {
  const log = [];
  const state = { log, role: "edit", fail: null, appendCalls: 0, commits: 0 };
  const transport = {
    async join() {
      if (state.role === "revoked") throw Error("FORBIDDEN");
      return { sessionId: "synthetic-lease", accountId: "alice",
        expiresAt: Date.now() + 300_000, canEdit: state.role === "edit" };
    },
    async readUpdates({ afterSeq, limit }) {
      if (state.fail === "read") throw Error("PARTITION_ON_READ");
      if (state.role === "revoked") throw Error("FORBIDDEN");
      return { headSeq: log.length, hasMore: log.length > afterSeq + limit,
        updates: log.filter(e => e.seq > afterSeq).slice(0, limit) };
    },
    async appendUpdate({ operationId, base64 }) {
      state.appendCalls++;
      if (state.role !== "edit") throw Error("FORBIDDEN");
      if (state.fail === "before-commit") {
        state.fail = null;
        throw Error("PARTITION_BEFORE_COMMIT");
      }
      const prior = log.find(e => e.operationId === operationId);
      if (prior) {
        if (prior.base64 !== base64) throw Error("RETRY_PAYLOAD_MISMATCH");
        return { seq: prior.seq, duplicate: true };
      }
      const entry = { seq: log.length + 1, operationId, base64, actorId: "alice" };
      log.push(entry);
      state.commits++;
      if (state.fail === "after-commit") {
        state.fail = null;
        throw Error("PARTITION_AFTER_COMMIT");
      }
      return { seq: entry.seq, duplicate: false };
    },
    watch: () => () => {},
    close() {},
  };
  return { state, transport };
}
function journal() {
  const entries = [];
  return {
    entries,
    async load() { return entries.map(e => ({ ...e })); },
    async append(_scope, entry) {
      if (entries.some(e => e.operationId === entry.operationId)) throw Error("DUPLICATE_TEST_ENTRY");
      entries.push({ ...entry });
    },
    async ack(_scope, operationId) {
      const idx = entries.findIndex(e => e.operationId === operationId);
      if (idx < 0) throw Error("ACK_NOT_DURABLE");
      entries.splice(idx, 1);
    },
  };
}
async function until(check) {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  throw Error("SYNTHETIC_PARTITION_TEST_TIMEOUT");
}
async function setup() {
  const remote = server(), outbox = journal(), doc = new Y.Doc();
  const provider = new AuthorizedYjsProvider({
    doc, journal: outbox, accountIdHint: "alice",
    workspaceId: "synthetic-pr23", pageId: "partition-lab",
    transport: remote.transport,
  });
  await provider.restorePending();
  await provider.connect();
  return { ...remote, outbox, doc, provider,
    async close() { await provider.destroy(); doc.destroy(); } };
}

for (const mode of ["before-commit", "after-commit"]) {
  test("partition " + mode + " retains exact Arabic bytes and requires reviewed replay", async () => {
    const p = await setup();
    const text = "التَّعَلُّم — اختبار 👩‍⚕️ مرحبا";
    try {
      p.state.fail = mode;
      p.doc.getText("body").insert(0, text);
      await until(() => p.provider.state === "blocked");
      assert.equal(p.provider.pending.length, 1);
      assert.equal(p.outbox.entries.length, 1);
      const operation = p.outbox.entries[0].operationId;
      assert.equal(p.state.commits, mode === "after-commit" ? 1 : 0);
      await assert.rejects(() => p.provider.connect(), /OFFLINE_REPLAY_REQUIRES_REVIEW/);
      assert.equal(p.state.commits, mode === "after-commit" ? 1 : 0);
      // A deliberate user action resumes the SAME operation ID, not a fresh write.
      await p.provider.connect({ reviewedPending: true });
      await until(() => p.provider.pending.length === 0);
      assert.equal(p.state.commits, 1);
      assert.equal(p.outbox.entries.length, 0);
      assert.equal(p.state.log[0].operationId, operation);
      assert.equal(p.doc.getText("body").toString(), text);
      const restored = new Y.Doc();
      Y.applyUpdate(restored, Uint8Array.from(atob(p.state.log[0].base64), c => c.charCodeAt(0)));
      assert.equal(restored.getText("body").toString(), text);
      restored.destroy();
    } finally { await p.close(); }
  });
}

test("permission downgrade while disconnected cannot replay a durable outbox", async () => {
  const p = await setup();
  try {
    p.provider.disconnect();
    p.doc.getText("body").insert(0, "حفظ محلي فقط");
    await p.provider.persistBarrier;
    p.state.role = "view";
    await assert.rejects(() => p.provider.connect(), /OFFLINE_REPLAY_REQUIRES_REVIEW/);
    await p.provider.connect({ reviewedPending: true });
    assert.equal(p.provider.canEdit, false);
    assert.equal(p.provider.pending.length, 1);
    assert.equal(p.outbox.entries.length, 1);
    assert.equal(p.state.commits, 0);
    assert.match(p.provider.lastError.message, /READ_ONLY_PENDING_EXPORT_REQUIRED/);
  } finally { await p.close(); }
});

test("server read partition blocks without erasing local pending updates", async () => {
  const p = await setup();
  try {
    p.provider.disconnect();
    p.doc.getText("body").insert(0, "offline read failure");
    await p.provider.persistBarrier;
    p.state.fail = "read";
    await assert.rejects(() => p.provider.connect({ reviewedPending: true }), /PARTITION_ON_READ/);
    assert.equal(p.provider.state, "blocked");
    assert.equal(p.outbox.entries.length, 1);
    assert.equal(p.state.commits, 0);
    p.state.fail = null;
    await assert.rejects(() => p.provider.connect(), /OFFLINE_REPLAY_REQUIRES_REVIEW/);
  } finally { await p.close(); }
});

test("destroy during an outstanding join never resurrects the provider", async () => {
  const doc = new Y.Doc();
  let joinResolve;
  const transport = {
    join() { return new Promise(resolve => { joinResolve = resolve; }); },
    readUpdates() { throw Error("MUST_NOT_READ_AFTER_DESTROY"); },
    close() {},
  };
  const provider = new AuthorizedYjsProvider({
    doc, transport, workspaceId: "synthetic", pageId: "pr23",
  });
  try {
    const pending = provider.connect();
    await until(() => typeof joinResolve === "function");
    await provider.destroy();
    joinResolve({ sessionId: "late", accountId: "alice",
      expiresAt: Date.now() + 300_000, canEdit: true });
    await assert.rejects(pending, /destroyed during join/i);
    assert.equal(provider.state, "destroyed");
    assert.equal(provider.canEdit, false);
    assert.equal(provider.poll, null);
  } finally { doc.destroy(); }
});
