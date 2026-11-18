import test from "node:test";
import assert from "node:assert/strict";
import {LabRoomActivityClient, normalizeRoomActivity} from "./activity.mjs";

function setup() {
  let now = 1000;
  const listeners = new Set(), watches = [], changes = [], errors = [];
  const provider = {
    state:"offline", accountId:"alice", session:null,
    transport: {
      watchRoomActivity: (_, update, error) => {
        const observer = {closed:false,
          update: data => { if (!observer.closed) update(data); },
          error: reason => { if (!observer.closed) error(reason); }};
        watches.push(observer);
        return () => { observer.closed = true; };
      },
    },
    on: (_, cb) => listeners.add(cb),
    off: (_, cb) => listeners.delete(cb),
    emit: () => { for (const cb of listeners) cb(); },
  };
  const client = new LabRoomActivityClient({provider,
    onChange: v => changes.push(v), onError: e => errors.push(e), now: () => now});
  const record = {activityId:"activity-1", kind:"thread_opened",
    actorId:"bob", targetId:"thread-1", createdAt:1000};
  const connect = (sessionId = "session-1") => {
    provider.state="online";
    provider.session={sessionId,accountId:"alice",expiresAt:now+500};
    provider.emit();
  };
  return {provider,client,watches,changes,errors,record,connect,
    tick: n => {now+=n;provider.emit();}};
}
test("rejects malformed kinds, duplicate IDs and oversized payloads", () => {
  const x=setup();
  assert.deepEqual(normalizeRoomActivity([x.record]),[x.record]);
  assert.throws(()=>normalizeRoomActivity([x.record,x.record]),/INVALID_ROOM_ACTIVITY_ITEM/);
  assert.throws(()=>normalizeRoomActivity([{...x.record,kind:"private_grade"}]),/INVALID_ROOM_ACTIVITY_ITEM/);
  assert.throws(()=>normalizeRoomActivity([{...x.record,targetId:""}]),/INVALID_ROOM_ACTIVITY_ITEM/);
  assert.throws(()=>normalizeRoomActivity(Array(41).fill(x.record)),/INVALID_ROOM_ACTIVITY/);
});
test("never subscribes before live session and clears after stop", () => {
  const x=setup();x.client.start();
  assert.equal(x.watches.length,0);
  x.connect();
  assert.equal(x.watches.length,1);
  x.watches[0].update([x.record]);
  assert.deepEqual(x.changes.at(-1).activities,[x.record]);
  x.client.stop();
  assert.deepEqual(x.changes.at(-1).activities,[]);
});
test("offline and account switch fence stale callbacks", () => {
  const x=setup();x.client.start();x.connect();
  x.watches[0].update([x.record]);
  x.provider.state="offline";x.provider.session=null;x.provider.emit();
  assert.deepEqual(x.changes.at(-1).activities,[]);
  x.watches[0].update([x.record]);
  assert.deepEqual(x.changes.at(-1).activities,[]);
  x.connect("session-2");
  x.watches[1].update([{...x.record,actorId:null}]);
  assert.equal(x.changes.at(-1).activities[0].actorId,null);
  x.provider.accountId="other";
  x.provider.emit();
  assert.deepEqual(x.changes.at(-1).activities,[]);
  x.client.stop();
});
test("expires locally and rejects invalid or unauthorized subscriptions", () => {
  const x=setup();x.client.start();x.connect();
  x.watches[0].update([{...x.record,createdAt:"invalid"}]);
  assert.equal(x.errors.at(-1).message,"INVALID_ROOM_ACTIVITY_ITEM");
  assert.deepEqual(x.changes.at(-1).activities,[]);
  x.connect("session-2");
  x.watches[1].error(Error("FORBIDDEN"));
  assert.equal(x.errors.at(-1).message,"FORBIDDEN");
  x.connect("session-3");
  x.watches[2].update([x.record]);
  x.tick(501);
  assert.equal(x.changes.at(-1).connected,false);
  assert.deepEqual(x.changes.at(-1).activities,[]);
  x.client.stop();
});
