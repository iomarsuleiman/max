
/** PR22: compares two independently captured synthetic Convex restore streams.
 * Operator-supplied backup/restore references are NOT verified as real jobs. */
import {verifyRestore} from "../max-v2-pr21/recovery.mjs";

const VALID_CONVEX=/^https:\/\/[a-z0-9-]+\.convex\.cloud$/;
const REF=/^[A-Za-z0-9][A-Za-z0-9._:/-]{7,199}$/;
function validStatus(s,t){
  if(!s||!Number.isSafeInteger(s.headSeq)||!Number.isSafeInteger(s.checkpointThrough)||
     !Number.isSafeInteger(s.packCount)||!Number.isSafeInteger(s.rawCount)||
     !Number.isSafeInteger(s.storedBytes)||s.headSeq<1||s.headSeq>256||
     s.checkpointThrough<0||s.checkpointThrough>s.headSeq||
     s.packCount<0||s.packCount>256||s.rawCount<0||s.rawCount>256||
     s.storedBytes<1||s.storedBytes>1024*1024||s.headSeq!==t.headSeq||
     s.packCount>s.checkpointThrough||
     s.rawCount!==s.headSeq-s.checkpointThrough)throw Error("BAD_CHECKPOINT_STATUS");
}
export function verifyCloudRecoveryEvidence(source,restored,{backupRef,restoreRef}={}){
  if(!source||!restored||!VALID_CONVEX.test(source.deploymentUrl)||
     !VALID_CONVEX.test(restored.deploymentUrl)||
     source.deploymentUrl===restored.deploymentUrl)
    throw Error("DISTINCT_SANDBOX_DEPLOYMENTS_REQUIRED");
  if(typeof backupRef!=="string"||!REF.test(backupRef)||
     typeof restoreRef!=="string"||!REF.test(restoreRef))
    throw Error("OPERATOR_REFERENCES_REQUIRED");
  const transcript=verifyRestore(source.transcript,restored.transcript);
  validStatus(source.checkpointStatus,source.transcript);
  validStatus(restored.checkpointStatus,restored.transcript);
  const keys=["headSeq","checkpointThrough","packCount","rawCount","storedBytes"];
  if(keys.some(key=>source.checkpointStatus[key]!==restored.checkpointStatus[key]))
    throw Error("CHECKPOINT_STRUCTURE_MISMATCH");
  return {stream:transcript,sourceDeployment:source.deploymentUrl,
    restoredDeployment:restored.deploymentUrl,
    checkpointStatus:source.checkpointStatus,backupRef,restoreRef,
    operatorReferencesUnverified:true};
}
