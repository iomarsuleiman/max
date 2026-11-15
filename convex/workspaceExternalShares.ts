import { mutationGeneric, queryGeneric, type GenericDataModel, type GenericQueryCtx } from "convex/server";
import { ConvexError, v } from "convex/values";
import { sharedStore } from "./workspaceDatabases";
import {
  canManageExternalScope, nextExternalShareRevision, readAuthorizedExternalShare,
  validExternalShareExpiry, validExternalShareRecipient, validExternalShareRow,
  validExternalShareTarget, type ExternalShareRow, type ExternalShareStore,
} from "../lib/domain/workspaceExternalSharePolicy";
import { validPrincipalId, validScopeId } from "../lib/domain/workspaceManagementPolicy";

/**
 * Max 2.0 PR37: credential-free, identity-bound share PROPOSALS for registered
 * shadow workspace scopes. NO personal document, media, workspace ACL, Yjs,
 * API or MCP content access is enabled by acceptance of one of these records.
 */
type Ctx = Pick<GenericQueryCtx<GenericDataModel>, "db" | "auth">;
const READ_GATE = "MAX_V2_EXTERNAL_SHARES_READS_ENABLED";
const WRITE_GATE = "MAX_V2_EXTERNAL_SHARES_WRITES_ENABLED";
const nullableString = v.union(v.string(), v.null());
const previewV = v.object({
  shareId: v.string(),
  mode: v.union(v.literal("guest"), v.literal("cross_workspace")),
  status: v.union(v.literal("pending"), v.literal("accepted"),
    v.literal("declined"), v.literal("revoked"), v.literal("expired")),
  expiresAt: v.number(), updatedAt: v.number(),
  sourceWorkspaceId: nullableString, scopeId: nullableString,
});

function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "External share operation denied." });
}
function writesEnabled(): void {
  if (process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true" ||
      process.env[WRITE_GATE] !== "true") denied();
}
async function who(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}
function externalStore(ctx: Ctx): ExternalShareStore {
  return {
    ...sharedStore(ctx),
    globalScopes: (id: string) =>
      ctx.db.query("workspacePageScopes").withIndex("by_pageId",
        (q) => q.eq("pageId", id)).take(2),
    externalShares: async (id: string) => {
      try {
        // The untrusted ID is used solely as an index lookup; the policy
        // validates all tenant fields and the verified caller afterward.
        const row = await ctx.db.get(id as never);
        if (!row) return [];
        return [{
          shareId: row._id, originWorkspaceId: row.originWorkspaceId,
          scopeId: row.scopeId, targetWorkspaceId: row.targetWorkspaceId,
          targetAccountId: row.targetAccountId, createdByAccountId: row.createdByAccountId,
          status: row.status, createdAt: row.createdAt,
          expiresAt: row.expiresAt, resolvedAt: row.resolvedAt,
          updatedAt: row.updatedAt,
        } as ExternalShareRow];
      } catch { return []; }
    },
  };
}
async function loadShare(ctx: Ctx, id: string): Promise<ExternalShareRow & { _id: string }> {
  const rows = await externalStore(ctx).externalShares(id);
  if (rows.length !== 1 || !validExternalShareRow(rows[0]) || rows[0].shareId !== id) denied();
  return { ...rows[0], _id: id };
}

/** Create a bounded, single-recipient proposal; no bearer links, no emails.
 * Duplicate or revoked proposals cannot be silently recreated.
 */
export const issueExternalShare = mutationGeneric({
  args: {
    originWorkspaceId: v.string(), scopeId: v.string(),
    targetWorkspaceId: nullableString, targetAccountId: v.string(),
    expiresAt: v.number(),
  },
  returns: v.id("workspaceExternalShares"),
  handler: async (ctx, a) => {
    writesEnabled();
    const actor = await who(ctx), now = Date.now(), store = externalStore(ctx);
    if (!validScopeId(a.scopeId) ||
        !validExternalShareTarget(a.originWorkspaceId, a.targetWorkspaceId,
          a.targetAccountId, actor) ||
        !validExternalShareExpiry(now, a.expiresAt) ||
        !(await canManageExternalScope(store, actor, a.originWorkspaceId, a.scopeId)) ||
        !(await validExternalShareRecipient(store,
          a.targetAccountId, a.targetWorkspaceId))) denied();

    const existing = await ctx.db.query("workspaceExternalShares")
      .withIndex("by_origin_scope", (q) =>
        (q.eq("originWorkspaceId", a.originWorkspaceId) as unknown as {
          eq(field: string, value: string): never;
        }).eq("scopeId", a.scopeId)).take(65);
    if (existing.length > 64 || existing.some((share) =>
      !validExternalShareRow({ ...share, shareId: share._id }) ||
      (share.targetAccountId === a.targetAccountId &&
        share.targetWorkspaceId === a.targetWorkspaceId))) denied();

    const id = await ctx.db.insert("workspaceExternalShares", {
      originWorkspaceId: a.originWorkspaceId, scopeId: a.scopeId,
      targetWorkspaceId: a.targetWorkspaceId, targetAccountId: a.targetAccountId,
      createdByAccountId: actor, status: "pending" as const,
      createdAt: now, expiresAt: a.expiresAt, resolvedAt: null, updatedAt: now,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.originWorkspaceId, actorId: actor,
      operation: "external_share.proposed", targetId: a.scopeId,
      previous: null, next: "pending", at: now,
    });
    return id;
  },
});

/** Only the authenticated intended recipient can inspect this proposal.
 * Pending/declined/revoked/expired responses never expose source scope IDs.
 */
export const readExternalShare = queryGeneric({
  args: { shareId: v.id("workspaceExternalShares") },
  returns: v.union(v.null(), previewV),
  handler: async (ctx, a) => {
    if (process.env[READ_GATE] !== "true") return null;
    try {
      return await readAuthorizedExternalShare(
        externalStore(ctx), await who(ctx), a.shareId, Date.now()
      );
    } catch { return null; }
  },
});

/** Acceptance only records consent to a future content-sharing workflow.
 * It never adds a workspace membership or bypasses workspaceAccessGateway.
 */
export const respondExternalShare = mutationGeneric({
  args: {
    shareId: v.id("workspaceExternalShares"),
    decision: v.union(v.literal("accept"), v.literal("decline")),
    expectedUpdatedAt: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, a) => {
    writesEnabled();
    const actor = await who(ctx), now = Date.now(), store = externalStore(ctx);
    const preview = await readAuthorizedExternalShare(store, actor, a.shareId, now);
    const row = await loadShare(ctx, a.shareId);
    if (!preview || preview.status !== "pending" ||
        row.targetAccountId !== actor || row.status !== "pending" ||
        row.updatedAt !== a.expectedUpdatedAt || now >= row.expiresAt) denied();
    const updatedAt = nextExternalShareRevision(row.updatedAt, now);
    if (updatedAt === null) denied();
    await ctx.db.patch(a.shareId, {
      status: a.decision === "accept" ? "accepted" as const : "declined" as const,
      resolvedAt: now, updatedAt,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: row.originWorkspaceId, actorId: actor,
      operation: a.decision === "accept" ? "external_share.accepted" : "external_share.declined",
      targetId: row.scopeId, previous: "pending",
      next: a.decision === "accept" ? "accepted" : "declined", at: now,
    });
    return updatedAt;
  },
});

/** Current source manager can revoke a pending or accepted proposal. Revocation
 * is terminal and CAS-protected, including after destination role changes.
 */
export const revokeExternalShare = mutationGeneric({
  args: { shareId: v.id("workspaceExternalShares"), expectedUpdatedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, a) => {
    writesEnabled();
    const actor = await who(ctx), now = Date.now(), row = await loadShare(ctx, a.shareId);
    if (!["pending", "accepted"].includes(row.status) ||
        row.updatedAt !== a.expectedUpdatedAt ||
        !(await canManageExternalScope(
          externalStore(ctx), actor, row.originWorkspaceId, row.scopeId
        ))) denied();
    const updatedAt = nextExternalShareRevision(row.updatedAt, now);
    if (updatedAt === null) denied();
    await ctx.db.patch(a.shareId, { status: "revoked", resolvedAt: now, updatedAt });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: row.originWorkspaceId, actorId: actor,
      operation: "external_share.revoked", targetId: row.scopeId,
      previous: row.status, next: "revoked", at: now,
    });
    return updatedAt;
  },
});
