/**
 * REAL (not mock) evidence runner. Deliberately excluded from automatic CI.
 * Requires separately provisioned synthetic Convex/Clerk sandbox, three
 * independent signed-in Playwright storageState files, and authorized fixtures.
 * A missing credential MUST fail, never skip or count as passing evidence.
 */
import {test,expect} from "@playwright/test";
const required=[
 "MAX_PR19_LIVE_URL","MAX_PR19_ALICE_STATE","MAX_PR19_BOB_STATE",
 "MAX_PR19_GUEST_STATE","MAX_PR19_ALICE_ID","MAX_PR19_BOB_ID","MAX_PR19_GUEST_ID",
];
function config(){
 const missing=required.filter(k=>!process.env[k]);
 if(missing.length)throw Error("REAL_MULTI_ACCOUNT_NOT_RUN: missing "+missing.join(", "));
 const url=new URL(process.env.MAX_PR19_LIVE_URL);
 if(!["https:","http:"].includes(url.protocol)||url.hostname==="max.chaos.fail"||
    (url.protocol!=="https:"&&!["localhost","127.0.0.1"].includes(url.hostname)))
    throw Error("Only a separate HTTPS synthetic sandbox (or local harness) is allowed");
 return url.href;
}
const read=page=>page.evaluate(()=>window.__maxPr18?.read());
const waitReady=async page=>{
 await expect.poll(async()=>Boolean(await read(page)),{timeout:60000}).toBe(true);
 await expect.poll(async()=> (await read(page)).state).toBe("online");
};
test("real independent Clerk identities: convergence, read-only guest, revocation, durable offline replay",async({browser},testInfo)=>{
 const url=config();
 const names=["ALICE","BOB","GUEST"];
 const contexts=[];
 try{
   for(const name of names){
     const context=await browser.newContext({storageState:process.env["MAX_PR19_"+name+"_STATE"]});
     const page=await context.newPage();
     await page.goto(url);
     contexts.push({name,context,page});
   }
   const [alice,bob,guest]=contexts.map(x=>x.page);
   await Promise.all([waitReady(alice),waitReady(bob),waitReady(guest)]);
   const initial=await Promise.all(contexts.map(x=>read(x.page)));
   for(let i=0;i<names.length;i++)
     expect(initial[i].accountId).toBe(process.env["MAX_PR19_"+names[i]+"_ID"]);
   expect(new Set(initial.map(x=>x.accountId)).size).toBe(3);
   expect(initial.map(x=>x.state)).toEqual(["online","online","online"]);
   expect(initial.map(x=>x.canEdit)).toEqual([true,true,false]);
   const marker="Live PR19 Arabic اختبار "+Date.now();
   const aliceBlock=await alice.evaluate(text=>window.__maxPr18.insertText(text),marker);
   await expect.poll(async()=>JSON.stringify((await read(bob)).document)).toContain(marker);
   await expect.poll(async()=>JSON.stringify((await read(guest)).document)).toContain(marker);
   await expect(guest.evaluate(()=>window.__maxPr18.insertText("FORBIDDEN_GUEST"))).rejects.toThrow();
   const bobMarker="Bob remote "+Date.now();
   await bob.evaluate(text=>window.__maxPr18.insertText(text),bobMarker);
   await expect.poll(async()=>JSON.stringify((await read(alice)).document)).toContain(bobMarker);
   // Real server grant downgrade must preserve view but remove editing,
   // without relying on Bob first attempting a forbidden write.
   await alice.evaluate(id=>window.__maxPr18.downgradeMemberEdit(id),process.env.MAX_PR19_BOB_ID);
   await expect.poll(async()=> (await read(bob)).canEdit).toBe(false);
   expect((await read(bob)).state).toBe("online");
   await expect(bob.evaluate(()=>window.__maxPr18.insertText("DENIED_AFTER_DOWNGRADE"))).rejects.toThrow();
   await expect.poll(async()=>JSON.stringify((await read(bob)).document)).toContain(marker);
   // This mutation must be evaluated by the actual server as the real owner.
   await alice.evaluate(id=>window.__maxPr18.revokeMember(id),process.env.MAX_PR19_BOB_ID);
   await expect.poll(async()=> (await read(bob)).state).toBe("blocked");
   expect((await read(bob)).canEdit).toBe(false);

   await alice.getByRole("button",{name:"Go offline"}).click();
   const offlineMarker="Persistent after reload "+Date.now();
   await alice.evaluate(text=>window.__maxPr18.insertText(text),offlineMarker);
   await alice.evaluate(()=>window.__maxPr18.persisted());
   expect((await read(alice)).pending).toBeGreaterThan(0);
   await alice.reload();
   await expect.poll(async()=>Boolean(await read(alice))).toBe(true);
   const afterRestart=await read(alice);
   expect(afterRestart.pending).toBeGreaterThan(0);
   expect(afterRestart.state).not.toBe("online"); // no replay without review
   const download=alice.waitForEvent("download");
   alice.once("dialog",dialog=>dialog.accept());
   await alice.getByRole("button",{name:"Review, export & reconnect"}).click();
   const saved=await download;
   expect(saved.suggestedFilename()).toMatch(/\.yjs$/);
   await expect.poll(async()=> (await read(alice)).pending).toBe(0);
   await expect.poll(async()=>JSON.stringify((await read(guest)).document)).toContain(offlineMarker);
   await testInfo.attach("pr19-live-public-evidence.json",{
     body:Buffer.from(JSON.stringify({
       distinctAuthenticatedAccounts:3,guestDenied:true,bobRevoked:true,
       aliceBlock,offlineExport:saved.suggestedFilename(),replayAfterManualReview:true,
       finalServerCursor:(await read(alice)).cursor,
     },null,2)),contentType:"application/json",
   });
 }finally{
   await Promise.all(contexts.map(x=>x.context.close()));
 }
});
