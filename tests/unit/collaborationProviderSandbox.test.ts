import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import schema from "../../experiments/max-v2-pr17/convex/schema";

// convex-test's module loader detects its root from a _generated/ module key.
// This is a test-only discovery marker, not codegen, an auth token, or a
// production function; the real sandbox schema/provider are loaded below.
const modules = {
  "./_generated/api.ts": async () => ({}),
  "./provider.ts": () => import("../../experiments/max-v2-pr17/convex/provider"),
};
const join = makeFunctionReference<"mutation">("provider:join");
const append = makeFunctionReference<"mutation">("provider:appendUpdate");
const read = makeFunctionReference<"query">("provider:readUpdates");
const leave = makeFunctionReference<"mutation">("provider:leave");
const status = makeFunctionReference<"query">("provider:sessionStatus");
const downgrade = makeFunctionReference<"mutation">("provider:downgradeMemberEdit");
const revoke = makeFunctionReference<"mutation">("provider:revokeMember");
const compact = makeFunctionReference<"mutation">("provider:compactLog");
const checkpointStatus = makeFunctionReference<"query">("provider:checkpointStatus");
const root = "lab-page";
const ws = "lab-workspace";

async function fixture() {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ctx.db.insert("workspaces", { workspaceId: ws, ownerId: "alice", status: "active" });
    for (const [accountId, role] of [
      ["alice", "owner"], ["bob", "member"], ["carol", "guest"],
    ] as const) {
      await ctx.db.insert("workspaceMemberships", {
        workspaceId: ws, accountId, role, status: "active",
      });
    }
    await ctx.db.insert("workspacePageScopes", {
      workspaceId: ws, pageId: root, parentId: null, teamspaceId: null,
    });
    await ctx.db.insert("workspacePageGrants", {
      workspaceId: ws, pageId: root, subjectType: "account",
      subjectId: "bob", effect: "allow", level: "edit_content",
    });
    await ctx.db.insert("workspacePageGrants", {
      workspaceId: ws, pageId: root, subjectType: "account",
      subjectId: "carol", effect: "allow", level: "view",
    });
  });
  const alice = t.withIdentity({ subject: "alice", tokenIdentifier: "sandbox|alice" });
  const bob = t.withIdentity({ subject: "bob", tokenIdentifier: "sandbox|bob" });
  const carol = t.withIdentity({ subject: "carol", tokenIdentifier: "sandbox|carol" });
  const stranger = t.withIdentity({ subject: "stranger", tokenIdentifier: "sandbox|stranger" });
  return { t, alice, bob, carol, stranger };
}
const packet = "AQIDBA=="; // synthetic opaque bytes; NOT proof of Yjs codec validity
let original: string | undefined;
beforeEach(() => {
  original = process.env.MAX_V2_PR17_PROVIDER_SANDBOX;
  process.env.MAX_V2_PR17_PROVIDER_SANDBOX = "true";
});
afterEach(() => {
  if (original === undefined) delete process.env.MAX_V2_PR17_PROVIDER_SANDBOX;
  else process.env.MAX_V2_PR17_PROVIDER_SANDBOX = original;
});

describe("PR17 standalone Convex sandbox provider: authenticated server operations", () => {
  it("does not issue a room lease to an unauthenticated identity or outsider", async () => {
    const { t, stranger } = await fixture();
    await expect(t.mutation(join, { workspaceId: ws, pageId: root })).rejects.toThrow();
    await expect(stranger.mutation(join, { workspaceId: ws, pageId: root })).rejects.toThrow();
  });

  it("is independently disabled by a private server flag, before and after joining", async () => {
    const { alice } = await fixture();
    const lease = await alice.mutation(join, { workspaceId: ws, pageId: root });
    process.env.MAX_V2_PR17_PROVIDER_SANDBOX = "false";
    await expect(alice.mutation(join, { workspaceId: ws, pageId: root })).rejects.toThrow();
    await expect(alice.query(read, { sessionId: lease.sessionId, afterSeq: 0 })).rejects.toThrow();
    await expect(alice.mutation(append, {
      sessionId: lease.sessionId, operationId: "update_0001", base64: packet,
    })).rejects.toThrow();
  });

  it("serves immutable ordered updates to 3 separate identities but rejects guest writes", async () => {
    const { alice, bob, carol } = await fixture();
    const a = await alice.mutation(join, { workspaceId: ws, pageId: root });
    const b = await bob.mutation(join, { workspaceId: ws, pageId: root });
    const c = await carol.mutation(join, { workspaceId: ws, pageId: root });
    expect(await alice.mutation(append, {
      sessionId: a.sessionId, operationId: "update_0001", base64: packet,
    })).toMatchObject({ seq: 1, duplicate: false });
    expect(await bob.mutation(append, {
      sessionId: b.sessionId, operationId: "update_0002", base64: "BwgJCg==",
    })).toMatchObject({ seq: 2, duplicate: false });
    const fromGuest = await carol.query(read, { sessionId: c.sessionId, afterSeq: 0 });
    expect(fromGuest.headSeq).toBe(2);
    expect(fromGuest.updates).toMatchObject([
      { seq: 1, actorId: "alice", operationId: "update_0001", base64: packet },
      { seq: 2, actorId: "bob", operationId: "update_0002", base64: "BwgJCg==" },
    ]);
    await expect(carol.mutation(append, {
      sessionId: c.sessionId, operationId: "update_0003", base64: packet,
    })).rejects.toThrow();
  });

  it("does not treat a session ID as a bearer token or permit cross-account reuse", async () => {
    const { alice, bob, stranger } = await fixture();
    const { sessionId } = await alice.mutation(join, { workspaceId: ws, pageId: root });
    for (const actor of [bob, stranger]) {
      await expect(actor.query(read, { sessionId, afterSeq: 0 })).rejects.toThrow();
      await expect(actor.mutation(append, {
        sessionId, operationId: "update_0004", base64: packet,
      })).rejects.toThrow();
      await expect(actor.mutation(leave, { sessionId })).rejects.toThrow();
    }
    await expect(alice.query(read, { sessionId, afterSeq: 0 })).resolves.toMatchObject({ headSeq: 0 });
  });

  it("revocation atomically fences outstanding sessions and preserves prior durable data", async () => {
    const { alice, bob, carol, t } = await fixture();
    const a = await alice.mutation(join, { workspaceId: ws, pageId: root });
    const b = await bob.mutation(join, { workspaceId: ws, pageId: root });
    const c = await carol.mutation(join, { workspaceId: ws, pageId: root });
    await bob.mutation(append, { sessionId: b.sessionId, operationId: "update_0005", base64: packet });
    expect(await alice.mutation(revoke, {
      workspaceId: ws, pageId: root, targetAccountId: "bob",
    })).toBe(true);
    await expect(bob.query(read, { sessionId: b.sessionId, afterSeq: 0 })).rejects.toThrow();
    await expect(bob.mutation(append, {
      sessionId: b.sessionId, operationId: "update_0006", base64: packet,
    })).rejects.toThrow();
    await expect(bob.mutation(join, { workspaceId: ws, pageId: root })).rejects.toThrow();
    await expect(bob.mutation(revoke, {
      workspaceId: ws, pageId: root, targetAccountId: "carol",
    })).rejects.toThrow();
    expect((await alice.query(read, { sessionId: a.sessionId, afterSeq: 0 })).updates).toHaveLength(1);
    expect((await carol.query(read, { sessionId: c.sessionId, afterSeq: 0 })).updates).toHaveLength(1);
    const records = await t.run(async (ctx) => ctx.db.query("labAuditEvents").collect());
    expect(records).toMatchObject([{ operation: "member.revoked", targetId: "bob" }]);
  });

  it("rechecks live edit permissions after join instead of using a cached role", async () => {
    const { bob, alice, t } = await fixture();
    await alice.mutation(join, { workspaceId: ws, pageId: root });
    const b = await bob.mutation(join, { workspaceId: ws, pageId: root });
    await t.run(async (ctx) => {
      const grants = await ctx.db.query("workspacePageGrants").collect();
      const grant = grants.find((x) => x.subjectId === "bob");
      if (!grant) throw Error("missing fixture grant");
      await ctx.db.patch(grant._id, { level: "view" });
    });
    await expect(bob.mutation(append, {
      sessionId: b.sessionId, operationId: "update_0007", base64: packet,
    })).rejects.toThrow();
    await expect(bob.query(read, { sessionId: b.sessionId, afterSeq: 0 })).resolves.toMatchObject({ headSeq: 0 });
  });

  it("supports retry idempotency and rejects modified duplicate payloads", async () => {
    const { alice } = await fixture();
    const { sessionId } = await alice.mutation(join, { workspaceId: ws, pageId: root });
    const args = { sessionId, operationId: "update_0008", base64: packet };
    expect(await alice.mutation(append, args)).toMatchObject({ seq: 1, duplicate: false });
    expect(await alice.mutation(append, args)).toMatchObject({ seq: 1, duplicate: true });
    await expect(alice.mutation(append, { ...args, base64: "BwgJCg==" })).rejects.toThrow();
    expect((await alice.query(read, { sessionId, afterSeq: 0 })).updates).toHaveLength(1);
  });

  it("rejects malformed, oversized, and empty update payloads before storing them", async () => {
    const { alice } = await fixture();
    const { sessionId } = await alice.mutation(join, { workspaceId: ws, pageId: root });
    for (const [operationId, base64] of [
      ["bad", packet], ["update_0009", ""], ["update_0010", "☠"],
      ["update_0011", "A".repeat(22000)], ["update_0012", "ABC"],
    ]) {
      await expect(alice.mutation(append, { sessionId, operationId, base64 })).rejects.toThrow();
    }
    expect((await alice.query(read, { sessionId, afterSeq: 0 })).updates).toHaveLength(0);
  });

  it("paginates durable stream by sequence and supports incremental reconnect", async () => {
    const { alice, bob } = await fixture();
    const a = await alice.mutation(join, { workspaceId: ws, pageId: root });
    const b = await bob.mutation(join, { workspaceId: ws, pageId: root });
    for (let i = 1; i <= 3; i++) {
      await alice.mutation(append, { sessionId: a.sessionId, operationId: "paged_000" + i, base64: packet });
    }
    const first = await bob.query(read, { sessionId: b.sessionId, afterSeq: 0, limit: 2 });
    expect(first).toMatchObject({ headSeq: 3, hasMore: true });
    expect(first.updates.map((x: { seq: number }) => x.seq)).toEqual([1, 2]);
    const second = await bob.query(read, { sessionId: b.sessionId, afterSeq: 2, limit: 2 });
    expect(second.hasMore).toBe(false);
    expect(second.updates.map((x: { seq: number }) => x.seq)).toEqual([3]);
    await expect(bob.query(read, { sessionId: b.sessionId, afterSeq: -1 })).rejects.toThrow();
    await expect(bob.query(read, { sessionId: b.sessionId, afterSeq: 99 })).rejects.toThrow();
  });

  it("invalidates a deliberately closed session without deleting its updates", async () => {
    const { alice } = await fixture();
    const a = await alice.mutation(join, { workspaceId: ws, pageId: root });
    await alice.mutation(append, { sessionId: a.sessionId, operationId: "update_0013", base64: packet });
    expect(await alice.mutation(leave, { sessionId: a.sessionId })).toBe(true);
    await expect(alice.query(read, { sessionId: a.sessionId, afterSeq: 0 })).rejects.toThrow();
    const fresh = await alice.mutation(join, { workspaceId: ws, pageId: root });
    expect((await alice.query(read, { sessionId: fresh.sessionId, afterSeq: 0 })).updates).toHaveLength(1);
  });

  it("fails closed on corrupt or cross-workspace ACL data, even for an owner", async () => {
    const { alice, t } = await fixture();
    await t.run(async (ctx) => {
      await ctx.db.insert("workspacePageGrants", {
        workspaceId: ws, pageId: root, subjectType: "account",
        subjectId: "alice", effect: "allow", level: "view",
      });
      await ctx.db.insert("workspacePageGrants", {
        workspaceId: ws, pageId: root, subjectType: "account",
        subjectId: "alice", effect: "deny", level: "view",
      });
    });
    await expect(alice.mutation(join, { workspaceId: ws, pageId: root })).rejects.toThrow();
  });
  it("streams a server-derived edit downgrade without closing a readable session", async () => {
    const { alice, bob, carol, t } = await fixture();
    const a = await alice.mutation(join, { workspaceId: ws, pageId: root });
    const b = await bob.mutation(join, { workspaceId: ws, pageId: root });
    expect(await bob.query(status, { sessionId: b.sessionId })).toMatchObject({
      accountId: "bob", canEdit: true, expiresAt: b.expiresAt,
    });
    await expect(carol.query(status, { sessionId: b.sessionId })).rejects.toThrow();
    await expect(bob.mutation(downgrade, {
      workspaceId: ws, pageId: root, targetAccountId: "carol",
    })).rejects.toThrow();
    expect(await alice.mutation(downgrade, {
      workspaceId: ws, pageId: root, targetAccountId: "bob",
    })).toBe(true);
    expect(await bob.query(status, { sessionId: b.sessionId })).toMatchObject({
      accountId: "bob", canEdit: false,
    });
    await expect(bob.query(read, { sessionId: b.sessionId, afterSeq: 0 })).resolves.toMatchObject({ headSeq: 0 });
    await expect(bob.mutation(append, {
      sessionId: b.sessionId, operationId: "pr20_denied_0001", base64: packet,
    })).rejects.toThrow();
    expect(await alice.query(status, { sessionId: a.sessionId })).toMatchObject({ canEdit: true });
    const audit = await t.run(async ctx => ctx.db.query("labAuditEvents").collect());
    expect(audit).toMatchObject([{ operation: "page.edit_downgraded", targetId: "bob" }]);
  });

  it("session status fails closed on revoked, expired, and cross-account leases", async () => {
    const { alice, bob, t } = await fixture();
    const a = await alice.mutation(join, { workspaceId: ws, pageId: root });
    const b = await bob.mutation(join, { workspaceId: ws, pageId: root });
    await expect(bob.query(status, { sessionId: a.sessionId })).rejects.toThrow();
    await alice.mutation(revoke, { workspaceId: ws, pageId: root, targetAccountId: "bob" });
    await expect(bob.query(status, { sessionId: b.sessionId })).rejects.toThrow();
    await t.run(async ctx => {
      const sessions = await ctx.db.query("labSessions").collect();
      const row = sessions.find(s => s._id === a.sessionId);
      if (!row) throw Error("missing lease");
      await ctx.db.patch(row._id, { issuedAt: Date.now() - 300_001, expiresAt: Date.now() - 1 });
    });
    await expect(alice.query(status, { sessionId: a.sessionId })).rejects.toThrow();
    await expect(alice.mutation(append, {
      sessionId: a.sessionId, operationId: "pr20_denied_0002", base64: packet,
    })).rejects.toThrow();
  });

  it("compacts the original byte log losslessly, retaining cursors and retry identity", async () => {
    const {alice,bob,carol,t}=await fixture();
    const a=await alice.mutation(join,{workspaceId:ws,pageId:root});
    const b=await bob.mutation(join,{workspaceId:ws,pageId:root});
    const c=await carol.mutation(join,{workspaceId:ws,pageId:root});
    for(let i=1;i<=10;i++) await alice.mutation(append,{
      sessionId:a.sessionId,operationId:"compact_000"+i,base64:packet});
    await expect(bob.mutation(compact,{sessionId:b.sessionId})).rejects.toThrow();
    await expect(carol.mutation(compact,{sessionId:c.sessionId})).rejects.toThrow();
    expect(await alice.mutation(compact,{sessionId:a.sessionId}))
      .toMatchObject({startSeq:1,endSeq:8,count:8,complete:false});
    expect((await bob.query(read,{sessionId:b.sessionId,afterSeq:0,limit:6}))
      .updates.map((x:{seq:number})=>x.seq)).toEqual([1,2,3,4,5,6]);
    expect(await alice.mutation(compact,{sessionId:a.sessionId}))
      .toMatchObject({startSeq:9,endSeq:10,count:2,complete:true});
    expect((await alice.mutation(compact,{sessionId:a.sessionId})).count).toBe(0);
    const page=await carol.query(read,{sessionId:c.sessionId,afterSeq:6,limit:4});
    expect(page).toMatchObject({headSeq:10,hasMore:false});
    expect(page.updates.map((x:{seq:number})=>x.seq)).toEqual([7,8,9,10]);
    expect(await alice.mutation(append,{sessionId:a.sessionId,
      operationId:"compact_0001",base64:packet})).toMatchObject({seq:1,duplicate:true});
    await expect(alice.mutation(append,{sessionId:a.sessionId,
      operationId:"compact_0001",base64:"BwgJCg=="})).rejects.toThrow();
    expect(await t.run(async ctx=>({raw:(await ctx.db.query("labUpdates").collect()).length,
      packs:(await ctx.db.query("labCheckpointSegments").collect()).length})))
      .toEqual({raw:0,packs:2});
  });
  it("fails closed on an update gap without deleting any additional source rows",async()=>{
    const {alice,t}=await fixture();
    const a=await alice.mutation(join,{workspaceId:ws,pageId:root});
    for(let i=1;i<=3;i++) await alice.mutation(append,{
      sessionId:a.sessionId,operationId:"gap_test_000"+i,base64:packet});
    await t.run(async ctx=>{
      const rows=await ctx.db.query("labUpdates").collect();
      const row=rows.find(x=>x.seq===2);
      if(!row)throw Error("missing fixture");
      await ctx.db.delete(row._id);
    });
    await expect(alice.mutation(compact,{sessionId:a.sessionId})).rejects.toThrow();
    expect(await t.run(async ctx=>({
      raw:(await ctx.db.query("labUpdates").collect()).map(x=>x.seq),
      packs:(await ctx.db.query("labCheckpointSegments").collect()).length,
    }))).toEqual({raw:[1,3],packs:0});
  });
  it("does not compact with a revoked lease or a disabled sandbox",async()=>{
    const {alice,bob,t}=await fixture();
    const a=await alice.mutation(join,{workspaceId:ws,pageId:root});
    const b=await bob.mutation(join,{workspaceId:ws,pageId:root});
    await alice.mutation(revoke,{workspaceId:ws,pageId:root,targetAccountId:"bob"});
    await expect(bob.mutation(compact,{sessionId:b.sessionId})).rejects.toThrow();
    process.env.MAX_V2_PR17_PROVIDER_SANDBOX="false";
    await expect(alice.mutation(compact,{sessionId:a.sessionId})).rejects.toThrow();
    expect(await t.run(async ctx=>ctx.db.query("labCheckpointSegments").collect())).toHaveLength(0);
  });

  it("pinned read fence remains stable across new writes and checkpoint packing",async()=>{
    const {alice,bob,carol}=await fixture();
    const a=await alice.mutation(join,{workspaceId:ws,pageId:root});
    const b=await bob.mutation(join,{workspaceId:ws,pageId:root});
    const c=await carol.mutation(join,{workspaceId:ws,pageId:root});
    for(let i=1;i<=5;i++)await bob.mutation(append,{
      sessionId:b.sessionId,operationId:"fenced_000"+i,base64:packet});
    const first=await carol.query(read,{sessionId:c.sessionId,afterSeq:0,limit:2});
    expect(first).toMatchObject({headSeq:5,hasMore:true});
    await Promise.all([
      alice.mutation(compact,{sessionId:a.sessionId}),
      bob.mutation(append,{sessionId:b.sessionId,operationId:"fenced_0006",base64:packet}),
    ]);
    const second=await carol.query(read,{
      sessionId:c.sessionId,afterSeq:2,limit:3,throughSeq:first.headSeq,
    });
    expect(second).toMatchObject({headSeq:5,hasMore:false});
    expect(second.updates.map((x:{seq:number})=>x.seq)).toEqual([3,4,5]);
    expect((await carol.query(read,{sessionId:c.sessionId,afterSeq:5,throughSeq:5})).updates).toEqual([]);
    await expect(carol.query(read,{sessionId:c.sessionId,afterSeq:6,throughSeq:5})).rejects.toThrow();
    await expect(carol.query(read,{sessionId:c.sessionId,afterSeq:0,throughSeq:999})).rejects.toThrow();
    await expect(carol.query(read,{sessionId:c.sessionId,afterSeq:0,throughSeq:-1})).rejects.toThrow();
    await expect(carol.query(read,{sessionId:c.sessionId,afterSeq:0,throughSeq:0.5})).rejects.toThrow();
    const live=await carol.query(read,{sessionId:c.sessionId,afterSeq:5});
    expect(live.updates.map((x:{seq:number})=>x.seq)).toEqual([6]);
  });

  it("multiple authenticated writers racing with compaction preserve every distinct operation",async()=>{
    const {alice,bob,carol}=await fixture();
    const a=await alice.mutation(join,{workspaceId:ws,pageId:root});
    const b=await bob.mutation(join,{workspaceId:ws,pageId:root});
    const c=await carol.mutation(join,{workspaceId:ws,pageId:root});
    const submitted=await Promise.all([
      ...Array.from({length:12},(_,i)=>alice.mutation(append,{
        sessionId:a.sessionId,operationId:"alice_race_"+String(i).padStart(4,"0"),
        base64:packet})),
      ...Array.from({length:12},(_,i)=>bob.mutation(append,{
        sessionId:b.sessionId,operationId:"bob_race__"+String(i).padStart(4,"0"),
        base64:packet})),
      alice.mutation(compact,{sessionId:a.sessionId}),
    ]);
    expect(submitted.slice(0,24).every((x:any)=>x.duplicate===false)).toBe(true);
    expect(new Set(submitted.slice(0,24).map((x:any)=>x.seq)).size).toBe(24);
    for(let i=0;i<8;i++) {
      const result=await alice.mutation(compact,{sessionId:a.sessionId});
      if(result.complete)break;
    }
    const proof=await alice.query(checkpointStatus,{sessionId:a.sessionId});
    expect(proof).toMatchObject({headSeq:24,checkpointThrough:24,rawCount:0,storedBytes:72});
    const first=await carol.query(read,{sessionId:c.sessionId,afterSeq:0,limit:8,throughSeq:24});
    const next=await carol.query(read,{sessionId:c.sessionId,afterSeq:8,limit:64,throughSeq:24});
    const all=[...first.updates,...next.updates];
    expect(all.map((x:{seq:number})=>x.seq)).toEqual(Array.from({length:24},(_,i)=>i+1));
    expect(new Set(all.map((x:{actorId:string;operationId:string})=>x.actorId+":"+x.operationId)).size).toBe(24);
    await expect(bob.query(checkpointStatus,{sessionId:b.sessionId})).rejects.toThrow();
    await expect(carol.query(checkpointStatus,{sessionId:c.sessionId})).rejects.toThrow();
    expect(await bob.mutation(append,{sessionId:b.sessionId,
      operationId:"bob_race__0000",base64:packet})).toMatchObject({duplicate:true});
  });

  it("checkpoint owner proof detects corrupt byte counters after a simulated partial restore",async()=>{
    const {alice,t}=await fixture();
    const a=await alice.mutation(join,{workspaceId:ws,pageId:root});
    await alice.mutation(append,{sessionId:a.sessionId,operationId:"restore_0001",base64:packet});
    await alice.mutation(compact,{sessionId:a.sessionId});
    await expect(alice.query(checkpointStatus,{sessionId:a.sessionId}))
      .resolves.toMatchObject({headSeq:1,checkpointThrough:1,packCount:1,storedBytes:3});
    await t.run(async ctx=>{
      const rows=await ctx.db.query("labRooms").collect();
      if(rows.length!==1)throw Error("fixture room missing");
      await ctx.db.patch(rows[0]._id,{storedBytes:0});
    });
    await expect(alice.query(checkpointStatus,{sessionId:a.sessionId})).rejects.toThrow();
    // The log is not silently healed or truncated by a read failure.
    expect((await alice.query(read,{sessionId:a.sessionId,afterSeq:0})).updates).toHaveLength(1);
  });

});
