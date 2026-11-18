import {afterEach,beforeEach,describe,expect,it} from "vitest";
import {convexTest} from "convex-test";
import {makeFunctionReference} from "convex/server";
import schema from "../../experiments/max-v2-pr17/convex/schema";

const modules={
  "./_generated/api.ts":async()=>({}),
  "./provider.ts":()=>import("../../experiments/max-v2-pr17/convex/provider"),
};
const mutation=(name:string)=>makeFunctionReference<"mutation">("provider:"+name);
const query=(name:string)=>makeFunctionReference<"query">("provider:"+name);
const join=mutation("join"), create=mutation("createCommentThread");
const reply=mutation("replyToCommentThread"), resolve=mutation("resolveCommentThread");
const propose=mutation("createSuggestion"), review=mutation("reviewSuggestion");
const revoke=mutation("revokeMember"), activity=query("listRoomActivity");
const workspaceId="activity-workspace",pageId="activity-page";
let oldFlag:string|undefined;
beforeEach(()=>{oldFlag=process.env.MAX_V2_PR17_PROVIDER_SANDBOX;
  process.env.MAX_V2_PR17_PROVIDER_SANDBOX="true";});
afterEach(()=>{if(oldFlag===undefined)delete process.env.MAX_V2_PR17_PROVIDER_SANDBOX;
  else process.env.MAX_V2_PR17_PROVIDER_SANDBOX=oldFlag;});

async function setup(){
  const t=convexTest(schema,modules);
  await t.run(async ctx=>{
    await ctx.db.insert("workspaces",{workspaceId,ownerId:"alice",status:"active"});
    for(const [accountId,role] of [
      ["alice","owner"],["bob","member"],["dave","member"],["carol","guest"],
    ] as const)
      await ctx.db.insert("workspaceMemberships",{workspaceId,accountId,role,status:"active"});
    for(const id of [pageId,"second-page"])
      await ctx.db.insert("workspacePageScopes",{workspaceId,pageId:id,parentId:null,teamspaceId:null});
    for(const [subjectId,level] of [["bob","edit_content"],["dave","comment"],["carol","view"]] as const)
      await ctx.db.insert("workspacePageGrants",{workspaceId,pageId,subjectType:"account",
        subjectId,effect:"allow",level});
  });
  const alice=t.withIdentity({subject:"alice",tokenIdentifier:"pr29|alice"});
  const bob=t.withIdentity({subject:"bob",tokenIdentifier:"pr29|bob"});
  const dave=t.withIdentity({subject:"dave",tokenIdentifier:"pr29|dave"});
  const carol=t.withIdentity({subject:"carol",tokenIdentifier:"pr29|carol"});
  const outsider=t.withIdentity({subject:"outsider",tokenIdentifier:"pr29|outsider"});
  const a=await alice.mutation(join,{workspaceId,pageId});
  const b=await bob.mutation(join,{workspaceId,pageId});
  const d=await dave.mutation(join,{workspaceId,pageId});
  const c=await carol.mutation(join,{workspaceId,pageId});
  const second=await alice.mutation(join,{workspaceId,pageId:"second-page"});
  return {t,alice,bob,dave,carol,outsider,a,b,c,d,second};
}
const createArgs=(sessionId:any)=>({sessionId,blockId:"block-29",
  body:"PRIVATE COMMENT CONTENT",mentions:["bob"],operationId:"pr29create001"});
const proposeArgs=(sessionId:any)=>({sessionId,blockId:"block-29",
  originalText:"PRIVATE ORIGINAL",replacementText:"PRIVATE PROPOSAL",note:"PRIVATE REASON",
  expectedHeadSeq:0,operationId:"pr29propose001"});

describe("PR29 bounded metadata-only room activity",()=>{
  it("records actions in the same mutation without content or Yjs modifications",async()=>{
    const {t,alice,bob,dave,carol,a,b,c,d}=await setup();
    const thread=await dave.mutation(create,createArgs(d.sessionId));
    await bob.mutation(reply,{sessionId:b.sessionId,threadId:thread.threadId,
      body:"PRIVATE REPLY",mentions:[],operationId:"pr29reply001"});
    await dave.mutation(resolve,{sessionId:d.sessionId,threadId:thread.threadId,
      expectedRevision:1,resolved:true});
    await dave.mutation(resolve,{sessionId:d.sessionId,threadId:thread.threadId,
      expectedRevision:2,resolved:false});
    const proposal=await dave.mutation(propose,proposeArgs(d.sessionId));
    await bob.mutation(review,{sessionId:b.sessionId,suggestionId:proposal.suggestionId,
      expectedRevision:1,expectedHeadSeq:0,decision:"accept",operationId:"pr29review001"});
    const view=await carol.query(activity,{sessionId:c.sessionId});
    expect(view.map((v:{kind:string})=>v.kind)).toEqual([
      "suggestion_accepted","suggestion_proposed","thread_reopened",
      "thread_resolved","thread_replied","thread_opened"]);
    expect(view[0].actorId).toBe("bob");
    expect(JSON.stringify(view)).not.toMatch(/PRIVATE|pr29create001|pr29review001/);
    expect(await t.run(ctx=>ctx.db.query("labUpdates").collect())).toHaveLength(0);
    expect(await alice.query(activity,{sessionId:a.sessionId})).toHaveLength(6);
  });
  it("source retries never add duplicate activity or duplicate decisions",async()=>{
    const {t,dave,bob,d,b}=await setup();
    const args=createArgs(d.sessionId);
    await dave.mutation(create,args);
    await dave.mutation(create,args);
    const prop=await dave.mutation(propose,proposeArgs(d.sessionId));
    await dave.mutation(propose,proposeArgs(d.sessionId));
    const reviewArgs={sessionId:b.sessionId,suggestionId:prop.suggestionId,
      expectedRevision:1,expectedHeadSeq:0,decision:"reject" as const,operationId:"pr29review002"};
    await bob.mutation(review,reviewArgs);
    await bob.mutation(review,reviewArgs);
    expect((await bob.query(activity,{sessionId:b.sessionId})).map((v:{kind:string})=>v.kind))
      .toEqual(["suggestion_rejected","suggestion_proposed","thread_opened"]);
    expect(await t.run(ctx=>ctx.db.query("labRoomActivity").collect())).toHaveLength(3);
  });
  it("read requires own valid room/session and active permission",async()=>{
    const {t,alice,bob,dave,outsider,a,b,d,second}=await setup();
    await dave.mutation(create,createArgs(d.sessionId));
    await expect(outsider.query(activity,{sessionId:b.sessionId})).rejects.toThrow();
    await expect(dave.query(activity,{sessionId:b.sessionId})).rejects.toThrow();
    expect(await alice.query(activity,{sessionId:second.sessionId})).toHaveLength(0);
    await alice.mutation(revoke,{workspaceId,pageId,targetAccountId:"bob"});
    await expect(bob.query(activity,{sessionId:b.sessionId})).rejects.toThrow();
    await t.run(async ctx=>{
      const session=await ctx.db.get(a.sessionId);
      if(session)await ctx.db.patch(session._id,{expiresAt:Date.now()-1000});
    });
    await expect(alice.query(activity,{sessionId:a.sessionId})).rejects.toThrow();
  });
  it("redacts revoked actors and fails closed with disabled sandbox",async()=>{
    const {alice,bob,dave,b,d}=await setup();
    await dave.mutation(create,createArgs(d.sessionId));
    await alice.mutation(revoke,{workspaceId,pageId,targetAccountId:"dave"});
    const view=await bob.query(activity,{sessionId:b.sessionId});
    expect(view[0].actorId).toBeNull();
    process.env.MAX_V2_PR17_PROVIDER_SANDBOX="false";
    await expect(bob.query(activity,{sessionId:b.sessionId})).rejects.toThrow();
  });
  it("evicts oldest only in its own room, retains 128 and returns latest 40",async()=>{
    const {t,dave,bob,d,b}=await setup();
    await t.run(async ctx=>{
      const rooms=await ctx.db.query("labRooms").collect();
      const room=rooms.find(v=>v.pageId===pageId)!;
      const other=rooms.find(v=>v.pageId==="second-page")!;
      for(let i=0;i<128;i++)
        await ctx.db.insert("labRoomActivity",{roomId:room._id,actorId:"dave",
          kind:"thread_opened",targetId:"seed"+i,createdAt:i});
      await ctx.db.insert("labRoomActivity",{roomId:other._id,actorId:"alice",
        kind:"thread_opened",targetId:"independent",createdAt:1});
    });
    await dave.mutation(create,createArgs(d.sessionId));
    const items=await bob.query(activity,{sessionId:b.sessionId});
    expect(items).toHaveLength(40);
    expect(items[0].kind).toBe("thread_opened");
    const stored=await t.run(ctx=>ctx.db.query("labRoomActivity").collect());
    expect(stored).toHaveLength(129);
    expect(stored.some(row=>row.targetId==="seed0")).toBe(false);
    expect(stored.some(row=>row.targetId==="independent")).toBe(true);
  });
});
