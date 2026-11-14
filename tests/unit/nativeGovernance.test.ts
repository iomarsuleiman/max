import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { convexCollaborationStore } from "@/convex/collaborationStore";
import { replaceStoredPageAccess } from "@/convex/pageGrantStore";
import { convexDb } from "@/convex/convexDb";
import type { DatabaseWriter } from "@/convex/_generated/server";
import type { Id } from "@/convex/_generated/dataModel";
import { WorkspaceService } from "@/lib/domain/collaboration/workspaces";
import { authorizeCollaborationPage } from "@/lib/domain/collaboration/authorization";
import type { CollaborationRuntime, InvitationRole } from "@/lib/domain/collaboration/collaborationStore";
import type { AccessGrant, PageGrant } from "@/lib/domain/collaboration/policy";
import { newPageRow } from "@/lib/domain/ops/helpers";

const alice = { userId: "alice", verifiedEmail: "alice@example.com" };
const bob = { userId: "bob", verifiedEmail: "bob@example.com" };
const carol = { userId: "carol", verifiedEmail: "carol@example.com" };
const denied = { code: "NOT_FOUND" };
const userGrant = (userId: string, grant: PageGrant = "full"): AccessGrant => ({ principal: { kind: "user", userId }, effect: "allow", grant, expiresAt: null });
const groupGrant = (groupId: string, effect: "allow" | "deny"): AccessGrant => effect === "deny"
  ? { principal: { kind: "group", groupId }, effect }
  : { principal: { kind: "group", groupId }, effect, grant: "full", expiresAt: null };

async function fixture(carolRole: InvitationRole = "member") {
  const t = convexTest(schema, { "../../convex/_generated/server.ts": async () => ({}) });
  let sequence = 0;
  const runtime: CollaborationRuntime = {
    now: () => 1000,
    newId: () => `native-${++sequence}`,
    createInvitationToken: () => `max-invite-v1.${(++sequence).toString(16).padStart(64, "0")}`,
    hashInvitationToken: async (token) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
  const service = (db: DatabaseWriter) => new WorkspaceService(convexCollaborationStore(db), runtime);
  const { workspace } = await t.run((ctx) => service(ctx.db).createOrganization(alice, { name: "Native governance" }));
  const workspaceId = workspace.id;
  for (const [actor, role] of [[bob, "admin"], [carol, carolRole]] as const) {
    const invitation = await t.run((ctx) => service(ctx.db).createInvitation(alice, { workspaceId, email: actor.verifiedEmail, role }));
    await t.run((ctx) => service(ctx.db).acceptInvitation(actor, { token: invitation.token }));
  }
  const { group } = await t.run((ctx) => service(ctx.db).createGroup(alice, { workspaceId, name: "Restricted readers" }));
  const write = (pageId: Id<"pages">, grants: readonly AccessGrant[]) => t.run(async (ctx) => {
    const header = await ctx.db.query("collabPageAccess").withIndex("by_pageId", (q) => q.eq("pageId", pageId)).unique();
    await replaceStoredPageAccess(ctx.db, { pageId, workspaceId, mode: "replace", grants, baseRevision: header?.aclRevision ?? 0, updatedBy: "alice", now: runtime.now() });
  });
  const page = async (grants: readonly AccessGrant[], teamspaceId?: string) => {
    const id = await t.run((ctx) => ctx.db.insert("pages", newPageRow({ db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1000, source: "ui" }, { rank: "a", workspaceId, ...(teamspaceId ? { teamspaceId } : {}) })));
    await write(id, grants);
    return id;
  };
  const snapshot = () => t.run(async (ctx) => ({
    memberships: await ctx.db.query("collabMemberships").collect(),
    groups: await ctx.db.query("collabGroups").collect(),
    admissions: await ctx.db.query("collabGroupMemberships").collect(),
    invitations: await ctx.db.query("collabInvitations").collect(),
    audit: await ctx.db.query("collabAudit").collect(),
    grants: await ctx.db.query("collabPageGrants").collect(),
    headers: await ctx.db.query("collabPageAccess").collect(),
  }));
  const set = (actor: typeof alice, state: "active" | "revoked") => t.run((ctx) => service(ctx.db).setGroupMember(actor, { workspaceId, groupId: group.id, userId: "carol", state }));
  return { t, service, workspaceId, group, write, page, snapshot, set };
}

describe("native canonical grants guard workspace governance", () => {
  it("checks every indexed allow and deny anchor before a group write", async () => {
    const f = await fixture();
    await f.page([userGrant("alice"), userGrant("bob"), groupGrant(f.group.id, "allow")]);
    const restricted = await f.page([userGrant("alice"), userGrant("bob", "view"), groupGrant(f.group.id, "deny")]);
    const before = await f.snapshot();
    await expect(f.set(bob, "active")).rejects.toMatchObject(denied);
    expect(await f.snapshot()).toEqual(before);
    await f.write(restricted, [userGrant("alice"), userGrant("bob"), groupGrant(f.group.id, "deny")]);
    await expect(f.set(bob, "active")).resolves.toEqual({ changed: true });
  });

  it("does not use proposed group membership to bootstrap sharing authority", async () => {
    const f = await fixture();
    await f.page([userGrant("alice"), groupGrant(f.group.id, "allow")]);
    const before = await f.snapshot();
    await expect(f.t.run((ctx) => f.service(ctx.db).setGroupMember(bob, {
      workspaceId: f.workspaceId, groupId: f.group.id, userId: "bob", state: "active",
    }))).rejects.toMatchObject(denied);
    expect(await f.snapshot()).toEqual(before);
  });

  it.each(["activate", "remove", "archive"] as const)("requires fresh page.share for group %s and preserves all rows on denial", async (operation) => {
    const f = await fixture();
    if (operation !== "activate") await f.set(alice, "active");
    const pageId = await f.page([userGrant("alice"), userGrant("bob"), groupGrant(f.group.id, operation === "activate" ? "allow" : "deny")]);
    const invoke = () => operation === "archive"
      ? f.t.run((ctx) => f.service(ctx.db).updateGroup(bob, { workspaceId: f.workspaceId, groupId: f.group.id, change: { kind: "archive" } }))
      : f.set(bob, operation === "activate" ? "active" : "revoked");
    // The same service and indexed grant reader must see the replacement immediately.
    await f.write(pageId, [userGrant("alice"), userGrant("bob", "comment"), groupGrant(f.group.id, operation === "activate" ? "allow" : "deny")]);
    const before = await f.snapshot();
    await expect(invoke()).rejects.toMatchObject(denied);
    expect(await f.snapshot()).toEqual(before);
    await f.write(pageId, [userGrant("alice"), userGrant("bob"), groupGrant(f.group.id, operation === "activate" ? "allow" : "deny")]);
    await expect(invoke()).resolves.toMatchObject({ changed: true });
  });

  it.each(["direct", "reinvite"] as const)("blocks group deny laundering through %s reactivation", async (path) => {
    const f = await fixture();
    await f.set(alice, "active");
    await f.page([userGrant("alice"), userGrant("carol"), groupGrant(f.group.id, "deny")]);
    await f.t.run((ctx) => f.service(ctx.db).changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "revoked" } }));
    const invitation = path === "reinvite" ? await f.t.run((ctx) => f.service(ctx.db).createInvitation(bob, { workspaceId: f.workspaceId, email: carol.verifiedEmail })) : null;
    const before = await f.snapshot();
    expect(before.admissions[0].state).toBe("revoked");
    await expect(invitation
      ? f.t.run((ctx) => f.service(ctx.db).acceptInvitation(carol, { token: invitation.token }))
      : f.t.run((ctx) => f.service(ctx.db).changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "active", role: "member" } })))
      .rejects.toMatchObject(denied);
    expect(await f.snapshot()).toEqual(before);
  });

  it.each(["direct", "reinvite"] as const)("blocks workspace_members deny removal through %s Guest downgrade", async (path) => {
    const f = await fixture();
    await f.page([userGrant("carol"), { principal: { kind: "workspace_members" }, effect: "deny" }]);
    if (path === "reinvite") await f.t.run((ctx) => f.service(ctx.db).changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "revoked" } }));
    const invitation = path === "reinvite" ? await f.t.run((ctx) => f.service(ctx.db).createInvitation(bob, { workspaceId: f.workspaceId, email: carol.verifiedEmail, role: "guest" })) : null;
    const before = await f.snapshot();
    await expect(invitation
      ? f.t.run((ctx) => f.service(ctx.db).acceptInvitation(carol, { token: invitation.token }))
      : f.t.run((ctx) => f.service(ctx.db).changeMembership(bob, { workspaceId: f.workspaceId, userId: "carol", next: { state: "active", role: "guest" } })))
      .rejects.toMatchObject(denied);
    expect(await f.snapshot()).toEqual(before);
  });

  it("requires the open Teamspace manager for indirect Guest admission", async () => {
    const f = await fixture("guest");
    const { teamspace } = await f.t.run((ctx) => f.service(ctx.db).createTeamspace(alice, { workspaceId: f.workspaceId, name: "Open", visibility: "open", memberGroupIds: [f.group.id] }));
    const pageId = await f.page([userGrant("carol")], teamspace.id);
    const read = () => f.t.run((ctx) => convexCollaborationStore(ctx.db).transaction((transaction) => authorizeCollaborationPage({ transaction, pages: transaction, actor: carol, workspaceId: f.workspaceId, pageId, capability: "page.read", now: 1000 })));
    await expect(read()).rejects.toMatchObject(denied);
    const before = await f.snapshot();
    await expect(f.set(bob, "active")).rejects.toMatchObject(denied);
    expect(await f.snapshot()).toEqual(before);
    await f.set(alice, "active");
    await expect(read()).resolves.toMatchObject({ grant: "full" });
  });
});
