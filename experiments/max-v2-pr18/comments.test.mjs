import {test} from "node:test";
import assert from "node:assert/strict";
import {LabCommentClient} from "./comments.mjs";
function setup(){
  let now=10000;
  const watchers={access:[],threads:[],comments:[]},writes=[],listeners=new Set(),updates=[];
  const watch=(type)=>(args,update,error)=>{
    const entry={args,update,error,closed:false};
    watchers[type].push(entry);return ()=>{entry.closed=true;};
  };
  const transport={
    watchCommentAccess:watch("access"),watchCommentThreads:watch("threads"),watchThreadComments:watch("comments"),
    createCommentThread:async args=>{writes.push({kind:"create",...args});return {threadId:"thread-1"};},
    replyToCommentThread:async args=>{writes.push({kind:"reply",...args});return {commentId:"item-2"};},
    resolveCommentThread:async args=>{writes.push({kind:"resolve",...args});return {revision:2};},
  };
  const provider={state:"idle",accountId:"alice",canEdit:true,session:null,transport,
    on:(type,fn)=>{assert.equal(type,"status");listeners.add(fn);},
    off:(type,fn)=>{assert.equal(type,"status");listeners.delete(fn);},
    emit:()=>{for(const fn of listeners)fn({status:"connected"});},
  };
  const errors=[];
  const client=new LabCommentClient({provider,now:()=>now,onChange:x=>updates.push(x),onError:e=>errors.push(e)});
  const connect=(sessionId="lease-a")=>{
    provider.session={sessionId,accountId:"alice",expiresAt:now+10000};
    provider.state="online";provider.emit();
  };
  const thread={threadId:"thread-1",blockId:"stable-block-1",resolvedAt:null,revision:1,canResolve:true};
  const ready=()=>{watchers.access.at(-1).update(true);watchers.threads.at(-1).update([thread]);};
  return {provider,client,watchers,writes,updates,errors,thread,connect,ready,
    advance:n=>{now+=n;}};
}
test("does not subscribe or write without a live server-issued lease",async()=>{
  const x=setup();x.client.start();
  assert.equal(x.watchers.access.length,0);
  await assert.rejects(x.client.create({blockId:"stable-block-1",body:"hello"}),/COMMENT_ACCESS_REQUIRED/);
  x.client.stop();
});
test("requires a reactive server-granted comment capability independent of edit flag",async()=>{
  const x=setup();x.client.start();x.connect();
  x.watchers.access[0].update(false);x.watchers.threads[0].update([x.thread]);
  await assert.rejects(x.client.create({blockId:"stable-block-1",body:"hi"}),/COMMENT_ACCESS_REQUIRED/);
  x.provider.canEdit=false;x.provider.emit();
  x.watchers.access[0].update(true);
  await x.client.create({blockId:"stable-block-1",body:"hello",mentions:["bob"]});
  assert.equal(x.writes[0].kind,"create");assert.deepEqual(x.writes[0].mentions,["bob"]);
  assert.equal(x.writes[0].sessionId,"lease-a");x.client.stop();
});
test("selects thread, receives safe comment records and performs idempotent reply",async()=>{
  const x=setup();x.client.start();x.connect();x.ready();
  x.client.selectThread("thread-1");
  x.watchers.comments[0].update([{commentId:"item-1",authorId:"bob",body:"أهلا",mentions:[],createdAt:10000,kind:"initial"}]);
  assert.equal(x.updates.at(-1).comments[0].body,"أهلا");
  await x.client.reply({threadId:"thread-1",body:"Response",operationId:"same-operation-1"});
  assert.equal(x.writes.at(-1).operationId,"same-operation-1");
  await x.client.resolve({threadId:"thread-1",expectedRevision:1,resolved:true});
  assert.equal(x.writes.at(-1).kind,"resolve");x.client.stop();
});
test("stale callbacks after account/session change never leak another room's threads",()=>{
  const x=setup();x.client.start();x.connect();x.ready();
  x.provider.state="offline";x.provider.session=null;x.provider.emit();
  assert.equal(x.updates.at(-1).threads.length,0);
  assert.equal(x.watchers.threads[0].closed,true);
  x.watchers.threads[0].update([x.thread]);
  assert.deepEqual(x.updates.at(-1).threads,[]);
  x.connect("lease-b");x.watchers.threads[0].update([x.thread]);
  assert.deepEqual(x.updates.at(-1).threads,[]);
  x.client.stop();
});
test("lease expiry, revocation-like watch error and invalid records fail closed",()=>{
  const x=setup();x.client.start();x.connect();x.ready();
  x.watchers.threads[0].update([{...x.thread,blockId:"bad/block"}]);
  assert.equal(x.errors.at(-1).message,"INVALID_THREAD");
  assert.equal(x.updates.at(-1).connected,false);
  x.connect("lease-b");x.ready();x.advance(10001);
  x.provider.emit();
  assert.equal(x.updates.at(-1).connected,false);
  x.connect("lease-c");x.ready();
  x.watchers.access.at(-1).error(Error("FORBIDDEN"));
  assert.equal(x.errors.at(-1).message,"FORBIDDEN");x.client.stop();
});
test("malformed comments, forged threads and insufficient ownership cannot mutate",async()=>{
  const x=setup();x.client.start();x.connect();x.ready();
  assert.throws(()=>x.client.selectThread("other-room-thread"),/UNKNOWN_THREAD/);
  await assert.rejects(x.client.reply({threadId:"unknown",body:"no"}),/UNKNOWN_THREAD/);
  x.client.selectThread("thread-1");
  x.watchers.comments[0].update([{commentId:"c1",authorId:"bob",body:"",mentions:["secret","secret","secret","secret"],createdAt:10,kind:"reply"}]);
  assert.equal(x.errors.at(-1).message,"INVALID_COMMENT");
  x.client.stop();
});
