import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import * as orgs from "../lib/domain/organizations";
import { accountDeleteAllData } from "../lib/domain/ops/account";
import { makeFunctionReference } from "convex/server";
import { convexDb, convexStorage } from "./convexDb";
import { guard } from "./sharing";

/**
 * Organizations (lib/domain/organizations.ts). The caller is always the signed-in Clerk identity;
 * invitations are answered only with a verified email. Every rule lives in the domain module.
 */

const deleteR2Object = makeFunctionReference<"action", { key: string }>("r2:deleteObject");
type Identity = { subject: string; name?: string; givenName?: string; email?: string; emailVerified?: boolean; pictureUrl?: string };
type Ctx = { auth: { getUserIdentity(): Promise<Identity | null> } };

async function actorOf(ctx: Ctx): Promise<orgs.OrgActor> {
  if (!orgs.organizationsEnabled()) throw new ConvexError({ code: "NOT_FOUND", message: "Organizations aren't available on this server." });
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to use organizations." });
  const name = (identity.name || identity.givenName || identity.email?.split("@")[0] || "Someone").slice(0, 120);
  // Clerk marks verified addresses; anything else can't answer invitations.
  return { id: identity.subject, name, image: identity.pictureUrl ?? null, email: identity.email ?? null, emailVerified: identity.emailVerified === true };
}

const writer = (ctx: unknown) => convexDb((ctx as GenericMutationCtx<GenericDataModel>).db);
const role = v.union(v.literal("admin"), v.literal("member"), v.literal("guest"));

/** Deletes everything in an organization's namespace with the account-deletion routine. */
export function purger(ctx: GenericMutationCtx<GenericDataModel>) {
  const db = convexDb(ctx.db);
  const storage = convexStorage(ctx.storage, (key) => ctx.scheduler.runAfter(0, deleteR2Object, { key }));
  return async (ns: string) => (await accountDeleteAllData.run({ db, storage, ownerId: ns, now: Date.now(), source: "ui" }, { confirm: true })).removed;
}

export const mine = queryGeneric({
  args: { at: v.number() },
  handler: async (ctx, a) => {
    if (!orgs.organizationsEnabled()) return { enabled: false, organizations: [], invitations: [] };
    const actor = await actorOf(ctx);
    return guard(async () => ({ enabled: true, ...(await orgs.myOrganizations(convexDb(ctx.db), actor, a.at)) }));
  },
});

export const details = queryGeneric({
  args: { orgId: v.string(), at: v.number() },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.organizationDetails(convexDb(ctx.db), actor, a.orgId, a.at));
  },
});

export const audit = queryGeneric({
  args: { orgId: v.string(), before: v.optional(v.number()), action: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.orgAuditLog(convexDb(ctx.db), actor, a.orgId, a));
  },
});

export const create = mutationGeneric({
  args: { name: v.string(), icon: v.optional(v.union(v.string(), v.null())), description: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.createOrganization(writer(ctx), actor, a, Date.now()));
  },
});

export const update = mutationGeneric({
  args: { orgId: v.string(), name: v.optional(v.string()), icon: v.optional(v.union(v.string(), v.null())), description: v.optional(v.string()), slug: v.optional(v.string()) },
  handler: async (ctx, { orgId, ...patch }) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.updateOrganization(writer(ctx), actor, orgId, patch, Date.now()));
  },
});

export const setPolicies = mutationGeneric({
  args: { orgId: v.string(), membersCanInvite: v.optional(v.boolean()), allowGuests: v.optional(v.boolean()), allowPublicLinks: v.optional(v.boolean()), allowSites: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, ...patch }) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.setPolicies(writer(ctx), actor, orgId, patch, Date.now()));
  },
});

export const invite = mutationGeneric({
  args: { orgId: v.string(), emails: v.array(v.string()), role },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.inviteMembers(writer(ctx), actor, a.orgId, a.emails, a.role, Date.now()));
  },
});

export const answerInvite = mutationGeneric({
  args: { inviteId: v.string(), action: v.union(v.literal("accept"), v.literal("decline"), v.literal("revoke"), v.literal("resend")) },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    const fn: (db: ReturnType<typeof writer>, actor: orgs.OrgActor, id: string, now: number) => Promise<unknown> = { accept: orgs.acceptInvite, decline: orgs.declineInvite, revoke: orgs.revokeInvite, resend: orgs.resendInvite }[a.action];
    return guard(() => fn(writer(ctx), actor, a.inviteId, Date.now()));
  },
});

export const member = mutationGeneric({
  args: {
    orgId: v.string(),
    accountId: v.string(),
    action: v.union(v.literal("role"), v.literal("status"), v.literal("remove")),
    role: v.optional(role),
    status: v.optional(v.union(v.literal("active"), v.literal("suspended"))),
  },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    const db = writer(ctx);
    const now = Date.now();
    return guard(async () => {
      if (a.action === "role") return orgs.setMemberRole(db, actor, a.orgId, a.accountId, a.role ?? "member", now);
      if (a.action === "status") return orgs.setMemberStatus(db, actor, a.orgId, a.accountId, a.status ?? "active", now);
      return orgs.removeMember(db, actor, a.orgId, a.accountId, now);
    });
  },
});

export const leave = mutationGeneric({
  args: { orgId: v.string() },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.leaveOrganization(writer(ctx), actor, a.orgId, Date.now()));
  },
});

export const transfer = mutationGeneric({
  args: { orgId: v.string(), nextOwnerId: v.string(), confirmName: v.string() },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.transferOwnership(writer(ctx), actor, a.orgId, a.nextOwnerId, a.confirmName, Date.now()));
  },
});

export const team = mutationGeneric({
  args: {
    orgId: v.string(),
    teamId: v.optional(v.string()),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    memberIds: v.optional(v.array(v.string())),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, teamId, ...patch }) => {
    const actor = await actorOf(ctx);
    const db = writer(ctx);
    return guard(async () => {
      if (!teamId) return orgs.createTeam(db, actor, orgId, { name: patch.name ?? "", description: patch.description, memberIds: patch.memberIds }, Date.now());
      return orgs.updateTeam(db, actor, orgId, teamId, patch, Date.now());
    });
  },
});

export const remove = mutationGeneric({
  args: { orgId: v.string(), confirmName: v.string() },
  handler: async (ctx, a) => {
    const actor = await actorOf(ctx);
    return guard(() => orgs.deleteOwnOrganization(writer(ctx), actor, a.orgId, a.confirmName, purger(ctx as GenericMutationCtx<GenericDataModel>), Date.now()));
  },
});
