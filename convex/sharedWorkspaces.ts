import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { convexCollaborationStore } from "./collaborationStore";
import { requireSharedActor, sharedBoundary, sharedDisplayName } from "./sharedAuth";
import { WorkspaceService, webCryptoCollaborationRuntime } from "../lib/domain/collaboration/workspaces";
import type { CollaborationRuntime, ResolvedCollaborationActor } from "../lib/domain/collaboration/collaborationStore";
import { MaxError } from "../lib/domain/errors";

const role = v.union(v.literal("owner"), v.literal("admin"), v.literal("member"), v.literal("guest"));
const inviteRole = v.union(v.literal("member"), v.literal("guest"));
const actorValidator = v.object({ userId: v.string(), verifiedEmail: v.union(v.string(), v.null()) });
const summary = v.object({ id: v.string(), name: v.string(), role });
const member = v.object({ userId: v.string(), displayName: v.string(), role });
const teamspace = v.object({ id: v.string(), name: v.string() });
const preparedToken = `max-invite-v1.${"0".repeat(64)}`;

type Actor = ResolvedCollaborationActor;
function preparedRuntime(ids: string[], hash = ""): CollaborationRuntime {
  let index = 0;
  return {
    now: () => Date.now(),
    newId: () => {
      const id = ids[index++];
      if (!id) throw new MaxError("INTERNAL", "The workspace identifier generator is unavailable.");
      return id;
    },
    createInvitationToken: () => preparedToken,
    hashInvitationToken: async () => hash,
  };
}
const ids = (count: number) => Array.from({ length: count }, () => crypto.randomUUID());
const createRef = makeFunctionReference<"mutation", { actor: Actor; displayName: string; name: string; ids: string[] }, { workspaceId: string; teamspaceId: string }>("sharedWorkspaces:createPrepared");
const inviteRef = makeFunctionReference<"mutation", { actor: Actor; workspaceId: string; email: string; role: "member" | "guest"; ids: string[]; hash: string }, { expiresAt: number }>("sharedWorkspaces:invitePrepared");
const acceptRef = makeFunctionReference<"mutation", { actor: Actor; displayName: string; hash: string; ids: string[] }, { workspaceId: string }>("sharedWorkspaces:acceptPrepared");

export const list = query({
  args: {}, returns: v.object({ actorId: v.string(), workspaces: v.array(summary) }),
  handler: (ctx) => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx);
    const { workspaces } = await new WorkspaceService(convexCollaborationStore(ctx.db)).listWorkspaces(actor);
    return { actorId: actor.userId, workspaces: workspaces.filter(({ workspace }) => workspace.kind === "organization").map(({ workspace, role }) => ({ id: workspace.id, name: workspace.name, role })) };
  }),
});

export const get = query({
  args: { workspaceId: v.string() },
  returns: v.object({ actorId: v.string(), id: v.string(), name: v.string(), role, canManageMembers: v.boolean(), teamspaces: v.array(teamspace), members: v.array(member) }),
  handler: (ctx, { workspaceId }) => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx);
    const service = new WorkspaceService(convexCollaborationStore(ctx.db));
    const { workspaces } = await service.listWorkspaces(actor);
    const found = workspaces.find(({ workspace }) => workspace.id === workspaceId && workspace.kind === "organization");
    if (!found) throw new MaxError("NOT_FOUND", "This workspace doesn't exist or was permanently deleted.");
    const canManageMembers = found.role === "owner" || found.role === "admin";
    const { teamspaces } = await service.listTeamspaces(actor, { workspaceId });
    const members = canManageMembers ? (await service.listMembers(actor, { workspaceId })).members.filter((m) => m.state === "active").map((m) => ({ userId: m.userId, displayName: m.displayName || "Member", role: m.role })) : [];
    return { actorId: actor.userId, id: found.workspace.id, name: found.workspace.name, role: found.role, canManageMembers, teamspaces: teamspaces.filter((t) => t.admitted).map(({ id, name }) => ({ id, name })), members };
  }),
});

export const create = action({
  args: { name: v.string() }, returns: v.object({ workspaceId: v.string(), teamspaceId: v.string() }),
  handler: (ctx, { name }): Promise<{ workspaceId: string; teamspaceId: string }> => sharedBoundary(async () => ctx.runMutation(createRef, { actor: await requireSharedActor(ctx), displayName: await sharedDisplayName(ctx), name, ids: ids(4) })),
});
export const createPrepared = internalMutation({
  args: { actor: actorValidator, displayName: v.string(), name: v.string(), ids: v.array(v.string()) }, returns: v.object({ workspaceId: v.string(), teamspaceId: v.string() }),
  handler: (ctx, { actor, displayName, name, ids }) => sharedBoundary(async () => {
    const store = convexCollaborationStore(ctx.db);
    const service = new WorkspaceService(store, preparedRuntime(ids));
    const { workspace } = await service.createOrganization(actor, { name });
    const { teamspace } = await service.createTeamspace(actor, { workspaceId: workspace.id, name: "General", visibility: "open", defaultGrant: "edit" });
    await store.transaction(async (tx) => { const membership = await tx.getMembership(workspace.id, actor.userId); if (!membership) throw new MaxError("INTERNAL", "Workspace creation failed."); await tx.putMembership({ ...membership, displayName }); });
    return { workspaceId: workspace.id, teamspaceId: teamspace.id };
  }),
});

export const invite = action({
  args: { workspaceId: v.string(), email: v.string(), role: inviteRole }, returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: (ctx, args): Promise<{ token: string; expiresAt: number }> => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx);
    const runtime = webCryptoCollaborationRuntime();
    const token = runtime.createInvitationToken();
    const hash = await runtime.hashInvitationToken(token);
    const result = await ctx.runMutation(inviteRef, { actor, ...args, ids: ids(2), hash });
    return { token, expiresAt: result.expiresAt };
  }),
});
export const invitePrepared = internalMutation({
  args: { actor: actorValidator, workspaceId: v.string(), email: v.string(), role: inviteRole, ids: v.array(v.string()), hash: v.string() }, returns: v.object({ expiresAt: v.number() }),
  handler: (ctx, { actor, workspaceId, email, role, ids, hash }) => sharedBoundary(async () => {
    const { invitation } = await new WorkspaceService(convexCollaborationStore(ctx.db), preparedRuntime(ids, hash)).createInvitation(actor, { workspaceId, email, role });
    return { expiresAt: invitation.expiresAt };
  }),
});

export const accept = action({
  args: { token: v.string() }, returns: v.object({ workspaceId: v.string() }),
  handler: (ctx, { token }): Promise<{ workspaceId: string }> => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx);
    if (!/^max-invite-v1\.[a-f0-9]{64}$/.test(token)) throw new MaxError("NOT_FOUND", "This invitation doesn't exist or was permanently deleted.");
    const hash = await webCryptoCollaborationRuntime().hashInvitationToken(token);
    return ctx.runMutation(acceptRef, { actor, displayName: await sharedDisplayName(ctx), hash, ids: ids(1) });
  }),
});
export const acceptPrepared = internalMutation({
  args: { actor: actorValidator, displayName: v.string(), hash: v.string(), ids: v.array(v.string()) }, returns: v.object({ workspaceId: v.string() }),
  handler: (ctx, { actor, displayName, hash, ids }) => sharedBoundary(async () => {
    const store = convexCollaborationStore(ctx.db);
    const { workspaceId } = await new WorkspaceService(store, preparedRuntime(ids, hash)).acceptInvitation(actor, { token: preparedToken });
    await store.transaction(async (tx) => { const membership = await tx.getMembership(workspaceId, actor.userId); if (!membership) throw new MaxError("INTERNAL", "Invitation acceptance failed."); await tx.putMembership({ ...membership, displayName }); });
    return { workspaceId };
  }),
});
export const revoke = mutation({
  args: { workspaceId: v.string(), userId: v.string() }, returns: v.object({ revoked: v.literal(true) }),
  handler: (ctx, { workspaceId, userId }) => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx);
    const runtime = preparedRuntime([`revoke-${Date.now()}-${Math.random().toString(36).slice(2)}`]);
    await new WorkspaceService(convexCollaborationStore(ctx.db), runtime).changeMembership(actor, { workspaceId, userId, next: { state: "revoked" } });
    return { revoked: true as const };
  }),
});
