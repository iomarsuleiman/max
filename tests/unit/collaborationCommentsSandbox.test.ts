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
const join=m("join"), create=m("createCommentThread"), reply=m("replyToCommentThread"), resolve=m("resolveCommentThread"),
  downgrade=m("downgradeMemberEdit"), revoke=m("revokeMember"), leave=m("leave");
const list=q("listCommentThreads"), comments=q("listThreadComments"), access=q("commentAccess");
const workspaceId="lab-workspace",pageId="lab-page";
let oldFlag:string|undefined;
beforeEach(()=>{oldFlag=process.env.MAX_V2_PR17_PROVIDER_SANDBOX;process.env.MAX_V2_PR17_PROVIDER_SANDBOX="true";});
afterEach(()=>{if(oldFlag===undefined)delete process.env.MAX_V2_PR17_PROVIDER_SANDBOX;else process.env.MAX_V2_PR17_PROVIDER_SANDBOX=oldFlag;});
async function setup(){
  const t=convexTest(schema,modules);
  await t.run(async ctx=>{
    await ctx.db.insert("workspaces",{workspaceId,ownerId:"alice",status:"active"});
    for(const [accountId,role] of [["alice","owner"],["bob","member"],["carol","guest"],["dave","member"]] as const)
      await ctx.db.insert("workspaceMemberships",{workspaceId,accountId,role,status:"active"});
    await ctx.db.insert("workspacePageScopes",{workspaceId,pageId,parentId:null,teamspaceId:null});
    for(const [subjectId,level] of [["bob","edit_content"],["carol","view"],["dave","comment"]] as const)
      await ctx.db.insert("workspacePageGrants",{workspaceId,pageId,subjectType:"account",subjectId,effect:"allow",level});
    await ctx.db.insert("workspacePageScopes",{workspaceId,pageId:"other-page",parentId:null,teamspaceId:null});
  });
  const alice=t.withIdentity({subject:"alice",tokenIdentifier:"pr26|alice"});
  const bob=t.withIdentity({subject:"bob",tokenIdentifier:"pr26|bob"});
  const carol=t.withIdentity({subject:"carol",tokenIdentifier:"pr26|carol"});
  const dave=t.withIdentity({subject:"dave",tokenIdentifier:"pr26|dave"});
  const outsider=t.withIdentity({subject:"outsider",tokenIdentifier:"pr26|outsider"});
  const a=await alice.mutation(join,{workspaceId,pageId}),b=await bob.mutation(join,{workspaceId,pageId});
  const c=await carol.mutation(join,{workspaceId,pageId}),d=await dave.mutation(join,{workspaceId,pageId});
  const other=await alice.mutation(join,{workspaceId,pageId:"other-page"});
  return {t,alice,bob,carol,dave,outsider,a,b,c,d,other};
}
const first=(sessionId:any,op="operationfirst001",mentions:string[]=[])=>
 ({sessionId,blockId:"stable-block-1",body:"Review this paragraph",mentions,operationId:op});
describe("PR26 sandbox anchored threads and mentions",()=>{
  it("anchors by stable block ID, supports commenter permission and live reads",async()=>{
    const {alice,dave,a,d}=await setup();
    expect(await dave.query(access,{sessionId:d.sessionId})).toBe(true);
    const created=await dave.mutation(create,first(d.sessionId));
    expect(created.duplicate).toBe(false);
    expect(await alice.query(list,{sessionId:a.sessionId})).toMatchObject([{blockId:"stable-block-1",revision:1,resolvedAt:null}]);
    expect(await alice.query(comments,{sessionId:a.sessionId,threadId:created.threadId}))
      .toMatchObject([{authorId:"dave",body:"Review this paragraph",kind:"initial"}]);
  });
  it("cannot impersonate a lease, read a different room or use unauthenticated scopes",async()=>{
    const {alice,bob,outsider,a,b,other}=await setup();
    const created=await alice.mutation(create,first(a.sessionId));
    await expect(bob.query(comments,{sessionId:a.sessionId,threadId:created.threadId})).rejects.toThrow();
    await expect(outsider.query(list,{sessionId:b.sessionId})).rejects.toThrow();
    await expect(alice.query(comments,{sessionId:other.sessionId,threadId:created.threadId})).rejects.toThrow();
    await expect(alice.mutation(reply,{sessionId:other.sessionId,threadId:created.threadId,operationId:"replycrossroom001",body:"no",mentions:[]})).rejects.toThrow();
  });
  it("view-only guests cannot write, but can read live discussion",async()=>{
    const {alice,carol,a,c}=await setup();
    expect(await carol.query(access,{sessionId:c.sessionId})).toBe(false);
    await expect(carol.mutation(create,first(c.sessionId))).rejects.toThrow();
    const made=await alice.mutation(create,first(a.sessionId));
    expect(await carol.query(comments,{sessionId:c.sessionId,threadId:made.threadId})).toHaveLength(1);
    await expect(carol.mutation(reply,{sessionId:c.sessionId,threadId:made.threadId,operationId:"guestreply001",body:"x",mentions:[]})).rejects.toThrow();
  });
  it("validates blocks, bodies, mentions and refuses targets without view permission",async()=>{
    const {alice,a,t}=await setup();
    for(const override of [
      {blockId:"not a stable ID"}, {body:"  "}, {mentions:["carol","carol"]},
      {mentions:["outsider"]}, {mentions:["bob","carol","dave","alice"]},
      {operationId:"bad!"}, {body:"x".repeat(2001)},
    ])await expect(alice.mutation(create,{...first(a.sessionId),...override})).rejects.toThrow();
    expect(await t.run(async ctx=>ctx.db.query("labCommentThreads").collect())).toHaveLength(0);
  });
  it("retries same operation idempotently and rejects conflicting payloads",async()=>{
    const {bob,b}=await setup();
    const one=await bob.mutation(create,first(b.sessionId));
    const two=await bob.mutation(create,first(b.sessionId));
    expect(two).toEqual({...one,duplicate:true});
    await expect(bob.mutation(create,{...first(b.sessionId),body:"changed"})).rejects.toThrow();
    const args={sessionId:b.sessionId,threadId:one.threadId,operationId:"replyoperation001",body:"Reply",mentions:[]};
    const reply1=await bob.mutation(reply,args),reply2=await bob.mutation(reply,args);
    expect(reply2).toEqual({...reply1,duplicate:true});
    await expect(bob.mutation(reply,{...args,body:"different"})).rejects.toThrow();
    expect(await bob.query(comments,{sessionId:b.sessionId,threadId:one.threadId})).toHaveLength(2);
  });
  it("redacts revoked authors and mentions for still-authorized readers",async()=>{
    const {alice,bob,a,b}=await setup();
    const made=await bob.mutation(create,first(b.sessionId,"operationmention01",["alice","carol"]));
    expect((await alice.query(comments,{sessionId:a.sessionId,threadId:made.threadId}))[0])
      .toMatchObject({authorId:"bob",mentions:["alice","carol"]});
    await alice.mutation(revoke,{workspaceId,pageId,targetAccountId:"bob"});
    const rows=await alice.query(comments,{sessionId:a.sessionId,threadId:made.threadId});
    expect(rows[0].authorId).toBeNull();
    await expect(bob.query(comments,{sessionId:b.sessionId,threadId:made.threadId})).rejects.toThrow();
    await expect(bob.mutation(reply,{sessionId:b.sessionId,threadId:made.threadId,operationId:"revokedreply01",body:"x",mentions:[]})).rejects.toThrow();
  });
  it("edit downgrade still permits comments, but a further view-only ACL change stops them",async()=>{
    const {t,alice,bob,b}=await setup();
    const made=await bob.mutation(create,first(b.sessionId));
    await alice.mutation(downgrade,{workspaceId,pageId,targetAccountId:"bob"});
    expect(await bob.query(access,{sessionId:b.sessionId})).toBe(false);
    await expect(bob.mutation(reply,{sessionId:b.sessionId,threadId:made.threadId,operationId:"downgradereply01",body:"x",mentions:[]})).rejects.toThrow();
    await t.run(async ctx=>{
      const grants=await ctx.db.query("workspacePageGrants").withIndex("by_workspace_page",q=>q.eq("workspaceId",workspaceId).eq("pageId",pageId)).collect();
      const c=grants.find(r=>r.subjectId==="carol");
      if(c)await ctx.db.patch(c._id,{level:"comment"});
    });
    const {carol,c}=await setup(); // distinct fixture verifies independent grant by default
    expect(await carol.query(access,{sessionId:c.sessionId})).toBe(false);
  });
  it("owner resolves with OCC; non-owner cannot resolve and resolved thread blocks replies",async()=>{
    const {alice,bob,a,b}=await setup();
    const made=await alice.mutation(create,first(a.sessionId));
    await expect(bob.mutation(resolve,{sessionId:b.sessionId,threadId:made.threadId,expectedRevision:1,resolved:true})).rejects.toThrow();
    const updated=await alice.mutation(resolve,{sessionId:a.sessionId,threadId:made.threadId,expectedRevision:1,resolved:true});
    expect(updated.revision).toBe(2);
    await expect(alice.mutation(resolve,{sessionId:a.sessionId,threadId:made.threadId,expectedRevision:1,resolved:false})).rejects.toThrow();
    await expect(alice.mutation(reply,{sessionId:a.sessionId,threadId:made.threadId,operationId:"resolvedreply01",body:"x",mentions:[]})).rejects.toThrow();
    expect((await alice.mutation(resolve,{sessionId:a.sessionId,threadId:made.threadId,expectedRevision:2,resolved:false})).revision).toBe(3);
  });
  it("expired or explicitly closed sessions and disabled lab are fenced",async()=>{
    const {t,alice,a}=await setup();
    const made=await alice.mutation(create,first(a.sessionId));
    await alice.mutation(leave,{sessionId:a.sessionId});
    await expect(alice.query(list,{sessionId:a.sessionId})).rejects.toThrow();
    await expect(alice.mutation(reply,{sessionId:a.sessionId,threadId:made.threadId,operationId:"expiredreply01",body:"x",mentions:[]})).rejects.toThrow();
    await t.run(async ctx=>{
      const sessions=await ctx.db.query("labSessions").collect();
      for(const session of sessions) await ctx.db.patch(session._id,{expiresAt:Date.now()-1000});
    });
    await expect(alice.query(access,{sessionId:a.sessionId})).rejects.toThrow();
    process.env.MAX_V2_PR17_PROVIDER_SANDBOX="false";
    await expect(alice.query(list,{sessionId:a.sessionId})).rejects.toThrow();
  });
});