import { actionGeneric, internalMutationGeneric, internalQueryGeneric, makeFunctionReference, mutationGeneric, queryGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import * as apps from "../lib/domain/integrations";
import { execute } from "../lib/domain/ops";
import { MaxError } from "../lib/domain/errors";
import { convexDb, convexStorage } from "./convexDb";
import { checkSecret } from "./ops";
import { guard } from "./sharing";

/**
 * Connectors (lib/domain/integrations.ts). People manage apps with their Clerk sign-in; apps call
 * appRun / exchange through Max's server (app/api/v1), which holds the server secret.
 */

type Identity = { subject: string; name?: string; email?: string };
async function who(ctx: { auth: { getUserIdentity(): Promise<Identity | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in to manage apps." });
  return { id: identity.subject, name: identity.name ?? identity.email ?? "Someone" };
}
const writer = (ctx: unknown) => convexDb((ctx as GenericMutationCtx<GenericDataModel>).db);
const appInput = v.object({
  name: v.string(),
  description: v.optional(v.string()),
  icon: v.optional(v.union(v.string(), v.null())),
  website: v.optional(v.union(v.string(), v.null())),
  scopes: v.array(v.string()),
  redirectUris: v.optional(v.array(v.string())),
  webhookUrl: v.optional(v.union(v.string(), v.null())),
  events: v.optional(v.array(v.string())),
});

export const marketplace = queryGeneric({
  args: {},
  handler: async (ctx) => guard(async () => apps.marketplace(convexDb(ctx.db), (await who(ctx)).id)),
});
export const info = queryGeneric({
  args: { appId: v.string() },
  handler: async (ctx, a) => guard(async () => apps.appInfo(convexDb(ctx.db), a.appId, (await who(ctx)).id)),
});
export const mine = queryGeneric({
  args: {},
  handler: async (ctx) => guard(async () => apps.myIntegrations(convexDb(ctx.db), (await who(ctx)).id)),
});
export const installed = queryGeneric({
  args: { ws: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) =>
    guard(async () => {
      const me = await who(ctx);
      const db = convexDb(ctx.db);
      return apps.installedApps(db, await apps.installTarget(db, me.id, a.ws ?? null));
    }),
});

export const manage = mutationGeneric({
  args: { action: v.union(v.literal("create"), v.literal("update"), v.literal("rotate"), v.literal("submit"), v.literal("delete")), appId: v.optional(v.string()), app: v.optional(appInput) },
  handler: async (ctx, a) => {
    const me = await who(ctx);
    const db = writer(ctx);
    const now = Date.now();
    return guard(async () => {
      if (a.action === "create") return apps.createIntegration(db, me.id, a.app!, now);
      const id = a.appId ?? "";
      if (a.action === "update") return apps.updateIntegration(db, me.id, id, a.app!, now);
      if (a.action === "rotate") return apps.rotateSecrets(db, me.id, id, now);
      if (a.action === "submit") return apps.submitIntegration(db, me.id, id, now);
      return apps.deleteIntegration(db, me.id, id, now);
    });
  },
});

export const install = mutationGeneric({
  args: { appId: v.string(), ws: v.optional(v.union(v.string(), v.null())), scopes: v.array(v.string()), redirectUri: v.optional(v.union(v.string(), v.null())), state: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    const me = await who(ctx);
    return guard(() => apps.install(writer(ctx), me, { appId: a.appId, workspace: a.ws ?? null, scopes: a.scopes, redirectUri: a.redirectUri, state: a.state }, Date.now()));
  },
});

export const revoke = mutationGeneric({
  args: { installationId: v.string() },
  handler: async (ctx, a) => {
    const me = await who(ctx);
    return guard(() => apps.revokeInstallation(writer(ctx), me, a.installationId, Date.now()));
  },
});

/* ── Called by Max's API server (app/api/v1) ─────────────────────────────── */

const deliverRef = makeFunctionReference<"action">("integrations:deliver");

/** Runs one operation for an app token, with its granted scopes. */
export const appRun = mutationGeneric({
  args: { secret: v.string(), token: v.string(), op: v.string(), args: v.any() },
  handler: async (ctx, a) => {
    checkSecret(a.secret);
    const db = writer(ctx);
    return guard(async () => {
      const app = await apps.appForToken(db, a.token);
      if (!app) throw new MaxError("UNAUTHENTICATED", "That app token is invalid or was disconnected.");
      const outbox = { queued: 0 };
      const result = await execute(a.op, a.args, {
        db,
        storage: convexStorage(ctx.storage),
        ownerId: app.ownerId,
        now: Date.now(),
        source: "app",
        actor: app.actor,
        appScopes: app.scopes,
        outbox,
        ...(app.ownerId.startsWith("org_") ? { org: { role: "member" as const } } : {}),
      });
      await db.patch("installations", app.installationId, { lastUsedAt: Date.now() });
      if (outbox.queued) await ctx.scheduler.runAfter(0, deliverRef, {});
      return result;
    });
  },
});

export const exchange = mutationGeneric({
  args: { secret: v.string(), clientId: v.string(), clientSecret: v.string(), code: v.string(), redirectUri: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, a) => {
    checkSecret(a.secret);
    return guard(() => apps.exchangeCode(writer(ctx), a, Date.now()));
  },
});

/* ── Webhook delivery (actions can make network calls; mutations can't) ──── */

const dueRef = makeFunctionReference<"query">("integrations:due");
const markRef = makeFunctionReference<"mutation">("integrations:mark");

export const due = internalQueryGeneric({
  args: { now: v.number() },
  handler: async (ctx, a) => {
    const db = convexDb(ctx.db);
    const rows = (await db.findBy("webhookDeliveries", "status", "pending")).filter((d) => d.nextAt <= a.now).slice(0, 25);
    const out = [];
    for (const d of rows) {
      const app = await db.get("integrations", d.integrationId);
      out.push({ id: d._id, attempts: d.attempts, payload: d.payload, url: app?.status !== "suspended" ? (app?.webhookUrl ?? null) : null, secret: app?.signingSecret ?? "" });
    }
    return out;
  },
});

export const mark = internalMutationGeneric({
  args: { id: v.string(), ok: v.boolean(), error: v.union(v.string(), v.null()), attempts: v.number(), now: v.number() },
  handler: async (ctx, a) => {
    const db = convexDb(ctx.db);
    if (a.ok) await db.patch("webhookDeliveries", a.id, { status: "delivered", attempts: a.attempts, lastError: null });
    else await db.patch("webhookDeliveries", a.id, { status: a.attempts > apps.RETRY_MS.length ? "failed" : "pending", attempts: a.attempts, nextAt: a.now + (apps.RETRY_MS[a.attempts - 1] ?? 0), lastError: a.error });
  },
});

export const deliver = actionGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = (await ctx.runQuery(dueRef, { now })) as { id: string; attempts: number; payload: string; url: string | null; secret: string }[];
    let retryAt: number | null = null;
    for (const d of due) {
      const r = d.url ? await apps.sendWebhook(d.url, d.secret, d.payload, now) : { ok: false, error: "App unavailable" };
      const attempts = d.url ? d.attempts + 1 : apps.RETRY_MS.length + 1;
      await ctx.runMutation(markRef, { id: d.id, ok: r.ok, error: r.error, attempts, now });
      if (!r.ok && attempts <= apps.RETRY_MS.length) retryAt = Math.min(retryAt ?? Infinity, apps.RETRY_MS[attempts - 1]);
    }
    if (retryAt !== null) await ctx.scheduler.runAfter(retryAt, deliverRef, {});
  },
});
