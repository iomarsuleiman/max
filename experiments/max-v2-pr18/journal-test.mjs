import * as Y from "yjs";
import { createIndexedDbJournal } from "./durable-journal.mjs";

const scope=(accountId="alice",pageId="page1")=>({accountId,workspaceId:"pr19-lab",pageId});
const data=(text)=>{
  const doc=new Y.Doc();
  doc.getText("body").insert(0,text);
  const bytes=Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return {
    operationId:"operation_"+crypto.randomUUID().replaceAll("-",""),
    base64:btoa(String.fromCharCode(...bytes)),size:bytes.byteLength,
  };
};
window.__pr19Journal={
  async stage(){
    const journal=createIndexedDbJournal();
    const entry=data("عربي offline — durable ✅");
    await journal.append(scope(),entry);
    return entry;
  },
  async read(account="alice",page="page1"){
    const journal=createIndexedDbJournal();
    return journal.load(scope(account,page));
  },
  async ack(operationId){return createIndexedDbJournal().ack(scope(),operationId);},
  async replay(){
    const entries=await createIndexedDbJournal().load(scope());
    const doc=new Y.Doc();
    try{
      for(const entry of entries)Y.applyUpdate(doc,Uint8Array.from(atob(entry.base64),c=>c.charCodeAt(0)));
      return doc.getText("body").toString();
    }finally{doc.destroy();}
  },
  async rejectConflictingRetry(entry){
    return createIndexedDbJournal().append(scope(),{...entry,base64:entry.base64.slice(0,-4)+"AAAA"});
  },
};