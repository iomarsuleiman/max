import { internalMutationGeneric, internalQueryGeneric, anyApi } from "convex/server";
import { ConvexError, v } from "convex/values";
import { execute } from "../lib/domain/ops";
import { convexDb, convexStorage } from "./convexDb";
import { object, objects, text, taskSchema, IMPORT_LIMITS } from "../lib/notion/types";
import { convertProperties, convertValues } from "../lib/notion/convert";
import { parseContent, walk } from "../lib/domain/blocks";
import { defaultView } from "../lib/domain/ops/databaseDefaults";
import type { PropertyDef } from "../lib/domain/types";

export const read = internalQueryGeneric({
  args: { ownerId: v.string(), jobId: v.optional(v.id("notionJobs")) },
  returns: v.any(),
  handler: async (ctx, { ownerId, jobId }) => {
    const connection = await ctx.db
      .query("notionConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .first();
    if (!jobId) return { connection };
    const job = await ctx.db.get(jobId);
    if (!job || job.ownerId !== ownerId) throw new ConvexError("Import not found.");
    const items = await ctx.db
      .query("notionItems")
      .withIndex("by_job", (q) => q.eq("jobId", jobId))
      .take(IMPORT_LIMITS.items * 2 + 1);
    return { connection, job, items };
  },
});

export const write = internalMutationGeneric({
  args: { ownerId: v.string(), command: v.string(), args: v.any() },
  returns: v.any(),
  handler: async (ctx, { ownerId, command, args: raw }) => {
    const a = object(raw);
    const now = Date.now();
    const connection = await ctx.db
      .query("notionConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .first();
    const domain = { db: convexDb(ctx.db), storage: convexStorage(ctx.storage), ownerId, now, source: "ui" as const };
    if (command === "state") {
      const old = await ctx.db
        .query("notionStates")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .take(20);
      for (const s of old) await ctx.db.delete(s._id);
      await ctx.db.insert("notionStates", { ownerId, hash: text(a.hash), expiresAt: now + 600_000 });
      return null;
    }
    if (command === "consume") {
      const s = await ctx.db
        .query("notionStates")
        .withIndex("by_hash", (q) => q.eq("hash", text(a.hash)))
        .first();
      if (!s || s.ownerId !== ownerId || s.expiresAt < now || s.consumed) throw new ConvexError("invalid_state");
      await ctx.db.patch(s._id, { consumed: true });
      return null;
    }
    if (command === "connect") {
      if (a.stateHash) {
        const state = await ctx.db
          .query("notionStates")
          .withIndex("by_hash", (q) => q.eq("hash", text(a.stateHash)))
          .first();
        if (!state || state.ownerId !== ownerId || !state.consumed || state.expiresAt < now) throw new ConvexError("invalid_state");
        await ctx.db.delete(state._id);
      }
      const row = { ownerId, workspaceId: text(a.workspaceId), workspaceName: text(a.workspaceName), encryptedToken: text(a.encryptedToken), connectedAt: now };
      if (connection) await ctx.db.replace(connection._id, row);
      else await ctx.db.insert("notionConnections", row);
      await ctx.db.insert("audit", { ownerId, op: "notion.connect", source: "ui", targetId: null, ok: true, code: null, at: now });
      return null;
    }
    if (command === "disconnect") {
      if (connection) await ctx.db.delete(connection._id);
      for (const state of await ctx.db
        .query("notionStates")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .take(20))
        await ctx.db.delete(state._id);
      await ctx.db.insert("audit", { ownerId, op: "notion.disconnect", source: "ui", targetId: null, ok: true, code: null, at: now });
      return null;
    }
    if (command === "history") {
      const jobs = await ctx.db
        .query("notionJobs")
        .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
        .order("desc")
        .take(30);
      return { jobs: jobs.map(({ leaseUntil: _lease, key: _key, ...job }) => ({ ...job, jobId: job._id })) };
    }
    if (command === "start") {
      if (!connection) throw new ConvexError("Connect Notion first.");
      const key = text(a.idempotencyKey);
      const old = await ctx.db
        .query("notionJobs")
        .withIndex("by_owner_key", (q) => (q.eq("ownerId", ownerId) as unknown as { eq(field: string, value: unknown): never }).eq("key", key))
        .first();
      if (old) return { jobId: old._id, replay: true };
      if (a.parentId) await execute("pages.get", { id: a.parentId }, domain);
      const jobId = await ctx.db.insert("notionJobs", {
        ownerId,
        workspaceId: connection.workspaceId,
        key,
        parentId: a.parentId ? text(a.parentId) : null,
        includeDescendants: a.includeDescendants !== false,
        status: "queued",
        phase: "reading",
        createdAt: now,
        updatedAt: now,
        created: 0,
        failed: 0,
        skipped: 0,
        attachments: 0,
        warnings: [
          {
            sourceId: "",
            message:
              "One-time copies. Comments, permissions, history and database view layouts are not imported. Relations, formulas, rollups and unsupported properties retain static readable values.",
          },
        ],
        error: null,
        rootIds: [],
        leaseUntil: 0,
        generation: 0,
      });
      for (const rawTask of objects(a.tasks)) {
        const t = taskSchema.parse(rawTask);
        await ctx.db.insert("notionItems", { ...t, ownerId, jobId, key: t.sourceId, status: "pending", destinationId: null, revision: 1, error: null });
      }
      await ctx.scheduler.runAfter(0, anyApi.notionWorker.step, { ownerId, jobId });
      await ctx.db.insert("audit", { ownerId, op: "notion.start", source: a.source === "mcp" ? "mcp" : "ui", targetId: jobId, ok: true, code: null, at: now });
      return { jobId };
    }
    const jobId = ctx.db.normalizeId("notionJobs", text(a.jobId));
    const job = jobId ? await ctx.db.get(jobId) : null;
    if (!job || job.ownerId !== ownerId) throw new ConvexError("Import not found.");
    if (command === "cancel") {
      await ctx.db.patch(job._id, { status: "cancelled", leaseUntil: 0, updatedAt: now });
      return { jobId: job._id };
    }
    if (command === "retry") {
      if (!connection || connection.workspaceId !== job.workspaceId) throw new ConvexError("Reconnect the original Notion workspace before retrying.");
      if (!["failed", "cancelled", "completed_with_warnings"].includes(job.status)) throw new ConvexError("This import cannot be retried right now.");
      const items = await ctx.db
        .query("notionItems")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .take(IMPORT_LIMITS.items * 2 + 1);
      for (const item of items) if (item.status === "failed" || item.status === "working") await ctx.db.patch(item._id, { status: "pending", error: null });
      await ctx.db.patch(job._id, { status: "queued", leaseUntil: 0, failed: 0, error: null, updatedAt: now });
      await ctx.scheduler.runAfter(0, anyApi.notionWorker.step, { ownerId, jobId: job._id });
      return { jobId: job._id };
    }
    if (command === "claim") {
      if (!["queued", "running"].includes(job.status) || job.leaseUntil > now) return null;
      const working = await ctx.db
        .query("notionItems")
        .withIndex("by_job_status", (q) => (q.eq("jobId", job._id) as unknown as { eq(field: string, value: unknown): never }).eq("status", "working"))
        .first();
      const item =
        working ??
        (await ctx.db
          .query("notionItems")
          .withIndex("by_job_status", (q) => (q.eq("jobId", job._id) as unknown as { eq(field: string, value: unknown): never }).eq("status", "pending"))
          .first());
      if (!item) {
        await ctx.db.patch(job._id, {
          status: job.failed ? "failed" : job.warnings.length ? "completed_with_warnings" : "completed",
          phase: "done",
          leaseUntil: 0,
          updatedAt: now,
        });
        return null;
      }
      const leaseUntil = now + 180_000;
      await ctx.db.patch(item._id, { status: "working" });
      await ctx.db.patch(job._id, { status: "running", leaseUntil, generation: job.generation + 1, updatedAt: now });
      // A durable watchdog resumes a worker that crashed after acquiring its lease.
      await ctx.scheduler.runAfter(181_000, anyApi.notionWorker.step, { ownerId, jobId: job._id });
      return { ...item, leaseUntil, generation: job.generation + 1 };
    }
    const itemId = ctx.db.normalizeId("notionItems", text(a.itemId));
    const item = itemId ? await ctx.db.get(itemId) : null;
    if (!item || item.jobId !== job._id) throw new ConvexError("Import item not found.");
    if (job.status !== "running" || job.leaseUntil !== a.leaseUntil || job.generation !== a.generation || item.status !== "working") return null;
    if (!connection || connection.workspaceId !== job.workspaceId) {
      await ctx.db.patch(job._id, {
        status: "failed",
        leaseUntil: 0,
        error: "Notion was disconnected or changed. Reconnect the original workspace and retry.",
        updatedAt: now,
      });
      await ctx.db.patch(item._id, { status: "failed", error: "Notion connection changed." });
      return null;
    }
    if (command === "fail") {
      const message = text(a.message).slice(0, 500);
      await ctx.db.patch(item._id, { status: "failed", error: message });
      await ctx.db.patch(job._id, { status: "failed", failed: job.failed + 1, error: message, leaseUntil: 0, updatedAt: now });
      return null;
    }
    if (command === "commit") {
      let destinationId = item.destinationId;
      let revision = item.revision;
      const warnings = objects(a.warnings ?? []).map((w) => ({ sourceId: text(w.sourceId), message: text(w.message).slice(0, 500) }));
      if (a.entity && item.kind !== "rows" && item.kind !== "repair") {
        const entity = object(a.entity);
        if (!destinationId) {
          const result = object(
            await execute(
              item.databaseId ? "records.create" : item.kind === "data_source" ? "databases.create" : "pages.create",
              item.databaseId
                ? { databaseId: item.databaseId, title: entity.title, values: convertValues(entity.values ?? {}) }
                : { title: entity.title, parentId: item.parentId, icon: entity.icon ?? null },
              domain,
            ),
          );
          destinationId = text(object(result.page ?? result.record ?? result.database)._id);
          if (item.kind === "data_source") {
            const sourceTitle = Object.entries(object(entity.properties ?? {})).find(([, p]) => object(p).type === "title")?.[0] || "Name";
            const titleProperties: PropertyDef[] = [{ id: "title", name: sourceTitle, type: "title" }];
            // A new imported database uses the source schema, not Max's starter columns.
            await domain.db.patch("pages", destinationId, { properties: titleProperties, views: [defaultView(titleProperties)] });
            const converted = convertProperties(entity.properties ?? {});
            if (converted.properties.length > 59)
              throw new ConvexError("This database exceeds Max's property limit. Import fewer fields using an export file.");
            for (const p of converted.properties) await execute("properties.add", { databaseId: destinationId, ...p }, domain);
            warnings.push(...converted.warnings.map((message) => ({ sourceId: item.sourceId, message })));
          }
        }
        if (Array.isArray(a.blocks)) {
          const blocks = parseContent(a.blocks);
          for (const m of objects(a.media ?? [])) {
            const registered = object(
              await execute("assets.register", { pageId: destinationId, storageId: m.storageId, name: m.name, type: m.type, size: m.size }, domain),
            );
            const target = [...walk(blocks)].find((b) => b.block.id === m.blockId)?.block;
            if (target) {
              target.type = text(m.kind);
              target.props = { url: text(registered.url), name: text(m.name), caption: text(m.name), showPreview: true };
              target.content = [];
            }
          }
          const result = object(await execute("documents.save", { pageId: destinationId, blocks, baseRevision: revision }, domain));
          revision = Number(result.revision);
        }
      } else if (item.kind === "repair" && destinationId && Array.isArray(a.blocks)) {
        try {
          const result = object(await execute("documents.save", { pageId: destinationId, blocks: a.blocks, baseRevision: revision }, domain));
          revision = Number(result.revision);
        } catch {
          warnings.push({
            sourceId: item.sourceId,
            message: "Internal links were not repaired because this imported page was edited, locked or removed. Your edits were preserved.",
          });
        }
      }
      const allItems = await ctx.db
        .query("notionItems")
        .withIndex("by_job", (q) => q.eq("jobId", job._id))
        .take(IMPORT_LIMITS.items * 2 + 1);
      const tasks = objects(a.tasks ?? []);
      if (
        allItems.filter((entry) => entry.kind !== "repair").length +
          tasks.filter(
            (entry) =>
              !allItems.some((old) => old.key === (entry.kind === "rows" ? `rows:${text(entry.sourceId)}:${text(entry.cursor) || "first"}` : entry.sourceId)),
          ).length >
        IMPORT_LIMITS.items
      )
        throw new ConvexError("Import exceeds the 2,000-item safety limit. Choose a smaller subtree and retry.");
      let rootIds = !item.parentSourceId && destinationId && !job.rootIds.includes(destinationId) ? [...job.rootIds, destinationId] : job.rootIds;
      for (const rawTask of tasks) {
        const t = taskSchema.parse(rawTask);
        const key = t.kind === "rows" ? `rows:${t.sourceId}:${t.cursor ?? "first"}` : t.sourceId;
        const exists = await ctx.db
          .query("notionItems")
          .withIndex("by_job_key", (q) => (q.eq("jobId", job._id) as unknown as { eq(field: string, value: unknown): never }).eq("key", key))
          .first();
        const location =
          t.parentSourceId === item.sourceId
            ? { parentId: item.kind === "data_source" ? null : destinationId, databaseId: item.kind === "data_source" ? destinationId : t.databaseId }
            : { parentId: t.parentId, databaseId: t.databaseId };
        if (!exists)
          await ctx.db.insert("notionItems", {
            ...t,
            ...location,
            ownerId,
            jobId: job._id,
            key,
            status: "pending",
            destinationId: null,
            revision: 1,
            error: null,
          });
        else if (!exists.parentSourceId && t.parentSourceId && exists.sourceId !== item.sourceId && !location.databaseId) {
          // A separately selected descendant belongs inside its imported parent, once, not twice.
          if (exists.destinationId) await execute("pages.move", { id: exists.destinationId, parentId: location.parentId }, domain);
          await ctx.db.patch(exists._id, { ...location, parentSourceId: t.parentSourceId, depth: t.depth });
          rootIds = rootIds.filter((id: string) => id !== exists.destinationId);
        }
      }
      await ctx.db.patch(item._id, { status: "done", destinationId, revision, error: null });
      const reportWarnings = [...job.warnings, ...warnings];
      if (reportWarnings.length > 1000)
        reportWarnings.splice(999, reportWarnings.length, {
          sourceId: "",
          message: "Warning detail limit reached. Additional conversion warnings are not itemized. Use smaller imports for complete per-item warning reports.",
        });
      await ctx.db.patch(job._id, {
        created: job.created + (!item.destinationId && destinationId && item.kind !== "repair" ? 1 : 0),
        attachments: job.attachments + objects(a.media ?? []).length,
        skipped: job.skipped + Math.max(0, Number(a.skipped) || 0),
        warnings: reportWarnings,
        rootIds,
        leaseUntil: 0,
        updatedAt: now,
      });
      // Once reading finishes, enqueue one revision-checked link repair per page.
      if (item.kind !== "repair" && !allItems.some((i) => i._id !== item._id && (i.status === "pending" || i.status === "working")) && !tasks.length) {
        const pages = [...allItems.filter((i) => i.destinationId && i.kind !== "rows" && i.kind !== "repair"), { ...item, destinationId, revision }].filter(
          (i) => i.destinationId && i.kind !== "repair" && i.kind !== "rows",
        );
        const seen = new Set<string>();
        for (const p of pages) {
          if (seen.has(p.sourceId)) continue;
          seen.add(p.sourceId);
          const key = `repair:${p.sourceId}`;
          const exists = await ctx.db
            .query("notionItems")
            .withIndex("by_job_key", (q) => (q.eq("jobId", job._id) as unknown as { eq(field: string, value: unknown): never }).eq("key", key))
            .first();
          if (!exists)
            await ctx.db.insert("notionItems", {
              ...taskSchema.parse(p),
              ownerId,
              jobId: job._id,
              kind: "repair",
              key,
              status: "pending",
              destinationId: p.destinationId,
              revision: p.revision,
              error: null,
            });
        }
        await ctx.db.patch(job._id, { phase: "repairing_links" });
      }
      await ctx.scheduler.runAfter(400, anyApi.notionWorker.step, { ownerId, jobId: job._id });
      return { destinationId };
    }
    throw new ConvexError("Unknown import command.");
  },
});
