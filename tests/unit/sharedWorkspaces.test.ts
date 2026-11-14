import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";

const modules = { "../../convex/_generated/server.ts": async () => ({}), "../../convex/sharedWorkspaces.ts": () => import("@/convex/sharedWorkspaces") };
const create = makeFunctionReference<"action", { name: string }, { workspaceId: string; teamspaceId: string }>("sharedWorkspaces:create");
const invite = makeFunctionReference<"action", { workspaceId: string; email: string; role: "member" | "guest" }, { token: string; expiresAt: number }>("sharedWorkspaces:invite");
const accept = makeFunctionReference<"action", { token: string }, { workspaceId: string }>("sharedWorkspaces:accept");
const get = makeFunctionReference<"query", { workspaceId: string }, { members: { userId: string; displayName: string }[]; teamspaces: { id: string; name: string }[] }>("sharedWorkspaces:get");
const createPrepared = makeFunctionReference<"mutation", { actor: { userId: string; verifiedEmail: null }; displayName: string; name: string; ids: string[] }, { workspaceId: string; teamspaceId: string }>("sharedWorkspaces:createPrepared");
const revoke = makeFunctionReference<"mutation", { workspaceId: string; userId: string }, { revoked: true }>("sharedWorkspaces:revoke");

describe("shared workspace gateway", () => {
  it("creates, invites a verified account, and revokes access", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice", name: "Alice", email: "alice@example.com", emailVerified: true });
    const bob = t.withIdentity({ subject: "bob", name: "Bob", email: "bob@example.com", emailVerified: true });
    const workspace = await alice.action(create, { name: "Team" });
    expect((await alice.query(get, { workspaceId: workspace.workspaceId })).teamspaces).toEqual([{ id: workspace.teamspaceId, name: "General" }]);
    const invitation = await alice.action(invite, { workspaceId: workspace.workspaceId, email: "bob@example.com", role: "member" });
    await expect(t.withIdentity({ subject: "bob", email: "bob@example.com", emailVerified: false }).action(accept, { token: invitation.token })).rejects.toThrow();
    await expect(bob.action(accept, { token: invitation.token })).resolves.toEqual({ workspaceId: workspace.workspaceId });
    expect((await alice.query(get, { workspaceId: workspace.workspaceId })).members).toEqual(expect.arrayContaining([{ userId: "bob", displayName: "Bob", role: "member" }]));
    expect((await bob.query(get, { workspaceId: workspace.workspaceId })).members).toEqual([]);
    const other = await alice.action(create, { name: "Other" });
    await expect(alice.mutation(revoke, { workspaceId: other.workspaceId, userId: "bob" })).rejects.toThrow();
    await expect(alice.mutation(revoke, { workspaceId: workspace.workspaceId, userId: "bob" })).resolves.toEqual({ revoked: true });
    await expect(bob.query(get, { workspaceId: workspace.workspaceId })).rejects.toThrow();
    await expect(bob.action(accept, { token: invitation.token })).rejects.toThrow();
  });

  it("rejects expired tokens and rolls back failed workspace creation", async () => {
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const bob = t.withIdentity({ subject: "bob", email: "bob@example.com", emailVerified: true });
    await expect(alice.action(create, { name: " " })).rejects.toThrow();
    await expect(t.mutation(createPrepared, { actor: { userId: "alice", verifiedEmail: null }, displayName: "Alice", name: "Rollback", ids: ["workspace", "audit", "teamspace", "audit"] })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("collabWorkspaces").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("collabTeamspaces").collect())).toEqual([]);
    const workspace = await alice.action(create, { name: "Team" });
    const invitation = await alice.action(invite, { workspaceId: workspace.workspaceId, email: "bob@example.com", role: "member" });
    await t.run(async (ctx) => { const row = await ctx.db.query("collabInvitations").first(); if (!row) throw new Error("missing invitation"); await ctx.db.patch(row._id, { expiresAt: 1 }); });
    await expect(bob.action(accept, { token: invitation.token })).rejects.toThrow();
  });
});
