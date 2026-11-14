import {test} from "node:test";
import assert from "node:assert/strict";
import * as Y from "yjs";
import {AuthorizedYjsProvider,toBase64,fromBase64} from "./provider.mjs";

class SyntheticServer {
 constructor(){this.log=[];this.watchers=new Set();this.roles={alice:"edit",bob:"edit",carol:"view"};}
 as(accountId){
  const server={log:this.log,watchers:this.watchers,roles:this.roles};
  const allow=(write=false)=>{
   if(!server.roles[accountId]||(write&&server.roles[accountId]!=="edit"))throw Error("FORBIDDEN");
  };
  return {
   async join(scope){
    allow();
    if(scope.workspaceId!=="lab-workspace"||scope.pageId!=="lab-page")throw Error("WRONG_SCOPE");
    return {sessionId:"session_"+accountId,expiresAt:Date.now()+300000,
     headSeq:server.log.length,accountId,canEdit:server.roles[accountId]==="edit"};
   },
   async readUpdates({sessionId,afterSeq,limit}){
    allow();
    if(sessionId!=="session_"+accountId)throw Error("STOLEN_SESSION");
    const updates=server.log.filter(x=>x.seq>afterSeq).slice(0,limit);
    return {headSeq:server.log.length,updates,hasMore:server.log.length>afterSeq+updates.length};
   },
   async appendUpdate({sessionId,operationId,base64}){
    allow(true);
    if(sessionId!=="session_"+accountId)throw Error("STOLEN_SESSION");
    const old=server.log.find(x=>x.operationId===operationId&&x.actorId===accountId);
    if(old){
     if(old.base64!==base64)throw Error("RETRY_PAYLOAD_MISMATCH");
     return {seq:old.seq,duplicate:true};
    }
    const entry={seq:server.log.length+1,operationId,base64,actorId:accountId};
    server.log.push(entry);
    for(const cb of server.watchers)queueMicrotask(cb);
    return {seq:entry.seq,duplicate:false};
   },
   watch(_args,onUpdate,onError){
    const cb=()=>{try{allow();onUpdate();}catch(e){onError(e);}};
    server.watchers.add(cb);queueMicrotask(cb);
    return ()=>server.watchers.delete(cb);
   },
   close(){},
  };
 }
}
function peer(server,name){
 const doc=new Y.Doc();
 const provider=new AuthorizedYjsProvider({
  doc,transport:server.as(name),workspaceId:"lab-workspace",pageId:"lab-page",
 });
 return {doc,provider};
}
const value=p=>p.doc.getText("body").toString();
async function until(check,message){
 for(let i=0;i<150;i++){
  if(check())return;
  await new Promise(r=>setTimeout(r,10));
 }
 throw Error(message);
}
test("Yjs Arabic binary state base64 round-trip preserves exact bytes",()=>{
 const doc=new Y.Doc();doc.getText("body").insert(0,"مرحبا 🌍");
 const bytes=Y.encodeStateAsUpdate(doc);
 assert.deepEqual(fromBase64(toBase64(bytes)),bytes);doc.destroy();
});
test("separate editors converge across ordered append/read without echo",async()=>{
 const server=new SyntheticServer(),a=peer(server,"alice"),b=peer(server,"bob");
 try{
  await a.provider.connect();await b.provider.connect();
  a.doc.getText("body").insert(0,"مرحبا");
  await until(()=>value(b)==="مرحبا","bob failed to converge");
  b.doc.getText("body").insert(6," Max");
  await until(()=>value(a)===value(b)&&value(a).includes("Max"),"alice failed to converge");
  assert.equal(server.log.length,2,"remote replay must never append again");
  await until(()=>!a.provider.pending.length&&!b.provider.pending.length,"ack did not clear queue");
 }finally{await a.provider.destroy();await b.provider.destroy();}
});
test("offline edits refuse automatic replay until explicit reviewed reconnect",async()=>{
 const server=new SyntheticServer(),a=peer(server,"alice"),b=peer(server,"bob");
 try{
  await a.provider.connect();await b.provider.connect();
  a.provider.disconnect();a.doc.getText("body").insert(0,"Offline");
  assert.equal(a.provider.pending.length,1);
  await assert.rejects(()=>a.provider.connect(),/OFFLINE_REPLAY_REQUIRES_REVIEW/);
  assert.equal(server.log.length,0);
  await a.provider.connect({reviewedPending:true});
  await until(()=>value(b)==="Offline","reviewed replay did not reach bob");
  assert.equal(a.provider.pending.length,0);
 }finally{await a.provider.destroy();await b.provider.destroy();}
});
test("revocation denies writes while preserving unsent local Yjs changes",async()=>{
 const server=new SyntheticServer(),b=peer(server,"bob");
 try{
  await b.provider.connect();server.roles.bob=null;
  b.doc.getText("body").insert(0,"do-not-upload");
  await until(()=>b.provider.state==="blocked","revoked client not fenced");
  assert.equal(server.log.length,0);
  assert.equal(b.provider.pending.length,1);
  assert.match(value(b),/do-not-upload/);
  await assert.rejects(()=>b.provider.connect({reviewedPending:true}),/FORBIDDEN/);
 }finally{await b.provider.destroy();}
});
test("view-only guest reads updates but cannot submit writes",async()=>{
 const server=new SyntheticServer(),a=peer(server,"alice"),c=peer(server,"carol");
 try{
  await a.provider.connect();
  a.doc.getText("body").insert(0,"Read only");
  await until(()=>server.log.length===1,"missing append");
  await c.provider.connect();
  assert.equal(value(c),"Read only");
  assert.equal(c.provider.canEdit,false);
  c.doc.getText("body").insert(0,"local");
  assert.equal(c.provider.pending.length,1);
  assert.equal(server.log.length,1);
 }finally{await a.provider.destroy();await c.provider.destroy();}
});
test("account switch rejects pending bytes bound to another identity",async()=>{
 const server=new SyntheticServer(),a=peer(server,"alice");
 try{
  await a.provider.connect();a.provider.disconnect();
  a.doc.getText("body").insert(0,"private-local");
  a.provider.transport=server.as("bob");
  await assert.rejects(()=>a.provider.connect({reviewedPending:true}),/ACCOUNT_SWITCH/);
  assert.equal(server.log.length,0);
  assert.equal(a.provider.pending.length,1);
 }finally{await a.provider.destroy();}
});
test("malformed sequence gaps fail closed without cursor advance",async()=>{
 const server=new SyntheticServer(),a=peer(server,"alice"),doc=new Y.Doc();
 try{
  doc.getText("body").insert(0,"hi");
  server.log.push({seq:2,base64:toBase64(Y.encodeStateAsUpdate(doc)),operationId:"bad",actorId:"alice"});
  await assert.rejects(()=>a.provider.connect(),/GAP_IN_SERVER_UPDATE_LOG/);
  assert.equal(a.provider.state,"blocked");
  assert.equal(a.provider.cursor,0);
 }finally{await a.provider.destroy();doc.destroy();}
});
