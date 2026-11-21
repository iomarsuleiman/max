import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import * as admin from "../lib/domain/admin";
import { listReports, platformRole, setModeration, setReportStatus, submitReport, type PlatformRole } from "../lib/domain/admin";
import { convexDb } from "./convexDb";
import { purger } from "./organizations";
import { reviewIntegration, reviewQueue } from "../lib/domain/integrations";
import { guard } from "./sharing";

/**
 * The platform admin dashboard. Only signed-in people with a VERIFIED email listed in
 * MAX_ADMIN_EMAILS (may act) or MAX_SUPPORT_EMAILS (read-only) get past adminOf:
 *   npx convex env set MAX_ADMIN_EMAILS you@example.com
 * Platform roles are separate from organization roles; they never open page contents.
 */

type Identity = { subject: string; email?: string; emailVerified?: boolean; name?: string };

async function adminOf(ctx: { auth: { getUserIdentity(): Promise<Identity | null> } }, need: PlatformRole = "admin") {
  const identity = await ctx.auth.getUserIdentity();
  const role = identity && identity.emailVerified !== false ? platformRole(identity.email) : null;
  if (!identity || !role) throw new ConvexError({ code: "FORBIDDEN", message: "This page is for Max's admins." });
  if (need === "admin" && role !== "admin") throw new ConvexError({ code: "FORBIDDEN", message: "Support staff can look but not change anything." });
  return { ...identity, role, actor: { id: identity.subject, name: identity.name ?? identity.email ?? "Max admin" } };
}
const viewer = (ctx: { auth: { getUserIdentity(): Promise<Identity | null> } }) => adminOf(ctx, "support");

const writer = (ctx: unknown) => convexDb((ctx as GenericMutationCtx<GenericDataModel>).db);

export const check = queryGeneric({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const role = identity && identity.emailVerified !== false ? platformRole(identity.email) : null;
    return { admin: !!role, role };
  },
});

export const overview = queryGeneric({
  args: { at: v.number() },
  handler: async (ctx, a) => {
    await viewer(ctx);
    return guard(() => admin.adminOverview(convexDb(ctx.db), a.at));
  },
});

const page = { search: v.optional(v.string()), offset: v.optional(v.number()), limit: v.optional(v.number()) };

export const users = queryGeneric({
  args: page,
  handler: async (ctx, a) => {
    await viewer(ctx);
    return guard(() => admin.adminUsers(convexDb(ctx.db), a));
  },
});

export const user = queryGeneric({
  args: { userId: v.string() },
  handler: async (ctx, a) => {
    await viewer(ctx);
    return guard(() => admin.adminUser(convexDb(ctx.db), a.userId));
  },
});

export const organizations = queryGeneric({
  args: { ...page, at: v.number() },
  handler: async (ctx, { at, ...a }) => {
    await viewer(ctx);
    return guard(() => admin.adminOrganizations(convexDb(ctx.db), a, at));
  },
});

export const organization = queryGeneric({
  args: { orgId: v.string(), at: v.number() },
  handler: async (ctx, a) => {
    await viewer(ctx);
    return guard(() => admin.adminOrganization(convexDb(ctx.db), a.orgId, a.at));
  },
});

export const audit = queryGeneric({
  args: { scope: v.optional(v.string()), action: v.optional(v.string()), actor: v.optional(v.string()), before: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    await viewer(ctx);
    return guard(() => admin.adminAudit(convexDb(ctx.db), a));
  },
});

export const orgAction = mutationGeneric({
  args: {
    orgId: v.string(),
    action: v.union(v.literal("moderate"), v.literal("recover"), v.literal("limits"), v.literal("removeMember"), v.literal("delete")),
    status: v.optional(v.union(v.literal("active"), v.literal("suspended"), v.literal("banned"))),
    reason: v.optional(v.string()),
    accountId: v.optional(v.string()),
    maxMembers: v.optional(v.union(v.number(), v.null())),
    confirmName: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const me = await adminOf(ctx);
    const db = writer(ctx);
    const now = Date.now();
    const reason = a.reason ?? "";
    return guard(async () => {
      if (a.action === "moderate") return admin.setOrgModeration(db, me.actor, a.orgId, a.status ?? "active", reason, now);
      if (a.action === "recover") return admin.recoverOrgOwnership(db, me.actor, a.orgId, a.accountId ?? "", reason, now);
      if (a.action === "limits") return admin.setOrgLimits(db, me.actor, a.orgId, { maxMembers: a.maxMembers ?? null }, now);
      if (a.action === "removeMember") return admin.adminRemoveOrgMember(db, me.actor, a.orgId, a.accountId ?? "", reason, now);
      return admin.adminDeleteOrg(db, me.actor, a.orgId, a.confirmName ?? "", reason, purger(ctx as GenericMutationCtx<GenericDataModel>), now);
    });
  },
});

export const apps = queryGeneric({
  args: {},
  handler: async (ctx) => {
    await viewer(ctx);
    return guard(() => reviewQueue(convexDb(ctx.db)));
  },
});

export const reviewApp = mutationGeneric({
  args: { appId: v.string(), decision: v.union(v.literal("published"), v.literal("rejected"), v.literal("suspended")), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await adminOf(ctx);
    return guard(() => reviewIntegration(writer(ctx), me.actor, a.appId, a.decision, a.note ?? "", Date.now()));
  },
});

export const reports = queryGeneric({
  args: {},
  handler: async (ctx) => {
    await viewer(ctx);
    return guard(() => listReports(convexDb(ctx.db)));
  },
});

export const setStatus = mutationGeneric({
  args: { userId: v.string(), status: v.union(v.literal("active"), v.literal("suspended"), v.literal("banned")), reason: v.string() },
  handler: async (ctx, a) => {
    const me = await adminOf(ctx);
    return guard(() => setModeration(writer(ctx), me.subject, a.userId, a.status, a.reason, Date.now()));
  },
});

export const setReport = mutationGeneric({
  args: { id: v.string(), status: v.union(v.literal("open"), v.literal("resolved")) },
  handler: async (ctx, a) => {
    await adminOf(ctx);
    return guard(() => setReportStatus(writer(ctx), a.id, a.status, Date.now()));
  },
});

/** Anyone can report a problem, signed in or not. */
export const report = mutationGeneric({
  args: {
    kind: v.union(v.literal("bug"), v.literal("content"), v.literal("other")),
    message: v.string(),
    url: v.optional(v.union(v.string(), v.null())),
    pageId: v.optional(v.union(v.string(), v.null())),
    siteSlug: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, a) => {
    const identity = (await ctx.auth.getUserIdentity()) as Identity | null;
    const reporter = identity ? { id: identity.subject, name: identity.name ?? null, email: identity.email ?? null } : null;
    return guard(() => submitReport(writer(ctx), reporter, a, Date.now()));
  },
});
