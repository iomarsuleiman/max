import {test} from "node:test";
import assert from "node:assert/strict";
import {verifyCloudRecoveryEvidence} from "./recovery-evidence.mjs";
const transcript=()=>({scope:{workspaceId:"lab-workspace",pageId:"lab-page"},
  headSeq:3,pages:[{headSeq:3,hasMore:false,
    updates:[1,2,3].map(seq=>({seq,actorId:"alice",
      operationId:"backup_000"+seq,base64:"AQIDBA=="}))}]});
const input=url=>({deploymentUrl:url,transcript:transcript(),
  checkpointStatus:{headSeq:3,checkpointThrough:2,packCount:1,rawCount:1,storedBytes:9}});
const source=input("https://max-pr22-source.convex.cloud");
const restore=input("https://max-pr22-restored.convex.cloud");
const refs={backupRef:"backup-export-0001",restoreRef:"restore-job-0001"};
test("independent deployment restore has exact bytes and matching packed/raw structure",()=>{
  const proof=verifyCloudRecoveryEvidence(source,restore,refs);
  assert.equal(proof.stream.headSeq,3);
  assert.equal(proof.operatorReferencesUnverified,true);
});
test("duplicate host, absent refs, truncated/changed bytes and wrong packed counts fail",()=>{
  assert.throws(()=>verifyCloudRecoveryEvidence(source,source,refs));
  assert.throws(()=>verifyCloudRecoveryEvidence(source,restore,{backupRef:"",restoreRef:""}));
  for(const mutate of [
    x=>x.checkpointStatus.checkpointThrough=0,
    x=>x.checkpointStatus.packCount=0,
    x=>x.checkpointStatus.storedBytes=14,
    x=>x.transcript.pages[0].updates.pop(),
    x=>x.transcript.pages[0].updates[0].base64="Aw==",
    x=>x.deploymentUrl="https://max.chaos.fail",
  ]){
    const altered=structuredClone(restore);mutate(altered);
    assert.throws(()=>verifyCloudRecoveryEvidence(source,altered,refs));
  }
});
