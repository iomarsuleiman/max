import test from "node:test";
import assert from "node:assert/strict";
import { LocalReadLeaseDeadline } from "./read-lease-deadline.mjs";
import { LabCommentClient } from "./comments.mjs";
import { LabSuggestionClient } from "./suggestions.mjs";
import { LabInboxClient } from "./inbox.mjs";
import { LabRoomActivityClient } from "./activity.mjs";

function clock() {
  let now = 1000, next = 0;
  const scheduled = new Map();
  return {
    now: () => now,
    schedule: (fn, delay) => {
      assert.ok(Number.isSafeInteger(delay) && delay >= 1 && delay <= 2_147_483_647);
      const id = ++next;
      scheduled.set(id, { at: now + delay, fn });
      return id;
    },
    cancel: id => scheduled.delete(id),
    advance: delta => {
      now += delta;
      for (let repeat = 0; repeat < 100; repeat++) {
        const due = [...scheduled].filter(([, v]) => v.at <= now)
          .sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        for (const [id, task] of due)
          if (scheduled.delete(id)) task.fn();
      }
    },
    tasks: () => [...scheduled.values()],
  };
}
test("deadline is independent of status notifications; cancels stale callbacks", () => {
  const c = clock(), expired = [];
  const d = new LocalReadLeaseDeadline({ ...c, onExpire: () => expired.push("expired") });
  assert.throws(() => d.arm(Number.NaN), /INVALID_READ_LEASE_DEADLINE/);
  d.arm(1100);
  const stale = c.tasks()[0].fn;
  d.arm(1200);
  stale();
  c.advance(100);
  assert.deepEqual(expired, []);
  c.advance(100);
  assert.deepEqual(expired, ["expired"]);
  d.arm(1300);
  d.clear();
  c.advance(200);
  assert.equal(expired.length, 1);
  assert.equal(c.tasks().length, 0);
});
test("early timer wakeup and large lease intervals cannot expire prematurely", () => {
  const c = clock();
  let count = 0;
  const d = new LocalReadLeaseDeadline({ ...c, onExpire: () => count++ });
  d.arm(Number.MAX_SAFE_INTEGER);
  assert.equal(c.tasks()[0].at - c.now(), 2_147_483_647);
  d.arm(1100);
  const early = c.tasks()[0].fn;
  early(); // stale timer on a clock that has not reached the deadline
  assert.equal(count, 0);
  c.advance(101);
  assert.equal(count, 1);
});

function readSurfaceHarness() {
  const c = clock(), listeners = new Set(), callbacks = {}, records = {};
  const transport = {};
  for (const name of ["watchCommentAccess", "watchCommentThreads", "watchThreadComments",
    "watchSuggestionAccess", "watchSuggestions", "watchInbox", "watchRoomActivity"]) {
    transport[name] = (args, update, error) => {
      const sub = { args, update, error, closed: false };
      (callbacks[name] ??= []).push(sub);
      return () => { sub.closed = true; };
    };
  }
  transport.markInboxRead = async () => ({ readAt: 1010, duplicate: false });
  const provider = {
    state: "offline", accountId: "alice", session: null, transport,
    on: (_, fn) => listeners.add(fn), off: (_, fn) => listeners.delete(fn),
    emit: () => { for (const fn of listeners) fn(); },
  };
  const options = { provider, now: c.now, scheduleExpiry: c.schedule,
    cancelExpiry: c.cancel };
  const clientTypes = {
    comments: LabCommentClient, suggestions: LabSuggestionClient,
    inbox: LabInboxClient, activity: LabRoomActivityClient,
  };
  const clients = {};
  for (const [name, Type] of Object.entries(clientTypes)) {
    records[name] = [];
    clients[name] = new Type({ ...options, onChange: value => records[name].push(value) });
    clients[name].start();
  }
  const connect = (sessionId = "session-a", accountId = "alice") => {
    provider.accountId = accountId;
    provider.state = "online";
    provider.session = { sessionId, accountId, expiresAt: c.now() + 100 };
    provider.emit();
  };
  return { c, provider, callbacks, records, clients, connect,
    stop: () => Object.values(clients).forEach(client => client.stop()) };
}
function emitSample(x) {
  x.callbacks.watchCommentAccess.at(-1).update(true);
  x.callbacks.watchCommentThreads.at(-1).update([{
    threadId: "thread-x", blockId: "block-x", resolvedAt: null, revision: 1, canResolve: true,
  }]);
  x.callbacks.watchSuggestionAccess.at(-1).update({canSuggest:true,canReview:false});
  x.callbacks.watchSuggestions.at(-1).update([]);
  x.callbacks.watchInbox.at(-1).update({
    unreadCount: 1, notifications: [{ notificationId: "notice-x", kind: "mention",
      targetId: "thread-x", actorId: "bob", createdAt: 1000, readAt: null }],
  });
  x.callbacks.watchRoomActivity.at(-1).update([{
    activityId: "event-x", kind: "thread_opened", targetId: "thread-x",
    actorId: "bob", createdAt: 1000,
  }]);
}
test("all four read panels purge their data at lease expiry without a provider event", () => {
  const x = readSurfaceHarness();
  x.connect();
  emitSample(x);
  assert.equal(x.records.comments.at(-1).threads.length, 1);
  assert.equal(x.records.suggestions.at(-1).canSuggest, true);
  assert.equal(x.records.inbox.at(-1).unreadCount, 1);
  assert.equal(x.records.activity.at(-1).activities.length, 1);
  x.c.advance(101); // intentionally NO provider.emit()
  for (const name of Object.keys(x.clients))
    assert.equal(x.records[name].at(-1).connected, false, name);
  assert.deepEqual(x.records.comments.at(-1).threads, []);
  assert.equal(x.records.suggestions.at(-1).canSuggest, false);
  assert.deepEqual(x.records.inbox.at(-1).notifications, []);
  assert.deepEqual(x.records.activity.at(-1).activities, []);
  assert.equal(x.c.tasks().length, 0);
  x.stop();
});
test("account-switch and revoked-room status fence stale subscription callbacks", () => {
  const x = readSurfaceHarness();
  x.connect();
  emitSample(x);
  const old = x.callbacks.watchRoomActivity.at(-1);
  const oldLeaseCallback = x.c.tasks()[0].fn;
  x.provider.state = "blocked";
  x.provider.session = null;
  x.provider.emit();
  x.connect("session-b", "carol");
  emitSample(x);
  old.update([{activityId:"old",kind:"thread_opened",targetId:"secret",actorId:"alice",createdAt:1000}]);
  oldLeaseCallback();
  assert.equal(x.records.activity.at(-1).activities[0].activityId, "event-x");
  assert.equal(x.records.inbox.at(-1).notifications[0].notificationId, "notice-x");
  x.stop();
  assert.equal(x.c.tasks().length, 0);
});
