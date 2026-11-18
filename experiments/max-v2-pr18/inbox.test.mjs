import test from "node:test";
import assert from "node:assert/strict";
import { LabInboxClient, normalizeInbox } from "./inbox.mjs";

function setup() {
  let now = 1000;
  const listeners = new Set(), watches = [], writes = [], changes = [], errors = [];
  const transport = {
    watchInbox: (_, update, error) => {
      const observer = { closed: false,
        update: payload => { if (!observer.closed) update(payload); },
        error: reason => { if (!observer.closed) error(reason); },
      };
      watches.push(observer);
      return () => { observer.closed = true; };
    },
    markInboxRead: async args => {
      writes.push(args);
      return { readAt: now, duplicate: false };
    },
  };
  const provider = {
    state: "offline", accountId: "alice", session: null, transport,
    on: (_, listener) => listeners.add(listener),
    off: (_, listener) => listeners.delete(listener),
    emit: () => { for (const listener of listeners) listener(); },
  };
  const client = new LabInboxClient({ provider, onChange: data => changes.push(data),
    onError: err => errors.push(err), now: () => now });
  const record = { notificationId: "inbox-a", kind: "mention",
    actorId: "bob", targetId: "comment-a", createdAt: 1000, readAt: null };
  const connect = (id = "session-1") => {
    provider.state = "online";
    provider.session = { sessionId: id, accountId: "alice", expiresAt: now + 500 };
    provider.emit();
  };
  return { provider, client, record, transport, connect, watches, writes, changes, errors,
    tick: n => { now += n; provider.emit(); } };
}

test("validates event kinds, duplicate IDs and unread-count parity", () => {
  const x = setup();
  assert.deepEqual(normalizeInbox({ unreadCount: 1, notifications: [x.record] }),
    { unreadCount: 1, notifications: [x.record] });
  assert.throws(() => normalizeInbox({ unreadCount: 0, notifications: [x.record] }), /INVALID_UNREAD_COUNT/);
  assert.throws(() => normalizeInbox({ unreadCount: 2, notifications: [x.record, x.record] }), /INVALID_INBOX_ITEM/);
  assert.throws(() => normalizeInbox({ unreadCount: 1, notifications: [{ ...x.record, kind: "grade" }] }), /INVALID_INBOX_ITEM/);
});
test("does not subscribe or acknowledge without a live authorized session", async () => {
  const x = setup();
  x.client.start();
  assert.equal(x.watches.length, 0);
  await assert.rejects(x.client.markRead(x.record.notificationId), /INBOX_SESSION_OR_EVENT_UNAVAILABLE/);
  x.connect();
  x.watches[0].update({ unreadCount: 1, notifications: [x.record] });
  await x.client.markRead(x.record.notificationId);
  assert.deepEqual(x.writes[0], { sessionId: "session-1", notificationId: "inbox-a" });
  x.client.stop();
});
test("disconnection wipes stale data and old callbacks cannot repopulate", () => {
  const x = setup(); x.client.start(); x.connect();
  x.watches[0].update({ unreadCount: 1, notifications: [x.record] });
  x.provider.state = "offline"; x.provider.session = null; x.provider.emit();
  assert.deepEqual(x.changes.at(-1).notifications, []);
  x.watches[0].update({ unreadCount: 1, notifications: [x.record] });
  assert.deepEqual(x.changes.at(-1).notifications, []);
  x.connect("session-2");
  x.watches[1].update({ unreadCount: 0, notifications: [{ ...x.record, readAt: 1001 }] });
  assert.equal(x.changes.at(-1).notifications[0].readAt, 1001);
  x.client.stop();
});
test("invalid reactive payloads, denied ACL and lease expiry clear sensitive state", () => {
  const x = setup(); x.client.start(); x.connect();
  x.watches[0].update({ unreadCount: 1, notifications: [{ ...x.record, targetId: "" }] });
  assert.equal(x.errors.at(-1).message, "INVALID_INBOX_ITEM");
  assert.deepEqual(x.changes.at(-1).notifications, []);
  x.connect("session-2");
  x.watches.at(-1).update({ unreadCount: 1, notifications: [x.record] });
  x.watches.at(-1).error(Error("FORBIDDEN"));
  assert.equal(x.errors.at(-1).message, "FORBIDDEN");
  x.connect("session-3");
  x.watches.at(-1).update({ unreadCount: 1, notifications: [x.record] });
  x.tick(501);
  assert.equal(x.changes.at(-1).connected, false);
  assert.deepEqual(x.changes.at(-1).notifications, []);
  x.client.stop();
});
test("writes returning after a room/session switch cannot be reported as success", async () => {
  const x = setup(); x.client.start(); x.connect();
  x.watches.at(-1).update({ unreadCount: 1, notifications: [x.record] });
  let finish;
  x.transport.markInboxRead = () => new Promise(resolve => { finish = resolve; });
  const pending = x.client.markRead("inbox-a");
  x.provider.state = "offline"; x.provider.session = null; x.provider.emit();
  finish({ readAt: 1001, duplicate: false });
  await assert.rejects(pending, /INBOX_SESSION_CHANGED_AFTER_WRITE/);
  x.client.stop();
});
