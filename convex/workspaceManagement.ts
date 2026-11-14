import { mutationGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import {
  canManageAffiliation, canManageGrant, canManageMember, canTransferOwnership,
  validPrincipalId, validScopeId, validWorkspaceId,
} from "../lib/domain/workspaceManagementPolicy";

type Ctx = GenericMutationCtx<GenericDataModel>;
type Role = "owner" | "admin" | "member" | "guest";
type Status = "active" | "suspended" | "revoked";
type Member = { _id: string; accountId: string; role: Role; status: Status };
type Workspace = { _id: string; workspaceId: string; ownerId: string; status: "active" | "disabled" };
const statusV = v.union(v.literal("active"), v.literal("suspended"), v.literal("revoked"));
const editableRoleV = v.union(v.literal("admin"), v.literal("member"), v.literal("guest"));
const subjectTypeV = v.union(v.literal("account"), v.literal("group"), v.literal("workspace_role"));
const effectV = v.union(v.literal("allow"), v.literal("deny"));
const levelV = v.union(v.literal("view"), v.literal("comment"), v.literal("edit_content"), v.literal("edit"), v.literal("full_access"));

function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "Workspace operation is not permitted." });
}
function writeGate(): void {
  // Deliberately OFF in every deployment unless a deployment operator opts in.
  if (process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true") denied();
}
async function authenticated(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}
async function workspaceById(ctx: Ctx, id: string): Promise<Workspace> {
  if (!validWorkspaceId(id)) denied();
  const rows = await ctx.db.query("workspaces")
    .withIndex("by_workspaceId", (q) => q.eq("workspaceId", id)).take(2);
  if (rows.length !== 1 || rows[0].workspaceId !== id || rows[0].status !== "active") denied();
  return rows[0] as Workspace;
}
async function membership(ctx: Ctx, workspaceId: string, accountId: string): Promise<Member | null> {
  if (!validPrincipalId(accountId)) denied();
  const rows = await ctx.db.query("workspaceMemberships")
    .withIndex("by_workspace_account", (q) =>
      (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("accountId", accountId))
    .take(2);
  if (rows.length > 1 || (rows[0] && (rows[0].workspaceId !== workspaceId || rows[0].accountId !== accountId))) denied();
  return (rows[0] as Member | undefined) ?? null;
}
async function requireManager(ctx: Ctx, id: string): Promise<{ workspace: Workspace; actor: Member }> {
  const accountId = await authenticated(ctx);
  const workspace = await workspaceById(ctx, id);
  const actor = await membership(ctx, id, accountId);
  if (!actor || actor.status !== "active") denied();
  if ((actor.role === "owner") !== (workspace.ownerId === accountId)) denied();
  if (actor.role !== "owner" && actor.role !== "admin") denied();
  return { workspace, actor };
}
async function logChange(ctx: Ctx, workspaceId: string, actorId: string, operation: string,
  targetId: string, previous: string | null, next: string | null): Promise<void> {
  await ctx.db.insert("workspaceSecurityEvents", {
    workspaceId, actorId, operation, targetId, previous, next, at: Date.now(),
  });
}
async function scopedPage(ctx: Ctx, workspaceId: string, pageId: string): Promise<void> {
  if (!validScopeId(pageId)) denied();
  const rows = await ctx.db.query("workspacePageScopes")
    .withIndex("by_workspace_page", (q) =>
      (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId))
    .take(2);
  if (rows.length !== 1 || rows[0].workspaceId !== workspaceId || rows[0].pageId !== pageId) denied();
}

/** Create a standalone shadow workspace and exactly one owner membership, atomically.
 * No personal pages migrate, and no shared content routes become available.
 */
export const createWorkspace = mutationGeneric({
  args: { workspaceId: v.string() },
  returns: v.string(),
  handler: async (ctx, { workspaceId }) => {
    writeGate();
    const actorId = await authenticated(ctx);
    if (!validWorkspaceId(workspaceId)) denied();
    const [existing, oldMembers, oldGroups, oldTeams, oldScopes, oldGrants, oldInvites, oldTeamspaceRegistry] = await Promise.all([
      ctx.db.query("workspaces").withIndex("by_workspaceId", (q) => q.eq("workspaceId", workspaceId)).take(1),
      ctx.db.query("workspaceMemberships").withIndex("by_workspace_account", (q) => q.eq("workspaceId", workspaceId)).take(1),
      ctx.db.query("workspaceGroupMemberships").withIndex("by_workspace_account", (q) => q.eq("workspaceId", workspaceId)).take(1),
      ctx.db.query("workspaceTeamspaceMemberships").withIndex("by_workspace_account", (q) => q.eq("workspaceId", workspaceId)).take(1),
      ctx.db.query("workspacePageScopes").withIndex("by_workspace_page", (q) => q.eq("workspaceId", workspaceId)).take(1),
      ctx.db.query("workspacePageGrants").withIndex("by_workspace_page", (q) => q.eq("workspaceId", workspaceId)).take(1),
      ctx.db.query("workspaceInvitations").withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId)).take(1),
      ctx.db.query("workspaceTeamspaces").withIndex("by_workspace_teamspace", (q) => q.eq("workspaceId", workspaceId)).take(1),
    ]);
    if ([existing, oldMembers, oldGroups, oldTeams, oldScopes, oldGrants, oldInvites, oldTeamspaceRegistry].some((rows) => rows.length > 0)) denied();
    await ctx.db.insert("workspaces", { workspaceId, ownerId: actorId, status: "active" });
    await ctx.db.insert("workspaceMemberships", { workspaceId, accountId: actorId, role: "owner", status: "active" });
    await logChange(ctx, workspaceId, actorId, "workspace.created", workspaceId, null, "active");
    return workspaceId;
  },
});

/** Admins may only manage members/guests. Only owners may appoint admins.
 * The sole owner cannot be modified here. Revocation is terminal in this PR.
 */
export const setMembership = mutationGeneric({
  args: { workspaceId: v.string(), accountId: v.string(), role: editableRoleV, status: statusV },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    writeGate();
    const { workspace, actor } = await requireManager(ctx, a.workspaceId);
    const target = await membership(ctx, a.workspaceId, a.accountId);
    // PR 05: a new account cannot bypass identity-bound invitation acceptance.
    if (!target || !canManageMember(actor, workspace.ownerId, target, a)) denied();
    if (target?.role === a.role && target.status === a.status) return false;
    if (target) {
      await ctx.db.patch(target._id as never, { role: a.role, status: a.status });
    } else {
      await ctx.db.insert("workspaceMemberships", {
        workspaceId: a.workspaceId, accountId: a.accountId, role: a.role, status: a.status,
      });
    }
    await logChange(ctx, a.workspaceId, actor.accountId, "member.changed", a.accountId,
      target ? target.role + "/" + target.status : null, a.role + "/" + a.status);
    return true;
  },
});

/** Single-owner handoff: promote an existing active admin/member while demoting
 * the prior active owner to admin in the SAME Convex transaction.
 */
export const transferOwnership = mutationGeneric({
  args: { workspaceId: v.string(), nextOwnerId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { workspaceId, nextOwnerId }) => {
    writeGate();
    const { workspace, actor } = await requireManager(ctx, workspaceId);
    const nextOwner = await membership(ctx, workspaceId, nextOwnerId);
    if (!canTransferOwnership(actor, workspace.ownerId, actor, nextOwner)) denied();
    if (!nextOwner) denied();
    await ctx.db.patch(actor._id as never, { role: "admin" });
    await ctx.db.patch(nextOwner._id as never, { role: "owner" });
    await ctx.db.patch(workspace._id as never, { ownerId: nextOwnerId });
    await logChange(ctx, workspaceId, actor.accountId, "owner.transferred", nextOwnerId,
      actor.accountId, nextOwnerId);
    return true;
  },
});

/** Revoke/suspend a group or teamspace affiliation without trusting a browser role. */
export const setAffiliation = mutationGeneric({
  args: {
    workspaceId: v.string(), accountId: v.string(),
    kind: v.union(v.literal("group"), v.literal("teamspace")),
    affiliationId: v.string(), status: statusV,
  },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    writeGate();
    const { workspace, actor } = await requireManager(ctx, a.workspaceId);
    if (!validScopeId(a.affiliationId)) denied();
    const target = await membership(ctx, a.workspaceId, a.accountId);
    if (!canManageAffiliation(actor, workspace.ownerId, target)) denied();
    if (a.status === "active" && target?.status !== "active") denied();
    // A teamspace affiliation may only be activated for an existing registered
    // workspace teamspace. Otherwise a phantom ID could later gain privileges.
    if (a.kind === "teamspace" && a.status === "active") {
      const registered = await ctx.db.query("workspaceTeamspaces")
        .withIndex("by_workspace_teamspace", (q) =>
          (q.eq("workspaceId", a.workspaceId) as unknown as { eq(field: string, value: string): never })
            .eq("teamspaceId", a.affiliationId)).take(2);
      if (registered.length !== 1 || registered[0].workspaceId !== a.workspaceId ||
          registered[0].teamspaceId !== a.affiliationId) denied();
    }
    const table = a.kind === "group" ? "workspaceGroupMemberships" : "workspaceTeamspaceMemberships";
    const rows = a.kind === "group"
      ? await ctx.db.query("workspaceGroupMemberships").withIndex("by_workspace_account", (q) =>
          (q.eq("workspaceId", a.workspaceId) as unknown as { eq(field: string, value: string): never }).eq("accountId", a.accountId)).take(101)
      : await ctx.db.query("workspaceTeamspaceMemberships").withIndex("by_workspace_account", (q) =>
          (q.eq("workspaceId", a.workspaceId) as unknown as { eq(field: string, value: string): never }).eq("accountId", a.accountId)).take(101);
    if (rows.length > 100) denied();
    const matches = rows.filter((row) => (a.kind === "group" ? row.groupId : row.teamspaceId) === a.affiliationId);
    if (matches.length > 1) denied();
    const existing = matches[0];
    if (existing?.status === a.status) return false;
    if (!existing && a.status !== "active") return false;
    if (existing) await ctx.db.patch(existing._id as never, { status: a.status });
    else if (table === "workspaceGroupMemberships") {
      await ctx.db.insert("workspaceGroupMemberships", {
        workspaceId: a.workspaceId, accountId: a.accountId, groupId: a.affiliationId, status: a.status,
      });
    } else {
      await ctx.db.insert("workspaceTeamspaceMemberships", {
        workspaceId: a.workspaceId, accountId: a.accountId, teamspaceId: a.affiliationId, status: a.status,
      });
    }
    await logChange(ctx, a.workspaceId, actor.accountId, a.kind + ".affiliation.changed",
      a.accountId + ":" + a.affiliationId, existing?.status ?? null, a.status);
    return true;
  },
});

async function pageGrants(ctx: Ctx, workspaceId: string, pageId: string, subjectType: string, subjectId: string) {
  const rows = await ctx.db.query("workspacePageGrants")
    .withIndex("by_workspace_page", (q) =>
      (q.eq("workspaceId", workspaceId) as unknown as { eq(field: string, value: string): never }).eq("pageId", pageId))
    .take(101);
  if (rows.length > 100) denied();
  const matches = rows.filter((row) => row.subjectType === subjectType && row.subjectId === subjectId);
  if (matches.length > 1) denied(); // corrupted duplicated grant must be reviewed, not overwritten
  return matches[0] ?? null;
}
function validSubject(subjectType: "account" | "group" | "workspace_role", subjectId: string): boolean {
  return subjectType === "workspace_role"
    ? ["owner", "admin", "member", "guest"].includes(subjectId)
    : subjectType === "account" ? validPrincipalId(subjectId) : validScopeId(subjectId);
}

/** Grants can be staged for previously registered shadow page scopes ONLY.
 * No mutation exposes a shared document, media, search, or MCP read.
 */
export const setPageGrant = mutationGeneric({
  args: {
    workspaceId: v.string(), pageId: v.string(), subjectType: subjectTypeV,
    subjectId: v.string(), effect: effectV, level: levelV,
  },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    writeGate();
    const { workspace, actor } = await requireManager(ctx, a.workspaceId);
    if (!validSubject(a.subjectType, a.subjectId) ||
        !canManageGrant(actor, workspace.ownerId, a.subjectType, a.subjectId)) denied();
    await scopedPage(ctx, a.workspaceId, a.pageId);
    if (a.subjectType === "account") {
      const subject = await membership(ctx, a.workspaceId, a.subjectId);
      if (!subject || (actor.role === "admin" && (subject.role === "owner" || subject.role === "admin"))) denied();
    }
    const existing = await pageGrants(ctx, a.workspaceId, a.pageId, a.subjectType, a.subjectId);
    if (existing?.effect === a.effect && existing.level === a.level) return false;
    if (existing) await ctx.db.patch(existing._id as never, { effect: a.effect, level: a.level });
    else await ctx.db.insert("workspacePageGrants", a);
    await logChange(ctx, a.workspaceId, actor.accountId, "page.grant.changed",
      a.pageId + ":" + a.subjectType + ":" + a.subjectId,
      existing ? existing.effect + "/" + existing.level : null, a.effect + "/" + a.level);
    return true;
  },
});

export const removePageGrant = mutationGeneric({
  args: { workspaceId: v.string(), pageId: v.string(), subjectType: subjectTypeV, subjectId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    writeGate();
    const { workspace, actor } = await requireManager(ctx, a.workspaceId);
    if (!validSubject(a.subjectType, a.subjectId) ||
        !canManageGrant(actor, workspace.ownerId, a.subjectType, a.subjectId)) denied();
    await scopedPage(ctx, a.workspaceId, a.pageId);
    if (a.subjectType === "account" && actor.role === "admin") {
      const subject = await membership(ctx, a.workspaceId, a.subjectId);
      if (!subject || subject.role === "owner" || subject.role === "admin") denied();
    }
    const previous = await pageGrants(ctx, a.workspaceId, a.pageId, a.subjectType, a.subjectId);
    if (!previous) return false;
    await ctx.db.delete(previous._id as never);
    await logChange(ctx, a.workspaceId, actor.accountId, "page.grant.removed",
      a.pageId + ":" + a.subjectType + ":" + a.subjectId, previous.effect + "/" + previous.level, null);
    return true;
  },
});
