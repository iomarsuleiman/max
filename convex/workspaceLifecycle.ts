import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { canIssueInvitation, validNewPageScope } from "../lib/domain/workspaceInvitationPolicy";
import { validPrincipalId, validScopeId, validWorkspaceId } from "../lib/domain/workspaceManagementPolicy";

type Ctx = GenericMutationCtx<GenericDataModel>;
type Role = "owner" | "admin" | "member" | "guest";
type Status = "active" | "suspended" | "revoked";
type Member = { _id: string; accountId: string; role: Role; status: Status };
type Workspace = { workspaceId: string; ownerId: string; status: "active" | "disabled" };
const roleV = v.union(v.literal("admin"), v.literal("member"), v.literal("guest"));
const nullableIdV = v.union(v.string(), v.null());
function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "Workspace operation is not permitted." });
}
function writeGate(): void {
  if (process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true") denied();
}
async function who(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}
async function workspace(ctx: Ctx, workspaceId: string): Promise<Workspace> {
  if (!validWorkspaceId(workspaceId)) denied();
  const rows = await ctx.db.query("workspaces")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId)).take(2);
  if (rows.length !== 1 || rows[0].workspaceId !== workspaceId || rows[0].status !== "active") denied();
  return rows[0] as Workspace;
}
async function member(ctx: Ctx, workspaceId: string, accountId: string): Promise<Member | null> {
  if (!validPrincipalId(accountId)) denied();
  const rows = await ctx.db.query("workspaceMemberships").withIndex("by_workspace_account", (q) =>
    (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never })
      .eq("accountId", accountId)).take(2);
  if (rows.length > 1 || (rows[0] && (rows[0].workspaceId !== workspaceId || rows[0].accountId !== accountId))) denied();
  return (rows[0] as Member | undefined) ?? null;
}
async function manager(ctx: Ctx, workspaceId: string) {
  const actorId = await who(ctx);
  const ws = await workspace(ctx, workspaceId);
  const actor = await member(ctx, workspaceId, actorId);
  if (!actor || actor.status !== "active" ||
      ((actor.role === "owner") !== (ws.ownerId === actorId)) ||
      (actor.role !== "owner" && actor.role !== "admin")) denied();
  return { actor, ws };
}
async function event(ctx: Ctx, workspaceId: string, actorId: string, operation: string,
  targetId: string, previous: string | null, next: string | null) {
  await ctx.db.insert("workspaceSecurityEvents", {
    workspaceId, actorId, operation, targetId, previous, next, at: Date.now(),
  });
}
async function pending(ctx: Ctx, workspaceId: string, targetAccountId: string) {
  const rows = await ctx.db.query("workspaceInvitations").withIndex("by_workspace_target_status", (q) =>
    (q.eq("workspaceId", workspaceId) as unknown as {
      eq(field: string, value: string): { eq(field: string, value: string): never };
    }).eq("targetAccountId", targetAccountId).eq("status", "pending")).take(2);
  if (rows.length > 1 || rows.some((row) =>
    row.workspaceId !== workspaceId || row.targetAccountId !== targetAccountId || row.status !== "pending")) denied();
  return rows[0] ?? null;
}

/** No invitations are emailed; the manager must know the exact verified Clerk
 * account subject. IDs are NOT credentials. Acceptance requires that subject. */
export const issueInvitation = mutationGeneric({
  args: { workspaceId: v.string(), targetAccountId: v.string(), role: roleV, ttlHours: v.number() },
  returns: v.string(),
  handler: async (ctx, a) => {
    writeGate();
    const { actor, ws } = await manager(ctx, a.workspaceId);
    const target = await member(ctx, a.workspaceId, a.targetAccountId);
    if (!canIssueInvitation(actor, ws.ownerId, a.targetAccountId, a.role, target) ||
        !Number.isInteger(a.ttlHours) || a.ttlHours < 1 || a.ttlHours > 168) denied();
    const current = await pending(ctx, a.workspaceId, a.targetAccountId);
    const now = Date.now();
    // Generic Convex documents expose Value unions: validate before comparison.
    if (current && (typeof current.expiresAt !== "number" || current.expiresAt > now)) denied();
    if (current) {
      await ctx.db.patch(current._id as never, { status: "expired", resolvedAt: now });
      await event(ctx, a.workspaceId, actor.accountId, "invitation.expired", String(current._id), "pending", "expired");
    }
    const id = await ctx.db.insert("workspaceInvitations", {
      workspaceId: a.workspaceId, targetAccountId: a.targetAccountId, role: a.role,
      status: "pending", createdByAccountId: actor.accountId, createdAt: now,
      expiresAt: now + a.ttlHours * 3_600_000, resolvedAt: null,
    });
    await event(ctx, a.workspaceId, actor.accountId, "invitation.issued", String(id), null, a.role);
    return String(id);
  },
});

/** Disclose only invitations addressed to the signed-in identity. */
export const myPendingInvitations = queryGeneric({
  args: {},
  returns: v.array(v.object({
    invitationId: v.string(), workspaceId: v.string(), role: roleV, expiresAt: v.number(),
  })),
  handler: async (ctx) => {
    if (process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true") return [];
    const identity = await ctx.auth.getUserIdentity();
    if (!identity?.subject || !validPrincipalId(identity.subject)) return [];
    const invitations = await ctx.db.query("workspaceInvitations").withIndex("by_target_status", (q) =>
      (q.eq("targetAccountId", identity.subject) as unknown as { eq(field: string, value: string): never })
        .eq("status", "pending")).take(51);
    if (invitations.length > 50) return []; // unexpected backlog: fail closed, not partial disclosure
    return invitations.filter((row) => row.status === "pending" &&
      row.targetAccountId === identity.subject && row.expiresAt > Date.now()).map((row) => ({
      invitationId: String(row._id), workspaceId: row.workspaceId, role: row.role, expiresAt: row.expiresAt,
    }));
  },
});

/** Managers may withdraw a pending invitation, with the same privilege limits. */
export const revokeInvitation = mutationGeneric({
  args: { invitationId: v.id("workspaceInvitations") },
  returns: v.boolean(),
  handler: async (ctx, { invitationId }) => {
    writeGate();
    const invitation = await ctx.db.get(invitationId);
    if (!invitation || invitation.status !== "pending") denied();
    const { actor, ws } = await manager(ctx, invitation.workspaceId);
    const target = await member(ctx, invitation.workspaceId, invitation.targetAccountId);
    if (!canIssueInvitation(actor, ws.ownerId, invitation.targetAccountId, invitation.role, target)) denied();
    await ctx.db.patch(invitation._id, { status: "revoked", resolvedAt: Date.now() });
    await event(ctx, invitation.workspaceId, actor.accountId, "invitation.revoked", String(invitation._id), "pending", "revoked");
    return true;
  },
});

/** The invitation is bound to the exact authenticated account, including rejoin
 * of a revoked membership. Suspended members cannot bypass suspension. */
export const acceptInvitation = mutationGeneric({
  args: { invitationId: v.id("workspaceInvitations") },
  returns: v.boolean(),
  handler: async (ctx, { invitationId }) => {
    writeGate();
    const identity = await who(ctx);
    const invitation = await ctx.db.get(invitationId);
    if (!invitation || invitation.status !== "pending" ||
        invitation.targetAccountId !== identity || invitation.expiresAt <= Date.now()) denied();
    const ws = await workspace(ctx, invitation.workspaceId);
    const issuer = await member(ctx, invitation.workspaceId, invitation.createdByAccountId);
    const target = await member(ctx, invitation.workspaceId, identity);
    if (!canIssueInvitation(issuer, ws.ownerId, identity, invitation.role, target)) denied();
    if (target) await ctx.db.patch(target._id as never, { role: invitation.role, status: "active" });
    else await ctx.db.insert("workspaceMemberships", {
      workspaceId: invitation.workspaceId, accountId: identity, role: invitation.role, status: "active",
    });
    await ctx.db.patch(invitation._id, { status: "accepted", resolvedAt: Date.now() });
    await event(ctx, invitation.workspaceId, identity, "invitation.accepted", String(invitation._id), "pending", "accepted");
    return true;
  },
});

export const declineInvitation = mutationGeneric({
  args: { invitationId: v.id("workspaceInvitations") },
  returns: v.boolean(),
  handler: async (ctx, { invitationId }) => {
    writeGate();
    const identity = await who(ctx);
    const invitation = await ctx.db.get(invitationId);
    if (!invitation || invitation.targetAccountId !== identity || invitation.status !== "pending") denied();
    await ctx.db.patch(invitation._id, { status: "declined", resolvedAt: Date.now() });
    await event(ctx, invitation.workspaceId, identity, "invitation.declined", String(invitation._id), "pending", "declined");
    return true;
  },
});

/** Owner-only teamspace registry. No content or permissions are granted. */
export const registerTeamspace = mutationGeneric({
  args: { workspaceId: v.string(), teamspaceId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId, teamspaceId }) => {
    writeGate();
    const { actor } = await manager(ctx, workspaceId);
    if (actor.role !== "owner" || !validScopeId(teamspaceId)) denied();
    const rows = await ctx.db.query("workspaceTeamspaces").withIndex("by_workspace_teamspace", (q) =>
      (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never })
        .eq("teamspaceId", teamspaceId)).take(2);
    if (rows.length !== 0) denied();
    await ctx.db.insert("workspaceTeamspaces", {
      workspaceId, teamspaceId, createdByAccountId: actor.accountId, createdAt: Date.now(),
    });
    await event(ctx, workspaceId, actor.accountId, "teamspace.registered", teamspaceId, null, "registered");
    return true;
  },
});

/** Immutable metadata-only scope registration. Parent chain and teamspace are
 * checked within the same transaction. Existing personal pages are NOT linked. */
export const registerPageScope = mutationGeneric({
  args: { workspaceId: v.string(), pageId: v.string(), parentId: nullableIdV, teamspaceId: nullableIdV },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    writeGate();
    const { actor } = await manager(ctx, a.workspaceId);
    if (actor.role !== "owner" || !validScopeId(a.pageId)) denied();
    const collisions = await ctx.db.query("workspacePageScopes")
      .withIndex("by_pageId", (q) => q.eq("pageId", a.pageId)).take(1);
    if (collisions.length) denied(); // same ID cannot be silently rebound to a different tenant
    let teamspaceExists = a.teamspaceId === null;
    if (a.teamspaceId !== null) {
      if (!validScopeId(a.teamspaceId)) denied();
      const rows = await ctx.db.query("workspaceTeamspaces").withIndex("by_workspace_teamspace", (q) =>
        (q.eq("workspaceId", a.workspaceId) as unknown as { eq(field: string, value: string): never })
          .eq("teamspaceId", a.teamspaceId!)).take(2);
      teamspaceExists = rows.length === 1 && rows[0].workspaceId === a.workspaceId;
    }
    const ancestors: Array<{ workspaceId: string; pageId: string; parentId: string | null; teamspaceId: string | null }> = [];
    let cursor = a.parentId;
    const seen = new Set<string>([a.pageId]);
    while (cursor !== null) {
      if (seen.has(cursor) || ancestors.length >= 64 || !validScopeId(cursor)) denied();
      seen.add(cursor);
      const rows = await ctx.db.query("workspacePageScopes").withIndex("by_workspace_page", (q) =>
        (q.eq("workspaceId", a.workspaceId) as unknown as { eq(field: string, value: string): never })
          .eq("pageId", cursor!)).take(2);
      if (rows.length !== 1 || rows[0].workspaceId !== a.workspaceId || rows[0].pageId !== cursor) denied();
      ancestors.push({
        workspaceId: rows[0].workspaceId, pageId: rows[0].pageId,
        parentId: rows[0].parentId, teamspaceId: rows[0].teamspaceId,
      });
      cursor = rows[0].parentId;
    }
    if (!validNewPageScope(a.workspaceId, a.pageId, a.parentId, a.teamspaceId, ancestors, teamspaceExists)) denied();
    await ctx.db.insert("workspacePageScopes", {
      workspaceId: a.workspaceId, pageId: a.pageId, parentId: a.parentId, teamspaceId: a.teamspaceId,
    });
    await event(ctx, a.workspaceId, actor.accountId, "page.scope.registered", a.pageId, null,
      (a.parentId ?? "root") + "/" + (a.teamspaceId ?? "workspace"));
    return true;
  },
});
