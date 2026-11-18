import test from "node:test";
import assert from "node:assert/strict";
import {LabSuggestionClient,normalizeSuggestions} from "./suggestions.mjs";
function setup(){
  let clock=1000;
  const watches={access:[],list:[]},writes=[],updates=[],errors=[];
  const listeners=new Set();
  function watch(kind,onUpdate,onError){
    const item={closed:false,update:payload=>{if(!item.closed)onUpdate(payload);},
      error:err=>{if(!item.closed)onError(err);}};
    watches[kind].push(item);
    return ()=>{item.closed=true;};
  }
  const provider={state:"idle",accountId:"alice",session:null,on:(_,cb)=>listeners.add(cb),
    off:(_,cb)=>listeners.delete(cb),emit:()=>{for(const fn of listeners)fn();},
    transport:{
      watchSuggestionAccess:(_,update,error)=>watch("access",update,error),
      watchSuggestions:(_,update,error)=>watch("list",update,error),
      createSuggestion:async args=>{writes.push({kind:"create",...args});return {suggestionId:"s1",duplicate:false};},
      reviewSuggestion:async args=>{writes.push({kind:"review",...args});return {status:args.decision==="accept"?"accepted":"rejected",revision:2,duplicate:false};},
    },
  };
  const client=new LabSuggestionClient({provider,onChange:state=>updates.push(state),
    onError:e=>errors.push(e),now:()=>clock});
  const row={suggestionId:"s1",blockId:"stable-block-1",baseSeq:0,
    originalText:"Before",replacementText:"بعد",note:"",status:"pending",
    revision:1,proposedBy:"bob",reviewedBy:null,canReview:true,createdAt:1000};
  function connect(id="lease-a"){
    provider.state="online";provider.session={sessionId:id,accountId:"alice",expiresAt:clock+10000};
    provider.emit();
  }
  function ready(){
    watches.access.at(-1).update({canSuggest:true,canReview:true});
    watches.list.at(-1).update([row]);
  }
  return {watches,writes,updates,errors,provider,client,row,connect,ready,advance:n=>clock+=n};
}
test("comment permission permits proposing but only edit capability permits review",async()=>{
  const x=setup();x.client.start();x.connect();
  x.watches.access[0].update({canSuggest:true,canReview:false});
  x.watches.list[0].update([x.row]);
  await x.client.propose({blockId:x.row.blockId,originalText:"Before",replacementText:"بعد",expectedHeadSeq:0});
  await assert.rejects(x.client.review({suggestionId:"s1",expectedRevision:1,expectedHeadSeq:0,decision:"accept"}),/SUGGESTION_PERMISSION_REQUIRED/);
  x.watches.access[0].update({canSuggest:false,canReview:true});
  await assert.rejects(x.client.propose({blockId:x.row.blockId,originalText:"Before",replacementText:"بعد",expectedHeadSeq:0}),/SUGGESTION_PERMISSION_REQUIRED/);
  await x.client.review({suggestionId:"s1",expectedRevision:1,expectedHeadSeq:0,decision:"accept"});
  assert.equal(x.writes.at(-1).kind,"review");x.client.stop();
});
test("never subscribes or writes without a live session",async()=>{
  const x=setup();x.client.start();
  assert.equal(x.watches.access.length,0);
  await assert.rejects(x.client.propose({blockId:"ok",originalText:"a",replacementText:"b",expectedHeadSeq:0}),/SUGGESTION_PERMISSION_REQUIRED/);
  x.client.stop();
});
test("stale sessions and callbacks are fenced from the next account or room",()=>{
  const x=setup();x.client.start();x.connect();x.ready();
  x.provider.state="offline";x.provider.session=null;x.provider.emit();
  assert.deepEqual(x.updates.at(-1).suggestions,[]);
  x.watches.list[0].update([x.row]);
  assert.deepEqual(x.updates.at(-1).suggestions,[]);
  x.connect("lease-b");x.watches.list.at(-1).update([x.row]);
  assert.deepEqual(x.updates.at(-1).suggestions,[x.row]);
  x.client.stop();
});
test("lease timeout and ACL revocation errors erase all sensitive proposal data",()=>{
  const x=setup();x.client.start();x.connect();x.ready();
  x.advance(10001);x.provider.emit();
  assert.equal(x.updates.at(-1).connected,false);
  x.connect("lease-c");x.ready();
  x.watches.list.at(-1).error(Error("FORBIDDEN"));
  assert.equal(x.errors.at(-1).message,"FORBIDDEN");
  assert.deepEqual(x.updates.at(-1).suggestions,[]);
  x.client.stop();
});
test("malformed remote suggestion rows fail closed",()=>{
  const x=setup();x.client.start();x.connect();
  x.watches.list[0].update([{...x.row,suggestionId:"s1",blockId:"bad/block"}]);
  assert.equal(x.errors.at(-1).message,"INVALID_SUGGESTION");
  assert.equal(x.updates.at(-1).connected,false);x.client.stop();
  assert.throws(()=>normalizeSuggestions([x.row,{...x.row}]),/INVALID_SUGGESTION/);
});
test("conflicting review attempts and invalid payloads never reach transport",async()=>{
  const x=setup();x.client.start();x.connect();x.ready();
  await assert.rejects(x.client.review({suggestionId:"s1",expectedRevision:2,expectedHeadSeq:0,decision:"accept"}),/SUGGESTION_REVIEW_NOT_ALLOWED/);
  await assert.rejects(x.client.review({suggestionId:"s1",expectedRevision:1,expectedHeadSeq:1,decision:"accept"}),/SUGGESTION_REVIEW_NOT_ALLOWED/);
  await assert.rejects(x.client.propose({blockId:"bad/block",originalText:"one",replacementText:"two",expectedHeadSeq:0}),/INVALID_SUGGESTION_DRAFT/);
  assert.deepEqual(x.writes,[]);x.client.stop();
});
