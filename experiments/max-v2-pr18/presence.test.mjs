import {test} from "node:test";
import assert from "node:assert/strict";
import {LabPresenceClient} from "./presence.mjs";

function setup() {
  let now=10_000;
  const calls=[], stops=[], watches=[];
  const intervals={set:()=>Symbol("timer"),clear:()=>{}};
  const transport={
    publishPresence:async args=>{calls.push(args);return now+20_000;},
    watchPresence:(args,update,error)=>{
      const watch={args,update,error,closed:false};
      watches.push(watch);
      return ()=>{watch.closed=true;};
    },
    stopPresence:async args=>{stops.push(args);return true;},
  };
  const listeners=new Set();
  const provider={
    state:"idle", accountId:"alice", canEdit:true, session:null,transport,
    on:(event,listener)=>{assert.equal(event,"status");listeners.add(listener);},
    off:(event,listener)=>{assert.equal(event,"status");listeners.delete(listener);},
    emit:()=>{for(const callback of listeners)callback({status:"connected"});},
  };
  const changes=[],errors=[];
  const client=new LabPresenceClient({provider,now:()=>now,intervals,
    onChange:rows=>changes.push(rows),onError:error=>errors.push(error)});
  const connect=()=>{
    provider.session={sessionId:"lease-a",accountId:"alice",expiresAt:50_000};
    provider.state="online";provider.emit();
  };
  return {provider,client,calls,stops,watches,changes,errors,connect,
    advance:ms=>{now+=ms;}};
}
const peer=(expiresAt=30_000)=>({accountId:"bob",state:"editing",blockId:"block1",
  anchor:1,head:2,expiresAt});

test("cannot publish or subscribe before an authenticated live lease",async()=>{
  const t=setup();t.client.start();await t.client.whenIdle();
  assert.equal(t.calls.length,0);assert.equal(t.watches.length,0);t.client.stop();
});
test("gated live lease watches the server, excludes self, and sends no note text",async()=>{
  const t=setup();t.client.start();t.connect();await t.client.whenIdle();
  assert.equal(t.watches.length,1);
  assert.deepEqual(t.calls.at(-1),{sessionId:"lease-a",visible:true,state:"viewing",selection:null});
  t.watches[0].update([peer(),{...peer(),accountId:"alice"}]);
  assert.deepEqual(t.changes.at(-1).map(x=>x.accountId),["bob"]);
  assert.equal(JSON.stringify(t.changes.at(-1)).includes("anchor"),false);
  t.client.stop();
});
test("local clock removes expired peers without requiring reactive Convex updates",()=>{
  const t=setup();t.client.start();t.connect();
  t.watches[0].update([peer(10_500)]);
  assert.equal(t.changes.at(-1).length,1);
  t.advance(501);t.client.tick();assert.deepEqual(t.changes.at(-1),[]);t.client.stop();
});
test("invisible mode serializes deletion after an editing heartbeat",async()=>{
  const t=setup();t.client.start();t.connect();t.client.setFocusBlock("block1");
  t.client.setVisible(false);await t.client.whenIdle();
  assert.equal(t.calls.at(-1).visible,false);
  assert.equal(t.calls.at(-1).selection,null);
  t.client.stop();
});
test("permission downgrade redacts outgoing editing focus on next status",async()=>{
  const t=setup();t.client.start();t.connect();t.client.setFocusBlock("block1");
  await t.client.whenIdle();
  assert.equal(t.calls.at(-1).state,"editing");
  t.provider.canEdit=false;t.provider.emit();await t.client.whenIdle();
  assert.deepEqual(t.calls.at(-1),{sessionId:"lease-a",visible:true,state:"viewing",selection:null});
  t.client.stop();
});
test("disconnect removes peers immediately and discards stale watch callbacks",()=>{
  const t=setup();t.client.start();t.connect();t.watches[0].update([peer()]);
  t.provider.state="offline";t.provider.session=null;t.provider.emit();
  assert.equal(t.watches[0].closed,true);
  assert.deepEqual(t.changes.at(-1),[]);
  t.watches[0].update([peer()]);
  assert.deepEqual(t.changes.at(-1),[]);t.client.stop();
});
test("watch authorization failures clear peers and report the blocker",()=>{
  const t=setup();t.client.start();t.connect();t.watches[0].update([peer()]);
  t.watches[0].error(Error("FORBIDDEN"));
  assert.deepEqual(t.changes.at(-1),[]);
  assert.equal(t.errors.at(-1).message,"FORBIDDEN");t.client.stop();
});
test("invalid identifiers, untrusted rows and lease expiry never display cursors",()=>{
  const t=setup();t.client.start();t.connect();
  t.client.setFocusBlock("a block with spaces");
  t.watches[0].update([{...peer(),blockId:"malicious/block"}]);
  assert.deepEqual(t.changes.at(-1),[]);
  t.advance(40_001);t.client.tick();
  assert.equal(t.watches[0].closed,true);
  assert.deepEqual(t.changes.at(-1),[]);t.client.stop();
});
