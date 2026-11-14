import {test} from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {AuthorizedYjsProvider,toBase64} from "./provider.mjs";

// Persistence API double: isolates provider crash/restart semantics; the real
// IndexedDB implementation is exercised separately in Chromium/WebKit.
class DurableDouble {
  data=new Map(); failAppend=false; failAck=false;
  key(s){return JSON.stringify([s.accountId,s.workspaceId,s.pageId]);}
  async load(s){return structuredClone(this.data.get(this.key(s))??[]);}
  async append(s,e){
    if(this.failAppend) throw Error("QUOTA_EXCEEDED");
    const xs=await this.load(s);
    if(xs.find(x=>x.operationId===e.operationId))return;
    xs.push({...e});this.data.set(this.key(s),xs);
  }
  async ack(s,id){
    if(this.failAck) throw Error("ACK_STORAGE_FAILED");
    this.data.set(this.key(s),(await this.load(s)).filter(e=>e.operationId!==id));
  }
}
class Server {
  constructor(){this.log=[];this.roles={alice:"edit",bob:"edit",carol:"view"};}
  as(id){
    return {
      join:async()=>({sessionId:"session-"+id,accountId:id,canEdit:this.roles[id]==="edit",
        expiresAt:Date.now()+300_000,headSeq:this.log.length}),
      readUpdates:async({afterSeq})=>({
        headSeq:this.log.length,hasMore:false,updates:this.log.filter(x=>x.seq>afterSeq),
      }),
      appendUpdate:async({operationId,base64})=>{
        if(this.roles[id]!=="edit")throw Error("FORBIDDEN");
        const prev=this.log.find(x=>x.operationId===operationId&&x.actorId===id);
        if(prev){assert.equal(prev.base64,base64);return {seq:prev.seq,duplicate:true};}
        const item={operationId,base64,actorId:id,seq:this.log.length+1};
        this.log.push(item);return {seq:item.seq,duplicate:false};
      },
      watch:()=>()=>{},close:()=>{},
    };
  }
}
function peer(server,journal,id){
  const doc=new Y.Doc();
  const provider=new AuthorizedYjsProvider({
    doc,transport:server.as(id),journal,accountIdHint:id,
    workspaceId:"lab-workspace",pageId:"lab-page",
  });
  return {doc,provider,async close(){await provider.destroy();doc.destroy();}};
}
async function settled(p) {
  for(let i=0;i<50;i++){
    if(!p.provider.pending.length || p.provider.state==="blocked") return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  throw Error("provider did not settle");
}
test("crash/restart restores exact queued Yjs bytes; replay needs explicit review and server ACK",async()=>{
 const server=new Server(),journal=new DurableDouble(),a=peer(server,journal,"alice");
 try{
  await a.provider.restorePending();await a.provider.connect();
  a.provider.disconnect();
  a.doc.getText("body").insert(0,"مرحبا offline 🌍");
  await a.provider.persistBarrier;
  const original=await journal.load(a.provider.journalScope);
  assert.equal(original.length,1);assert.equal(original[0].size>0,true);
 }finally{await a.close();}
 const b=peer(server,journal,"alice");
 try{
  assert.equal(await b.provider.restorePending(),1);
  assert.equal(b.doc.getText("body").toString(),"مرحبا offline 🌍");
  await assert.rejects(()=>b.provider.connect(),/OFFLINE_REPLAY_REQUIRES_REVIEW/);
  assert.equal(server.log.length,0);
  await b.provider.connect({reviewedPending:true});
  await settled(b);
  assert.equal(server.log.length,1);
  assert.equal((await journal.load(b.provider.journalScope)).length,0);
 }finally{await b.close();}
 const c=peer(server,journal,"alice");
 try{await c.provider.restorePending();await c.provider.connect();
  assert.equal(c.doc.getText("body").toString(),"مرحبا offline 🌍");
 }finally{await c.close();}
});
test("write waits for the IndexedDB commit; quota failure blocks and preserves local content",async()=>{
 const server=new Server(),journal=new DurableDouble(),a=peer(server,journal,"alice");
 try{
  await a.provider.restorePending();await a.provider.connect();
  journal.failAppend=true;
  a.doc.getText("body").insert(0,"must not transmit");
  await assert.rejects(()=>a.provider.persistBarrier,/QUOTA_EXCEEDED/);
  await settled(a);
  assert.equal(a.provider.state,"blocked");assert.equal(server.log.length,0);
  assert.equal(a.provider.pending.length,1);
  assert.equal(a.doc.getText("body").toString(),"must not transmit");
 }finally{await a.close();}
});
test("failed local ack retains operation for idempotent replay after restart",async()=>{
 const server=new Server(),journal=new DurableDouble(),a=peer(server,journal,"alice");
 try{
  await a.provider.restorePending();await a.provider.connect();
  journal.failAck=true;
  a.doc.getText("body").insert(0,"ack lost");
  await settled(a);
  assert.equal(a.provider.state,"blocked");assert.equal(server.log.length,1);
  assert.equal((await journal.load(a.provider.journalScope)).length,1);
 }finally{await a.close();}
 journal.failAck=false;
 const b=peer(server,journal,"alice");
 try{
  await b.provider.restorePending();
  await assert.rejects(()=>b.provider.connect(),/OFFLINE_REPLAY_REQUIRES_REVIEW/);
  await b.provider.connect({reviewedPending:true});
  await settled(b);
  assert.equal(server.log.length,1,"operation ID must survive retry");
  assert.equal((await journal.load(b.provider.journalScope)).length,0);
 }finally{await b.close();}
});
test("separate authenticated accounts and pages cannot read the stored pending queue",async()=>{
 const server=new Server(),journal=new DurableDouble(),a=peer(server,journal,"alice");
 try{
  await a.provider.restorePending();a.doc.getText("body").insert(0,"private");
  await a.provider.persistBarrier;
  const b=peer(server,journal,"bob");
  try{assert.equal(await b.provider.restorePending(),0);
    assert.equal(b.doc.getText("body").toString(),"");
  }finally{await b.close();}
  const different=new AuthorizedYjsProvider({
    doc:new Y.Doc(),transport:server.as("alice"),accountIdHint:"alice",
    journal,workspaceId:"lab-workspace",pageId:"other-page",
  });
  try{assert.equal(await different.restorePending(),0);}
  finally{const d=different.doc;await different.destroy();d.destroy();}
 }finally{await a.close();}
});
test("account binding rejects a substituted server identity even with an empty durable queue",async()=>{
 const server=new Server(),journal=new DurableDouble();
 const p=new AuthorizedYjsProvider({
  doc:new Y.Doc(),transport:server.as("bob"),accountIdHint:"alice",
  journal,workspaceId:"lab-workspace",pageId:"lab-page",
 });
 try{await p.restorePending();await assert.rejects(()=>p.connect(),/ACCOUNT_SWITCH/);}
 finally{const d=p.doc;await p.destroy();d.destroy();}
});
