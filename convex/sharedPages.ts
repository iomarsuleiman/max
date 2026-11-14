import { v } from "convex/values";
import { mutation, query, type DatabaseReader } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { requireSharedActor, sharedBoundary } from "./sharedAuth";
import { convexCollaborationStore } from "./collaborationStore";
import { convexPagePolicies } from "./pagePolicyStore";
import { readPageGrantSet, replaceStoredPageAccess } from "./pageGrantStore";
import { authorizeCollaborationPage, filterAuthorizedCollaborationPages } from "../lib/domain/collaboration/authorization";
import { canPage, type PageCapability, type AccessGrant } from "../lib/domain/collaboration/policy";
import { DOCUMENT_SCHEMA_VERSION, MAX_CONTENT_BYTES, parseContent, documentText, countWords } from "../lib/domain/blocks";
import { MaxError, notFound } from "../lib/domain/errors";

const grant = v.union(v.literal("view"), v.literal("comment"), v.literal("edit_content"), v.literal("edit"), v.literal("full"));
const summary = v.object({ id: v.string(), title: v.string(), teamspaceId: v.union(v.string(), v.null()), updatedAt: v.number() });
const permission = v.object({ userId: v.string(), displayName: v.string(), grant });
const pageSummary = (p: Doc<"pages">) => ({ id: p._id, title: p.title, teamspaceId: p.teamspaceId ?? null, updatedAt: p.updatedAt });
const invalid = () => new MaxError("VALIDATION", "Invalid page content or title.");
const actorContext = (db: DatabaseReader, actor: Awaited<ReturnType<typeof requireSharedActor>>, workspaceId: string) => ({ transaction: undefined, pages: convexPagePolicies(db), actor, workspaceId, now: Date.now() });
async function auth(db: DatabaseReader, actor: Awaited<ReturnType<typeof requireSharedActor>>, workspaceId: string, pageId: string, capability: PageCapability) {
  return convexCollaborationStore(db).transaction((tx) => authorizeCollaborationPage({ ...actorContext(db, actor, workspaceId), transaction: tx, pageId, capability }));
}
async function page(db: DatabaseReader, id: Id<"pages">) {
  const p = await db.get(id);
  if (!p || p.kind !== "page" || p.archivedAt !== null || p.isTemplate) throw notFound();
  return p;
}
async function document(db: DatabaseReader, p: Doc<"pages">) {
  const rows = await db.query("documents").withIndex("by_pageId", q => q.eq("pageId", p._id)).take(2);
  if (rows.length !== 1 || rows[0].ownerId !== p.ownerId) throw new MaxError("INTERNAL", "Page document is inconsistent.");
  return rows[0];
}
async function allowed(db: DatabaseReader, actor: Awaited<ReturnType<typeof requireSharedActor>>, workspaceId: string, pageId: string, capability: PageCapability) {
  try { await auth(db, actor, workspaceId, pageId, capability); return true; }
  catch (e) { if (e instanceof MaxError && e.code === "NOT_FOUND") return false; throw e; }
}
function title(value: string) { const result = value.trim(); if (!result || result.length > 500) throw invalid(); return result; }

export const list = query({
  args: { workspaceId: v.string(), cursor: v.optional(v.union(v.string(), v.null())) },
  returns: v.object({ actorId: v.string(), pages: v.array(summary), nextCursor: v.union(v.string(), v.null()) }),
  handler: (ctx, args) => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx);
    const batch = await ctx.db.query("pages").withIndex("by_workspaceId", q => q.eq("workspaceId", args.workspaceId)).paginate({ cursor: args.cursor ?? null, numItems: 40 });
    const candidates = batch.page.filter(p => p.kind === "page" && p.archivedAt === null && !p.isTemplate);
    const visible = await convexCollaborationStore(ctx.db).transaction(tx => filterAuthorizedCollaborationPages({ ...actorContext(ctx.db, actor, args.workspaceId), transaction: tx, pageIds: candidates.map(p => p._id), capability: "page.read" }));
    const ids = new Set(visible.map(p => p.page.id));
    return { actorId: actor.userId, pages: candidates.filter(p => ids.has(p._id)).map(pageSummary), nextCursor: batch.isDone ? null : batch.continueCursor };
  }),
});
export const get = query({
  args: { workspaceId: v.string(), pageId: v.id("pages") },
  returns: v.object({ actorId: v.string(), workspaceId: v.string(), page: summary, document: v.object({ content: v.string(), revision: v.number(), updatedAt: v.number() }), canEdit: v.boolean(), canRename: v.boolean(), canShare: v.boolean(), aclRevision: v.number(), permissions: v.array(permission) }),
  handler: (ctx, args) => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx); await auth(ctx.db, actor, args.workspaceId, args.pageId, "page.read");
    const p = await page(ctx.db, args.pageId); const doc = await document(ctx.db, p);
    const canEdit = !p.locked && await allowed(ctx.db, actor, args.workspaceId, p._id, "page.edit_content");
    const canRename = !p.locked && await allowed(ctx.db, actor, args.workspaceId, p._id, "page.edit_metadata");
    const canShare = await allowed(ctx.db, actor, args.workspaceId, p._id, "page.share");
    const access = await readPageGrantSet(ctx.db, p._id, args.workspaceId);
    const permissions: { userId: string; displayName: string; grant: typeof grant.type }[] = [];
    if (canShare) for (const row of access.rows) {
      const g = row.value; if (g.effect !== "allow" || g.principal.kind !== "user") continue;
      const userId = g.principal.userId;
      const members = await ctx.db.query("collabMemberships").withIndex("by_workspaceId_userId", q => q.eq("workspaceId", args.workspaceId).eq("userId", userId)).take(2);
      if (members.length > 1) throw new MaxError("INTERNAL", "Workspace membership is inconsistent.");
      if (members[0]?.state === "active") permissions.push({ userId, displayName: members[0].displayName || "Member", grant: g.grant });
    }
    return { actorId: actor.userId, workspaceId: args.workspaceId, page: pageSummary(p), document: { content: doc.content, revision: doc.revision, updatedAt: doc.updatedAt }, canEdit, canRename, canShare, aclRevision: access.header?.aclRevision ?? 0, permissions };
  }),
});
export const create = mutation({
  args: { workspaceId: v.string(), teamspaceId: v.string(), parentId: v.optional(v.id("pages")), title: v.string() }, returns: v.object({ pageId: v.id("pages") }),
  handler: (ctx, args) => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx); const now = Date.now(); const name = title(args.title);
    if (args.parentId) { await auth(ctx.db, actor, args.workspaceId, args.parentId, "page.create_child"); const parent = await page(ctx.db, args.parentId); if (parent.teamspaceId !== args.teamspaceId || parent.locked) throw notFound(); }
    else await convexCollaborationStore(ctx.db).transaction(async tx => {
      const workspace = await tx.getWorkspace(args.workspaceId), member = await tx.getMembership(args.workspaceId, actor.userId), teamspace = await tx.getTeamspace(args.teamspaceId);
      if (!workspace || workspace.kind !== "organization" || workspace.state !== "active" || !member || member.state !== "active" || member.role === "guest" || !teamspace || teamspace.state !== "active" || teamspace.workspaceId !== args.workspaceId) throw notFound();
      const memberships = await tx.listUserGroupMemberships(args.workspaceId, actor.userId);
      const groups = (await Promise.all(memberships.map(async m => ({ m, g: await tx.getGroup(m.groupId) })))).filter(({g}) => g?.state === "active" && g.workspaceId === args.workspaceId).map(({m}) => m);
      const candidate = { id: "new-page", workspaceId: args.workspaceId, parentId: null, teamspaceId: args.teamspaceId, access: { mode: "inherit" as const, grants: [] } };
      if (!canPage({ workspace, membership: member, userId: actor.userId, groupMemberships: groups, teamspaces: [teamspace], pages: [candidate], now }, candidate.id, "page.create_child")) throw notFound();
    });
    const pageId = await ctx.db.insert("pages", { ownerId: actor.userId, workspaceId: args.workspaceId, teamspaceId: args.teamspaceId, kind: "page", parentId: args.parentId ?? null, databaseId: null, title: name, icon: null, cover: null, rank: String(now), favoriteRank: null, archivedAt: null, archivedRootId: null, lastOpenedAt: null, fullWidth: false, smallText: false, locked: false, isTemplate: false, createdAt: now, updatedAt: now });
    await ctx.db.insert("documents", { ownerId: actor.userId, pageId, content: "[]", text: "", revision: 1, schemaVersion: DOCUMENT_SCHEMA_VERSION, wordCount: 0, updatedAt: now });
    await replaceStoredPageAccess(ctx.db, { pageId, workspaceId: args.workspaceId, mode: args.parentId ? "inherit" : "replace", grants: [{ principal: { kind: "user", userId: actor.userId }, effect: "allow", grant: "full", expiresAt: null }], baseRevision: 0, updatedBy: actor.userId, now });
    return { pageId };
  }),
});
export const save = mutation({
  args: { workspaceId: v.string(), pageId: v.id("pages"), blocks: v.any(), baseRevision: v.number() }, returns: v.object({ revision: v.number(), updatedAt: v.number() }),
  handler: (ctx, args) => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx); await auth(ctx.db, actor, args.workspaceId, args.pageId, "page.edit_content"); const p = await page(ctx.db, args.pageId); if (p.locked) throw notFound(); const doc = await document(ctx.db, p);
    if (!Array.isArray(args.blocks)) throw invalid(); const blocks = parseContent(args.blocks); const content = JSON.stringify(blocks);
    if (new TextEncoder().encode(content).length > MAX_CONTENT_BYTES) throw new MaxError("LIMIT", "This page is too large to save.");
    if (content === doc.content) return { revision: doc.revision, updatedAt: doc.updatedAt };
    if (!Number.isSafeInteger(args.baseRevision) || args.baseRevision !== doc.revision) throw new MaxError("CONFLICT", "This page changed. Reload it before saving.");
    const now = Date.now();
    const previous = await ctx.db.query("versions").withIndex("by_owner_pageId", q => q.eq("ownerId", p.ownerId).eq("pageId", p._id)).order("desc").take(100);
    if (previous.length === 100) await ctx.db.delete(previous[99]._id);
    await ctx.db.insert("versions", { ownerId: p.ownerId, pageId: p._id, revision: doc.revision, title: p.title, content: doc.content, wordCount: doc.wordCount, at: doc.updatedAt, source: "ui", reason: "edit" });
    const text = documentText(blocks), revision = doc.revision + 1; await ctx.db.patch(doc._id, { content, text, wordCount: countWords(text), revision, updatedAt: now }); await ctx.db.patch(p._id, { updatedAt: now }); return { revision, updatedAt: now };
  }),
});
export const rename = mutation({
  args: { workspaceId: v.string(), pageId: v.id("pages"), title: v.string() }, returns: v.null(),
  handler: (ctx, args) => sharedBoundary(async () => { const actor = await requireSharedActor(ctx); await auth(ctx.db, actor, args.workspaceId, args.pageId, "page.edit_metadata"); const p = await page(ctx.db, args.pageId); if (p.locked) throw notFound(); await ctx.db.patch(p._id, { title: title(args.title), updatedAt: Date.now() }); return null; }),
});
export const setMemberGrant = mutation({
  args: { workspaceId: v.string(), pageId: v.id("pages"), userId: v.string(), grant: v.union(grant, v.null()), baseRevision: v.number() }, returns: v.object({ aclRevision: v.number() }),
  handler: (ctx, args) => sharedBoundary(async () => {
    const actor = await requireSharedActor(ctx); await auth(ctx.db, actor, args.workspaceId, args.pageId, "page.share"); await page(ctx.db, args.pageId);
    if (args.userId === actor.userId && args.grant !== "full") throw new MaxError("VALIDATION", "You cannot remove your own full access.");
    const member = await convexCollaborationStore(ctx.db).transaction(tx => tx.getMembership(args.workspaceId, args.userId)); if (!member || member.state !== "active") throw notFound();
    const access = await readPageGrantSet(ctx.db, args.pageId, args.workspaceId);
    const grants: AccessGrant[] = access.rows.map(r => r.value).filter(g => !(g.effect === "allow" && g.principal.kind === "user" && g.principal.userId === args.userId));
    if (args.grant !== null) grants.push({ principal: { kind: "user", userId: args.userId }, effect: "allow", grant: args.grant, expiresAt: null });
    const aclRevision = await replaceStoredPageAccess(ctx.db, { pageId: args.pageId, workspaceId: args.workspaceId, mode: access.header?.mode ?? "inherit", grants, baseRevision: args.baseRevision, updatedBy: actor.userId, now: Date.now() }); return { aclRevision };
  }),
});
