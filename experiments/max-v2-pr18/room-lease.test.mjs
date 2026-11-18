import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireBrowserRoomLease, labRoomLockName } from "./room-lease.mjs";

function locks() {
  const held = new Set();
  return {
    held,
    async request(name, options, callback) {
      assert.deepEqual(options, { mode: "exclusive", ifAvailable: true });
      if (held.has(name)) return callback(null);
      held.add(name);
      try { return await callback({ name }); }
      finally { held.delete(name); }
    },
  };
}
const scope = { accountId: "alice", workspaceId: "workspace-1", pageId: "page-1" };
async function until(fn) {
  for (let i = 0; i < 100; i++) {
    if (fn()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  throw Error("Timed out waiting for Web Lock release");
}

test("same account and room reject second tab and allow explicit handoff", async () => {
  const api = locks();
  const a = await acquireBrowserRoomLease(scope, api);
  assert.equal(api.held.size, 1);
  await assert.rejects(() => acquireBrowserRoomLease(scope, api),
    /ROOM_ALREADY_OPEN_IN_ANOTHER_TAB/);
  a.release();
  a.release();
  await until(() => api.held.size === 0);
  const b = await acquireBrowserRoomLease(scope, api);
  assert.equal(api.held.size, 1);
  b.release();
  await until(() => api.held.size === 0);
});

test("different account and page scopes do not share a Web Lock", async () => {
  const api = locks();
  const a = await acquireBrowserRoomLease(scope, api);
  const b = await acquireBrowserRoomLease({ ...scope, accountId: "bob" }, api);
  const c = await acquireBrowserRoomLease({ ...scope, pageId: "page-2" }, api);
  assert.equal(api.held.size, 3);
  for (const lease of [a, b, c]) lease.release();
  await until(() => api.held.size === 0);
});

test("missing Web Locks and malformed scope fail closed", async () => {
  await assert.rejects(() => acquireBrowserRoomLease(scope, null),
    /WEB_LOCKS_UNAVAILABLE/);
  assert.throws(() => labRoomLockName({ ...scope, accountId: "a/other" }),
    /INVALID_LAB_ROOM_LOCK_SCOPE/);
  assert.throws(() => labRoomLockName({ ...scope, pageId: "" }),
    /INVALID_LAB_ROOM_LOCK_SCOPE/);
  assert.equal(labRoomLockName(scope), labRoomLockName({ ...scope }));
});

test("Web Locks errors are not interpreted as successful ownership", async () => {
  await assert.rejects(() => acquireBrowserRoomLease(scope, {
    request() { throw Error("Permission denied"); },
  }), /Permission denied/);
});
