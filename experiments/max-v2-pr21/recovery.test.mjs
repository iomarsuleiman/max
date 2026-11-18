import {test} from "node:test";
import assert from "node:assert/strict";
import {verifyTranscript,verifyRestore} from "./recovery.mjs";
const update=(seq,base64="AQIDBA==")=>({seq,actorId:"alice",operationId:"backup_000"+seq,base64});
const fixture=()=>({scope:{workspaceId:"lab-workspace",pageId:"lab-page"},
  headSeq:3,pages:[{headSeq:3,hasMore:true,updates:[update(1),update(2)]},
                   {headSeq:3,hasMore:false,updates:[update(3)]}]});
test("matching backup and restored streams retain SHA-256 byte parity",()=>{
  const a=fixture(),b=structuredClone(a);
  assert.equal(verifyTranscript(a).headSeq,3);
  assert.deepEqual(verifyRestore(a,b),verifyTranscript(a));
});
test("missing, duplicated, corrupted, cross-scope and out-of-order data fails closed",()=>{
  const before=fixture();
  for(const corrupt of [
    x=>x.pages.pop(),
    x=>x.pages[0].updates[1].seq=4,
    x=>x.pages[1].updates[0].operationId="backup_0001",
    x=>x.pages[0].hasMore=false,
    x=>x.pages[0].updates[0].base64="AQ==",
    x=>x.scope.workspaceId="other-workspace",
    x=>x.headSeq=4,
  ]) {
    const altered=structuredClone(before);corrupt(altered);
    assert.throws(()=>verifyRestore(before,altered));
  }
});
