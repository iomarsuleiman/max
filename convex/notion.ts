import { actionGeneric, internalQueryGeneric, anyApi } from "convex/server";
import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { decryptToken, encryptToken, hashState, notionConfigured } from "../lib/notion/crypto";
import { getSource, listSources } from "../lib/notion/client";
import { jobIdSchema, object, objects, selectionSchema, sourceFrom, startSchema, text } from "../lib/notion/types";

function checkSecret(secret: string) {
  const expected = process.env.MAX_SERVER_SECRET;
  if (!expected || expected.length < 32 || expected !== secret) throw new ConvexError("Server credentials are not configured.");
}
function publicJob(raw: unknown, rawItems: unknown) {
  const j = object(raw);
  const items = objects(rawItems);
  return {
    jobId: j._id,
    status: j.status,
    phase: j.phase,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    created: j.created,
    failed: j.failed,
    skipped: j.skipped,
    attachments: j.attachments,
    warnings: j.warnings,
    error: j.error,
    rootIds: j.rootIds,
    total: items.filter((i) => !["repair", "rows"].includes(text(i.kind))).length,
    processed: items.filter((i) => i.status === "done" && !["repair", "rows"].includes(text(i.kind))).length,
    items: items.map((i) => ({ sourceId: i.sourceId, kind: i.kind, status: i.status, destinationId: i.destinationId, error: i.error })),
  };
}
/** Server-authenticated bridge. Credentials and OAuth commands never go through MCP. */
export const dispatch = actionGeneric({
  args: { secret: v.string(), ownerId: v.string(), operation: v.string(), args: v.any(), source: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { secret, ownerId, operation, args: raw, source }) => {
    checkSecret(secret);
    const a = object(raw);
    const configured = notionConfigured();
    const read = async (jobId?: string) => object(await ctx.runQuery(anyApi.notionStore.read, { ownerId, ...(jobId ? { jobId } : {}) }));
    const write = (command: string, args: Record<string, unknown>) => ctx.runMutation(anyApi.notionStore.write, { ownerId, command, args });
    const state = await read();
    const connection = state.connection ? object(state.connection) : null;
    if (operation === "status")
      return {
        configured,
        connected: !!connection,
        workspace: connection ? { id: connection.workspaceId, name: connection.workspaceName } : null,
        reason: configured ? null : "The server owner must configure the Max Notion OAuth integration.",
      };
    if (["oauth.begin", "oauth.complete", "disconnect"].includes(operation) && source !== "ui") throw new ConvexError("Manage connections from Max settings.");
    if (operation === "oauth.begin") {
      if (!configured) throw new ConvexError("not_configured");
      const stateValue = z.string().min(40).max(200).parse(a.state);
      await write("state", { hash: await hashState(stateValue) });
      const redirectUri = process.env.NOTION_REDIRECT_URI ?? "";
      const u = new URL("https://api.notion.com/v1/oauth/authorize");
      u.searchParams.set("client_id", process.env.NOTION_CLIENT_ID ?? "");
      u.searchParams.set("response_type", "code");
      u.searchParams.set("owner", "user");
      u.searchParams.set("redirect_uri", redirectUri);
      u.searchParams.set("state", stateValue);
      return { url: u.href };
    }
    if (operation === "oauth.complete") {
      if (!configured) throw new ConvexError("not_configured");
      const input = z.object({ state: z.string().min(40).max(200), code: z.string().min(1).max(2000) }).parse(a);
      await write("consume", { hash: await hashState(input.state) });
      const basic = btoa(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`);
      const res = await fetch("https://api.notion.com/v1/oauth/token", {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        body: JSON.stringify({ grant_type: "authorization_code", code: input.code, redirect_uri: process.env.NOTION_REDIRECT_URI }),
        signal: AbortSignal.timeout(20_000),
        redirect: "error",
      });
      if (!res.ok) throw new ConvexError("provider_error");
      const data = z
        .object({ access_token: z.string().min(1), workspace_id: z.string().min(1), workspace_name: z.string().nullable().optional() })
        .parse(await res.json());
      await write("connect", {
        stateHash: await hashState(input.state),
        workspaceId: data.workspace_id,
        workspaceName: data.workspace_name || "Notion workspace",
        encryptedToken: await encryptToken(data.access_token),
      });
      return { connected: true };
    }
    if (operation === "disconnect") {
      await write("disconnect", {});
      return { connected: false };
    }
    if (operation === "history") return write("history", {});
    if (["job", "report", "cancel", "retry"].includes(operation)) {
      const { jobId } = jobIdSchema.parse(a);
      if (operation === "cancel" || operation === "retry") return write(operation, { jobId });
      const data = await read(jobId);
      return publicJob(data.job, data.items);
    }
    if (!connection) throw new ConvexError("Connect Notion in Settings â†’ Connections first.");
    const token = await decryptToken(text(connection.encryptedToken));
    if (operation === "sources") {
      const input = z.object({ query: z.string().max(200).optional(), cursor: z.string().max(200).optional() }).parse(a);
      return listSources(token, input.query, input.cursor);
    }
    if (operation === "preview" || operation === "start") {
      const input = operation === "start" ? startSchema.parse(a) : selectionSchema.parse(a);
      if (input.parentId) await ctx.runQuery(anyApi.notion.destination, { ownerId, pageId: input.parentId });
      const entities = [];
      for (const id of [...new Set(input.sourceIds)]) entities.push(await getSource(token, id));
      const selected = new Set(entities.map((entity) => text(entity.id).replaceAll("-", "").toLowerCase()));
      const roots = entities
        .filter((entity) => {
          if (!input.includeDescendants || !entity.parent) return true;
          const parent = object(entity.parent);
          return !selected.has(text(parent[text(parent.type)]).replaceAll("-", "").toLowerCase());
        })
        .map(sourceFrom);
      const warnings = [
        "Counts are estimates for selected roots only. Descendants, rows and attachment sizes are discovered during import.",
        "Comments, history, permissions and view layouts are excluded. Formulas, rollups and relations become static readable values.",
        "Imports are limited to 2,000 items, 1,000 blocks per page and 10 MB per supported Notion-hosted attachment. External media is reported instead of fetched.",
      ];
      if (operation === "preview")
        return { roots, warnings, exact: false, selectedRoots: roots.length, includeDescendants: input.includeDescendants, parentId: input.parentId };
      const start = startSchema.parse(a);
      return write("start", {
        ...start,
        source,
        tasks: roots.map((r) => ({ sourceId: r.id, kind: r.kind, parentSourceId: null, parentId: input.parentId, databaseId: null, cursor: null, depth: 0 })),
      });
    }
    throw new ConvexError("Unknown Notion operation.");
  },
});

export const destination = internalQueryGeneric({
  args: { ownerId: v.string(), pageId: v.string() },
  returns: v.null(),
  handler: async (ctx, { ownerId, pageId }) => {
    const id = ctx.db.normalizeId("pages", pageId);
    const page = id ? await ctx.db.get(id) : null;
    if (!page || page.ownerId !== ownerId || page.archivedAt || page.kind === "database")
      throw new ConvexError("Choose a live page as the import destination.");
    return null;
  },
});
export const document = internalQueryGeneric({
  args: { ownerId: v.string(), jobId: v.id("notionJobs"), pageId: v.string() },
  returns: v.any(),
  handler: async (ctx, { ownerId, jobId, pageId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.ownerId !== ownerId) throw new ConvexError("Import not found.");
    const doc = await ctx.db
      .query("documents")
      .withIndex("by_owner_pageId", (q) => (q.eq("ownerId", ownerId) as unknown as { eq(field: string, value: unknown): never }).eq("pageId", pageId))
      .first();
    if (!doc) throw new ConvexError("Imported page not found.");
    return { content: doc.content, revision: doc.revision };
  },
});
