import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericQueryCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { sharedStore } from "./workspaceDatabases";
import { canManageExternalScope } from "../lib/domain/workspaceExternalSharePolicy";
import {
  listManagedLinks, nextLinkRevision, previewManagedLink,
  validLinkExpiry, validLinkPolicyRow, type LinkPolicyRow, type LinkPolicyStore,
  MAX_LINK_POLICIES_PER_SCOPE,
} from "../lib/domain/workspaceLinkPolicy";
import { validPrincipalId, validScopeId, validWorkspaceId } from "../lib/domain/workspaceManagementPolicy";

/** PR38 shadow management API only. There is NO share token, public route,
 * URL, document access, media access, search exposure, or MCP access. */
type Ctx = Pick<GenericQueryCtx<GenericDataModel>, "db" | "auth">;
const READ_GATE = "MAX_V2_LINK_POLICIES_READS_ENABLED";
const WRITE_GATE = "MAX_V2_LINK_POLICIES_WRITES_ENABLED";
const audienceV = v.union(v.literal("workspace_members"), v.literal("anyone_with_link"));
const previewV = v.object({
  linkId: v.string(),
  audience: audienceV,
  status: v.union(v.literal("active"), v.literal("expired"),
    v.literal("revoked"), v.literal("issuer_revoked")),
  expiresAt: v.number(), updatedAt: v.number(),
});
function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "Link policy operation denied." });
}
function canWrite(): void {
  if (process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true" ||
      process.env[WRITE_GATE] !== "true") denied();
}
async function who(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}
export function storeFor(ctx: Ctx): LinkPolicyStore {
  return {
    ...sharedStore(ctx),
    globalScopes: async (id: string) =>
      (await ctx.db.query("workspacePageScopes").withIndex("by_pageId",
        (q) => q.eq("pageId", id)).take(2))
        .map((row) => ({ workspaceId: row.workspaceId as string, pageId: row.pageId as string })),
    linkPoliciesById: async (id: string) => {
      try {
        const row = await ctx.db.get(id as never);
        if (!row) return [];
        return [{
          linkId: row._id, originWorkspaceId: row.originWorkspaceId,
          scopeId: row.scopeId, issuedByAccountId: row.issuedByAccountId,
          audience: row.audience, state: row.state,
          createdAt: row.createdAt, expiresAt: row.expiresAt,
          updatedAt: row.updatedAt, revokedAt: row.revokedAt,
        } as LinkPolicyRow];
      } catch { return []; }
    },
    linkPoliciesByScope: async (workspaceId: string, scopeId: string) => {
      const rows = await ctx.db.query("workspaceLinkPolicies")
        .withIndex("by_origin_scope", (q) =>
          (q.eq("originWorkspaceId", workspaceId) as unknown as {
            eq(field: string, value: string): never;
          }).eq("scopeId", scopeId)).take(MAX_LINK_POLICIES_PER_SCOPE + 1);
      return rows.map((r) => ({
        linkId: r._id, originWorkspaceId: r.originWorkspaceId, scopeId: r.scopeId,
        issuedByAccountId: r.issuedByAccountId, audience: r.audience, state: r.state,
        createdAt: r.createdAt, expiresAt: r.expiresAt,
        updatedAt: r.updatedAt, revokedAt: r.revokedAt,
      } as LinkPolicyRow));
    },
  };
}
async function load(ctx: Ctx, linkId: string): Promise<LinkPolicyRow> {
  const rows = await storeFor(ctx).linkPoliciesById(linkId);
  if (rows.length !== 1 || rows[0].linkId !== linkId ||
      !validLinkPolicyRow(rows[0])) denied();
  return rows[0];
}
async function ensureManager(ctx: Ctx, actor: string, workspaceId: string, scopeId: string): Promise<void> {
  if (!validWorkspaceId(workspaceId) || !validScopeId(scopeId) ||
      !(await canManageExternalScope(storeFor(ctx), actor, workspaceId, scopeId))) denied();
}

/** Issue only a share-policy descriptor. The ID is NOT a bearer credential. */
export const issueLinkPolicy = mutationGeneric({
  args: { originWorkspaceId: v.string(), scopeId: v.string(),
    audience: audienceV, expiresAt: v.number() },
  returns: v.id("workspaceLinkPolicies"),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    if (!validLinkExpiry(now, a.expiresAt)) denied();
    await ensureManager(ctx, actor, a.originWorkspaceId, a.scopeId);
    const existing = await storeFor(ctx).linkPoliciesByScope(a.originWorkspaceId, a.scopeId);
    if (existing.length >= MAX_LINK_POLICIES_PER_SCOPE ||
        new Set(existing.map((r) => r.linkId)).size !== existing.length ||
        existing.some((r) => !validLinkPolicyRow(r) ||
          r.originWorkspaceId !== a.originWorkspaceId || r.scopeId !== a.scopeId)) denied();
    const id = await ctx.db.insert("workspaceLinkPolicies", {
      originWorkspaceId: a.originWorkspaceId, scopeId: a.scopeId,
      issuedByAccountId: actor, audience: a.audience, state: "active" as const,
      createdAt: now, expiresAt: a.expiresAt, updatedAt: now, revokedAt: null,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.originWorkspaceId, actorId: actor,
      operation: "link_policy.issued", targetId: a.scopeId,
      previous: null, next: "active", at: now,
    });
    return id;
  },
});

/** Management-only lookup: no page titles, account identities or document data. */
export const readLinkPolicy = queryGeneric({
  args: { linkId: v.id("workspaceLinkPolicies") },
  returns: v.union(v.null(), previewV),
  handler: async (ctx, a) => {
    if (process.env[READ_GATE] !== "true") return null;
    try { return await previewManagedLink(storeFor(ctx), await who(ctx), a.linkId, Date.now()); }
    catch { return null; }
  },
});
export const listLinkPolicies = queryGeneric({
  args: { originWorkspaceId: v.string(), scopeId: v.string() },
  returns: v.array(previewV),
  handler: async (ctx, a) => {
    if (process.env[READ_GATE] !== "true") return [];
    try {
      return [...await listManagedLinks(
        storeFor(ctx), await who(ctx), a.originWorkspaceId, a.scopeId, Date.now(),
      )];
    } catch { return []; }
  },
});

/** Revision-guarded edit. Cannot revive a revoked/expired/issuer-revoked link;
 * absolute lifetime is bounded from its ORIGINAL creation, not refreshed. */
export const updateLinkPolicy = mutationGeneric({
  args: { linkId: v.id("workspaceLinkPolicies"), expectedUpdatedAt: v.number(),
    audience: audienceV, expiresAt: v.number() },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now(), row = await load(ctx, a.linkId);
    const preview = await previewManagedLink(storeFor(ctx), actor, a.linkId, now);
    if (!preview || preview.status !== "active" ||
        row.updatedAt !== a.expectedUpdatedAt ||
        !validLinkExpiry(now, a.expiresAt) ||
        !validLinkExpiry(row.createdAt, a.expiresAt)) denied();
    const updatedAt = nextLinkRevision(row.updatedAt, now);
    if (updatedAt === null) denied();
    await ctx.db.patch(a.linkId, { audience: a.audience, expiresAt: a.expiresAt, updatedAt });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: row.originWorkspaceId, actorId: actor,
      operation: "link_policy.updated", targetId: row.scopeId,
      previous: row.audience, next: a.audience, at: now,
    });
    return updatedAt;
  },
});

/** Revocation is terminal, even when a previous issuer lost permissions. */
export const revokeLinkPolicy = mutationGeneric({
  args: { linkId: v.id("workspaceLinkPolicies"), expectedUpdatedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now(), row = await load(ctx, a.linkId);
    await ensureManager(ctx, actor, row.originWorkspaceId, row.scopeId);
    if (row.state !== "active" || row.updatedAt !== a.expectedUpdatedAt) denied();
    const updatedAt = nextLinkRevision(row.updatedAt, now);
    if (updatedAt === null) denied();
    await ctx.db.patch(a.linkId, { state: "revoked", revokedAt: now, updatedAt });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: row.originWorkspaceId, actorId: actor,
      operation: "link_policy.revoked", targetId: row.scopeId,
      previous: "active", next: "revoked", at: now,
    });
    return updatedAt;
  },
});

/** Single-transaction revoke-all, bounded and fail-closed on corrupt records. */
export const revokeAllLinkPolicies = mutationGeneric({
  args: { originWorkspaceId: v.string(), scopeId: v.string() },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    await ensureManager(ctx, actor, a.originWorkspaceId, a.scopeId);
    const rows = await ctx.db.query("workspaceLinkPolicies")
      .withIndex("by_origin_scope", (q) =>
        (q.eq("originWorkspaceId", a.originWorkspaceId) as unknown as {
          eq(field: string, value: string): never;
        }).eq("scopeId", a.scopeId)).take(MAX_LINK_POLICIES_PER_SCOPE + 1);
    if (rows.length > MAX_LINK_POLICIES_PER_SCOPE ||
        rows.some((r) => !validLinkPolicyRow({ ...r, linkId: r._id }) ||
          r.originWorkspaceId !== a.originWorkspaceId || r.scopeId !== a.scopeId)) denied();
    let count = 0;
    for (const row of rows) {
      if (row.state !== "active") continue;
      const updatedAt = nextLinkRevision(row.updatedAt, now);
      if (updatedAt === null) denied();
      await ctx.db.patch(row._id, { state: "revoked", revokedAt: now, updatedAt });
      count++;
    }
    if (count) await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.originWorkspaceId, actorId: actor,
      operation: "link_policy.revoked_all", targetId: a.scopeId,
      previous: "active", next: "revoked", at: now,
    });
    return count;
  },
});
