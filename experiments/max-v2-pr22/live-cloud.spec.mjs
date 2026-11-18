/** PR22 opt-in real Clerk/Convex evidence. NEVER run against production data.
 * Missing credentials throw: this suite never silently pretends cloud proof.
 */
import {test,expect} from "@playwright/test";
import {verifyRestore,verifyTranscript} from "../max-v2-pr21/recovery.mjs";
import {verifyCloudRecoveryEvidence} from "./recovery-evidence.mjs";

function config(names){
  const absent=names.filter(key=>!process.env[key]);
  if(absent.length)throw Error("REAL_PR22_CLOUD_EVIDENCE_NOT_RUN: "+absent.join(", "));
  return Object.fromEntries(names.map(k=>[k,process.env[k]]));
}
function safeUrl(raw){
  const url=new URL(raw);
  if(url.hostname==="max.chaos.fail" ||
     !["https:","http:"].includes(url.protocol) ||
     (url.protocol==="http:"&&!["127.0.0.1","localhost"].includes(url.hostname)))
    throw Error("SYNTHETIC_HTTPS_ONLY");
  return url.href;
}
async function launch(browser,url,state){
  const context=await browser.newContext({storageState:state});
  const page=await context.newPage();
  await page.goto(url);
  await expect.poll(async()=>Boolean(await page.evaluate(()=>window.__maxPr18?.read())),
    {timeout:60000}).toBe(true);
  await expect.poll(async()=> (await page.evaluate(()=>window.__maxPr18.read())).state)
    .toBe("online");
  await expect.poll(async()=>page.evaluate(()=>typeof window.__maxPr18?.captureTranscript))
    .toBe("function");
  return {context,page};
}
const meta=page=>page.evaluate(()=>window.__maxPr18.read());
const transcript=(page,throughSeq=null)=>page.evaluate(
  value=>window.__maxPr18.captureTranscript(value),throughSeq);
const checkpoint=page=>page.evaluate(()=>window.__maxPr18.checkpointStatus());
const pack=page=>page.evaluate(()=>window.__maxPr18.compactOnce());
async function packFully(page){
  let previous=0;
  for(let i=0;i<33;i++){
    const p=await pack(page);
    if(p.count===0||p.complete)return p;
    if(p.endSeq<=previous)throw Error("CHECKPOINT_NOT_ADVANCING");
    previous=p.endSeq;
  }
  throw Error("PACK_BOUND_EXCEEDED");
}
test("real concurrent editors and checkpoint fence retain every Yjs byte and reconnect",async({browser},info)=>{
  const env=config(["MAX_PR22_SOURCE_URL","MAX_PR22_ALICE_STATE",
    "MAX_PR22_BOB_STATE","MAX_PR22_GUEST_STATE","MAX_PR22_ALICE_ID",
    "MAX_PR22_BOB_ID","MAX_PR22_GUEST_ID"]);
  const url=safeUrl(env.MAX_PR22_SOURCE_URL),opened=[];
  try{
    for(const user of ["ALICE","BOB","GUEST"])
      opened.push(await launch(browser,url,env["MAX_PR22_"+user+"_STATE"]));
    const [alice,bob,guest]=opened.map(s=>s.page);
    const accounts=await Promise.all([alice,bob,guest].map(meta));
    expect(accounts.map(x=>x.accountId)).toEqual([
      env.MAX_PR22_ALICE_ID,env.MAX_PR22_BOB_ID,env.MAX_PR22_GUEST_ID]);
    expect(new Set(accounts.map(x=>x.accountId)).size).toBe(3);
    expect(accounts.map(x=>x.canEdit)).toEqual([true,true,false]);
    const initial=await transcript(guest);
    verifyTranscript(initial);
    await expect(bob.evaluate(()=>window.__maxPr18.compactOnce())).rejects.toThrow();
    await expect(guest.evaluate(()=>window.__maxPr18.checkpointStatus())).rejects.toThrow();
    for(let i=0;i<6;i++){
      const stamp="PR22 Concurrent اختبار "+Date.now()+" "+i;
      await Promise.all([
        alice.evaluate(x=>window.__maxPr18.insertText(x),stamp+" Alice"),
        bob.evaluate(x=>window.__maxPr18.insertText(x),stamp+" Bob"),
        pack(alice),
      ]);
    }
    await Promise.all([alice,bob].map(page=>expect.poll(async()=>
      (await meta(page)).pending).toBe(0)));
    const before=await transcript(bob);
    expect(before.headSeq).toBeGreaterThan(initial.headSeq);
    verifyTranscript(before);
    await packFully(alice);
    const proof=await checkpoint(alice);
    expect(proof.checkpointThrough).toBeGreaterThan(0);
    expect(proof.headSeq).toBe(before.headSeq);
    expect(proof.rawCount).toBe(0);
    const fromGuest=await transcript(guest,before.headSeq);
    const fingerprint=verifyRestore(before,fromGuest);
    await bob.reload();
    await expect.poll(async()=>(await meta(bob)).state,{timeout:60000}).toBe("online");
    const reopened=await transcript(bob,before.headSeq);
    verifyRestore(before,reopened);
    await info.attach("pr22-concurrent-cloud-evidence.json",{
      body:Buffer.from(JSON.stringify({
        syntheticOnly:true,independentClerkAccounts:3,
        headSeq:fingerprint.headSeq,sha256:fingerprint.sha256,
        checkpointThrough:proof.checkpointThrough,
        packCount:proof.packCount,readOnlyGuestDenied:true,
        verifiedReload:true,
      },null,2)),contentType:"application/json",
    });
  }finally{await Promise.all(opened.map(s=>s.context.close()));}
});

test("distinct restored cloud deployment matches source bytes and checkpoint structure",async({browser},info)=>{
  const env=config(["MAX_PR22_SOURCE_URL","MAX_PR22_RESTORED_URL",
    "MAX_PR22_ALICE_STATE","MAX_PR22_RESTORED_ALICE_STATE",
    "MAX_PR22_SOURCE_CONVEX_URL","MAX_PR22_RESTORED_CONVEX_URL",
    "MAX_PR22_BACKUP_EXPORT_REF","MAX_PR22_RESTORE_JOB_REF"]);
  const sourceUrl=safeUrl(env.MAX_PR22_SOURCE_URL);
  const restoredUrl=safeUrl(env.MAX_PR22_RESTORED_URL);
  if(sourceUrl===restoredUrl)throw Error("DISTINCT_FRONTENDS_REQUIRED");
  const source=await launch(browser,sourceUrl,env.MAX_PR22_ALICE_STATE);
  let restored;
  try{
    restored=await launch(browser,restoredUrl,env.MAX_PR22_RESTORED_ALICE_STATE);
    const a=await meta(source.page),b=await meta(restored.page);
    if(a.deploymentUrl!==env.MAX_PR22_SOURCE_CONVEX_URL ||
       b.deploymentUrl!==env.MAX_PR22_RESTORED_CONVEX_URL)
      throw Error("AUTHENTICATED_DEPLOYMENT_URL_MISMATCH");
    const [ta,tb,sa,sb]=await Promise.all([
      transcript(source.page),transcript(restored.page),
      checkpoint(source.page),checkpoint(restored.page)]);
    const proof=verifyCloudRecoveryEvidence({
      deploymentUrl:a.deploymentUrl,transcript:ta,checkpointStatus:sa,
    },{
      deploymentUrl:b.deploymentUrl,transcript:tb,checkpointStatus:sb,
    },{backupRef:env.MAX_PR22_BACKUP_EXPORT_REF,
       restoreRef:env.MAX_PR22_RESTORE_JOB_REF});
    await info.attach("pr22-independent-cloud-restore-evidence.json",{
      body:Buffer.from(JSON.stringify(proof,null,2)),
      contentType:"application/json",
    });
  }finally{
    await Promise.all([source.context.close(),restored?.context.close()].filter(Boolean));
  }
});
