import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {convexTest} from "convex-test";
import {makeFunctionReference} from "convex/server";
import schema from "../../experiments/max-v2-pr17/convex/schema";
const modules={
  "./_generated/api.ts":async()=>({}),
  "./provider.ts":()=>import("../../experiments/max-v2-pr17/convex/provider"),
};
const m=(name:string)=>makeFunctionReference<"mutation">("provider:"+name);
const q=(name:string)=>makeFunctionReference<"query">("provider:"+name);
const join=m("join"),create=m("createSuggestion"),review=m("reviewSuggestion"),
  leave=m("leave"),revoke=m("revokeMember");
const list=q("listSuggestions"),access=q("suggestionAccess");
const workspaceId="lab-workspace",pageId="lab-page";
let originalFlag:string|undefined;
beforeEach(()=>{originalFlag=process.env.MAX_V2_PR17_PROVIDER_SANDBOX;process.env.MAX_V2_PR17_PROVIDER_SANDBOX="true";});
afterEach(()=>{if(originalFlag===undefined)delete process.env.MAX_V2_PR17_PROVIDER_SANDBOX;else process.env.MAX_V2_PR17_PROVIDER_SANDBOX=originalFlag;});
async function setup(){
  const t=convexTest(schema,modules);
  await t.run(async ctx=>{
    await ctx.db.insert("workspaces",{workspaceId,ownerId:"alice",status:"active"});
    for(const [accountId,role] of [["alice","owner"],["bob","member"],["carol","guest"],["dave","member"]] as const)
      await ctx.db.insert("workspaceMemberships",{workspaceId,accountId,role,status:"active"});
    await ctx.db.insert("workspacePageScopes",{workspaceId,pageId,parentId:null,teamspaceId:null});
    await ctx.db.insert("workspacePageScopes",{workspaceId,pageId:"other-page",parentId:null,teamspaceId:null});
    for(const [subjectId,level] of [["bob","edit_content"],["carol","view"],["dave","comment"]] as const)
      await ctx.db.insert("workspacePageGrants",{workspaceId,pageId,subjectType:"account",subjectId,effect:"allow",level});
  });
  const alice=t.withIdentity({subject:"alice",tokenIdentifier:"pr27|alice"});
  const bob=t.withIdentity({subject:"bob",tokenIdentifier:"pr27|bob"});
  const carol=t.withIdentity({subject:"carol",tokenIdentifier:"pr27|carol"});
  const dave=t.withIdentity({subject:"dave",tokenIdentifier:"pr27|dave"});
  const outsider=t.withIdentity({subject:"outsider",tokenIdentifier:"pr27|outsider"});
  const a=await alice.mutation(join,{workspaceId,pageId});
  const b=await bob.mutation(join,{workspaceId,pageId});
  const c=await carol.mutation(join,{workspaceId,pageId});
  const d=await dave.mutation(join,{workspaceId,pageId});
  const other=await alice.mutation(join,{workspaceId,pageId:"other-page"});
  return {t,alice,bob,carol,dave,outsider,a,b,c,d,other};
}
const proposal=(sessionId:any,operationId="proposeoperation001")=>({
  sessionId,blockId:"stable-block-1",originalText:"Original paragraph",
  replacementText:"محتوى بديل",note:"Improve clarity",expectedHeadSeq:0,operationId,
});
const judgment=(sessionId:any,suggestionId:any,decision:"accept"|"reject"="accept",operationId="reviewoperation001")=>({
  sessionId,suggestionId,decision,expectedRevision:1,expectedHeadSeq:0,operationId,
});
describe("PR27 suggestion + review sandbox",()=>{
  it("commenters can propose, guests can read but cannot propose or review",async()=>{
    const {alice,carol,dave,a,c,d}=await setup();
    expect(await dave.query(access,{sessionId:d.sessionId})).toEqual({canSuggest:true,canReview:false});
    expect(await carol.query(access,{sessionId:c.sessionId})).toEqual({canSuggest:false,canReview:false});
    const created=await dave.mutation(create,proposal(d.sessionId));
    expect(created.duplicate).toBe(false);
    expect(await alice.query(list,{sessionId:a.sessionId}))
      .toMatchObject([{blockId:"stable-block-1",status:"pending",proposedBy:"dave",baseSeq:0}]);
    expect(await carol.query(list,{sessionId:c.sessionId})).toHaveLength(1);
    await expect(carol.mutation(create,proposal(c.sessionId))).rejects.toThrow();
    await expect(dave.mutation(review,judgment(d.sessionId,created.suggestionId))).rejects.toThrow();
  });
  it("authorized editor reviews other author without modifying the Yjs log",async()=>{
    const {t,bob,dave,b,d}=await setup();
    const created=await dave.mutation(create,proposal(d.sessionId));
    expect(await bob.query(access,{sessionId:b.sessionId})).toEqual({canSuggest:true,canReview:true});
    expect((await bob.query(list,{sessionId:b.sessionId}))[0].canReview).toBe(true);
    const approved=await bob.mutation(review,judgment(b.sessionId,created.suggestionId));
    expect(approved).toEqual({status:"accepted",revision:2,duplicate:false});
    const evidence=await t.run(async ctx=>({
      updates:await ctx.db.query("labUpdates").collect(),
      threads:await ctx.db.query("labCommentThreads").collect(),
      suggestions:await ctx.db.query("labSuggestions").collect(),
    }));
    expect(evidence.updates).toHaveLength(0);
    expect(evidence.threads).toHaveLength(0);
    expect(evidence.suggestions[0]).toMatchObject({status:"accepted",baseSeq:0});
  });
  it("cannot self-approve without manage permission; owner may review own proposal",async()=>{
    const {bob,alice,b,a}=await setup();
    const one=await bob.mutation(create,proposal(b.sessionId));
    expect((await bob.query(list,{sessionId:b.sessionId}))[0].canReview).toBe(false);
    await expect(bob.mutation(review,judgment(b.sessionId,one.suggestionId))).rejects.toThrow();
    expect((await alice.mutation(review,judgment(a.sessionId,one.suggestionId))).status).toBe("accepted");
    const two=await alice.mutation(create,proposal(a.sessionId,"ownerpropose001"));
    expect((await alice.mutation(review,judgment(a.sessionId,two.suggestionId,"reject","ownerreview001"))).status)
      .toBe("rejected");
  });
  it("rejects invalid anchors, same-text, oversized content and malformed operation IDs",async()=>{
    const {t,dave,d}=await setup();
    for(const overrides of [
      {blockId:"bad/block"},{replacementText:"Original paragraph"},
      {replacementText:"  "},{replacementText:"x".repeat(2001)},
      {note:"n".repeat(501)},{operationId:"bad!"},{expectedHeadSeq:-1},
      {originalText:"\u0001"}
    ])await expect(dave.mutation(create,{...proposal(d.sessionId),...overrides})).rejects.toThrow();
    expect(await t.run(async ctx=>ctx.db.query("labSuggestions").collect())).toHaveLength(0);
  });
  it("idempotent retries do not duplicate proposals or decisions, conflicting reuse is forbidden",async()=>{
    const {dave,bob,d,b,t}=await setup();
    const first=await dave.mutation(create,proposal(d.sessionId));
    expect(await dave.mutation(create,proposal(d.sessionId))).toEqual({...first,duplicate:true});
    await expect(dave.mutation(create,{...proposal(d.sessionId),replacementText:"different"})).rejects.toThrow();
    const approved=await bob.mutation(review,judgment(b.sessionId,first.suggestionId));
    expect(await bob.mutation(review,judgment(b.sessionId,first.suggestionId)))
      .toEqual({...approved,duplicate:true});
    await expect(bob.mutation(review,judgment(b.sessionId,first.suggestionId,"reject"))).rejects.toThrow();
    expect(await t.run(async ctx=>ctx.db.query("labSuggestions").collect())).toHaveLength(1);
  });
  it("review OCC rejects stale revision and a changed Yjs log head; reject remains possible",async()=>{
    const {t,bob,dave,b,d}=await setup();
    const made=await dave.mutation(create,proposal(d.sessionId));
    await t.run(async ctx=>{
      const rows=await ctx.db.query("labRooms").collect();
      await ctx.db.patch(rows[0]._id,{nextSeq:1});
    }); // Simulates another Yjs append; the PR27 server reads the room head.
    await expect(bob.mutation(review,judgment(b.sessionId,made.suggestionId))).rejects.toThrow();
    const rejected=await bob.mutation(review,judgment(b.sessionId,made.suggestionId,"reject"));
    expect(rejected.status).toBe("rejected");
    await expect(bob.mutation(review,{...judgment(b.sessionId,made.suggestionId),
      expectedRevision:2,operationId:"differentreview01"})).rejects.toThrow();
    await expect(dave.mutation(create,proposal(d.sessionId,"newproposal001"))).rejects.toThrow();
  });
  it("does not allow cross-room use, session impersonation or revoked writes",async()=>{
    const {alice,bob,dave,outsider,a,b,d,other}=await setup();
    const made=await dave.mutation(create,proposal(d.sessionId));
    await expect(bob.query(list,{sessionId:a.sessionId})).rejects.toThrow();
    await expect(outsider.query(list,{sessionId:d.sessionId})).rejects.toThrow();
    await expect(alice.mutation(review,judgment(other.sessionId,made.suggestionId))).rejects.toThrow();
    await alice.mutation(revoke,{workspaceId,pageId,targetAccountId:"dave"});
    await expect(dave.query(list,{sessionId:d.sessionId})).rejects.toThrow();
    await expect(dave.mutation(create,proposal(d.sessionId,"revokedpropose01"))).rejects.toThrow();
    expect((await bob.query(list,{sessionId:b.sessionId}))[0].proposedBy).toBeNull();
  });
  it("offline/revoked sessions and disabled feature flag fail closed",async()=>{
    const {alice,dave,a,d,t}=await setup();
    const made=await dave.mutation(create,proposal(d.sessionId));
    await dave.mutation(leave,{sessionId:d.sessionId});
    await expect(dave.query(list,{sessionId:d.sessionId})).rejects.toThrow();
    await t.run(async ctx=>{
      const sessions=await ctx.db.query("labSessions").collect();
      for(const s of sessions)await ctx.db.patch(s._id,{expiresAt:Date.now()-1000});
    });
    await expect(alice.mutation(review,judgment(a.sessionId,made.suggestionId))).rejects.toThrow();
    process.env.MAX_V2_PR17_PROVIDER_SANDBOX="false";
    await expect(alice.query(access,{sessionId:a.sessionId})).rejects.toThrow();
  });
});
