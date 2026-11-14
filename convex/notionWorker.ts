import { internalActionGeneric, anyApi } from "convex/server";
import { v } from "convex/values";
import { parseContent } from "../lib/domain/blocks";
import { notionRequest, NotionError, trustedMediaUrl } from "../lib/notion/client";
import { decryptToken } from "../lib/notion/crypto";
import { convertBlocks, remapNotionLinks, type NotionBlock } from "../lib/notion/convert";
import { IMPORT_LIMITS, object, objects, sourceFrom, taskSchema, text, type ImportTask } from "../lib/notion/types";
import { UPLOAD_TYPES } from "../lib/domain/ops/helpers";
import { internal } from "./_generated/api";
import { createUploadRuntime } from "../lib/domain/uploadRuntime";

export const step = internalActionGeneric({
  args: { ownerId: v.string(), jobId: v.id("notionJobs") },
  returns: v.null(),
  handler: async (ctx, { ownerId, jobId }) => {
    const write = (command: string, args: Record<string, unknown>) => ctx.runMutation(anyApi.notionStore.write, { ownerId, command, args: { jobId, ...args } });
    const claimed: unknown = await write("claim", {});
    if (!claimed) return null;
    const item = object(claimed);
    const task = taskSchema.parse(item);
    const leaseUntil = Number(item.leaseUntil);
    const generation = Number(item.generation);
    const itemId = text(item._id);
    try {
      const state = object(await ctx.runQuery(anyApi.notionStore.read, { ownerId, jobId }));
      const job = object(state.job);
      const items = objects(state.items);
      if (!state.connection || object(state.connection).workspaceId !== job.workspaceId)
        throw new Error("Reconnect the original Notion workspace, then retry this import.");
      const token = await decryptToken(text(object(state.connection).encryptedToken));
      if (task.kind === "repair") {
        const mapping = new Map(items.filter((i) => i.destinationId && i.kind !== "repair").map((i) => [text(i.sourceId), text(i.destinationId)]));
        const document = object(await ctx.runQuery(anyApi.notion.document, { ownerId, jobId, pageId: text(item.destinationId) }));
        const blocks = remapNotionLinks(parseContent(document.content), mapping);
        await write("commit", { itemId, leaseUntil, generation, blocks, warnings: [], tasks: [] });
        return null;
      }
      if (task.kind === "rows") {
        const data = await notionRequest(token, `/data_sources/${task.sourceId}/query`, {
          page_size: 50,
          ...(task.cursor ? { start_cursor: task.cursor } : {}),
        });
        const tasks: ImportTask[] = objects(data.results)
          .filter((r) => !r.in_trash && !r.archived)
          .map((r) => ({
            sourceId: text(r.id),
            kind: "page",
            parentSourceId: task.sourceId,
            parentId: null,
            databaseId: task.databaseId,
            cursor: null,
            depth: task.depth + 1,
          }));
        if (data.has_more) tasks.push({ ...task, cursor: text(data.next_cursor) });
        await write("commit", { itemId, leaseUntil, generation, tasks, warnings: [] });
        return null;
      }
      const entity = await notionRequest(
        token,
        `/${task.kind === "page" ? "pages" : task.kind === "database" ? "databases" : "data_sources"}/${task.sourceId}`,
      );
      const source = sourceFrom(entity);
      if (task.kind === "database") {
        const tasks = objects(entity.data_sources).map(
          (d) =>
            ({
              sourceId: text(d.id),
              kind: "data_source",
              parentSourceId: task.sourceId,
              parentId: null,
              databaseId: null,
              cursor: null,
              depth: task.depth + 1,
            }) satisfies ImportTask,
        );
        await write("commit", { itemId, leaseUntil, generation, entity: { title: source.title, icon: "lucide:database" }, blocks: [], tasks, warnings: [] });
        return null;
      }
      if (task.kind === "data_source") {
        await write("commit", {
          itemId,
          leaseUntil,
          generation,
          entity: { title: source.title, properties: entity.properties },
          blocks: [],
          tasks: job.includeDescendants ? [{ ...task, kind: "rows", parentSourceId: task.sourceId, cursor: null }] : [],
          warnings: job.includeDescendants ? [] : [{ sourceId: task.sourceId, message: "Database schema copied without row pages, as selected." }],
        });
        return null;
      }
      let count = 0;
      const readBlocks = async (blockId: string, depth: number): Promise<NotionBlock[]> => {
        if (depth > IMPORT_LIMITS.depth) throw new Error("This page exceeds the supported block depth. Use the Notion export importer for this page.");
        const nodes: NotionBlock[] = [];
        let cursor: string | null = null;
        do {
          const data = await notionRequest(token, `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ""}`);
          for (const raw of objects(data.results)) {
            if (++count > IMPORT_LIMITS.blocksPerPage)
              throw new Error("This page exceeds 1,000 blocks. Use an export file or split it into smaller pages; no partial body was saved.");
            const kind = text(raw.type);
            const children = raw.has_children && kind !== "child_page" && kind !== "child_database" ? await readBlocks(text(raw.id), depth + 1) : [];
            nodes.push({ raw, children });
          }
          cursor = data.has_more ? text(data.next_cursor) : null;
        } while (cursor);
        return nodes;
      };
      const converted = convertBlocks(await readBlocks(task.sourceId, 0), task.sourceId);
      const media: { blockId: string; storageId: string; name: string; type: string; size: number; kind: string }[] = [];
      for (const m of converted.media) {
        if (!trustedMediaUrl(m.url)) {
          converted.warnings.push({
            sourceId: task.sourceId,
            message: `${m.name}: external attachment was not downloaded. Only trusted Notion storage hosts are fetched.`,
          });
          continue;
        }
        try {
          const response = await fetch(m.url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
          const type = (response.headers.get("content-type") ?? "").split(";")[0];
          if (
            !response.ok ||
            !UPLOAD_TYPES.includes(type) ||
            type === "image/svg+xml" ||
            Number(response.headers.get("content-length")) > IMPORT_LIMITS.bytesPerAsset
          )
            throw new Error("unsupported media");
          const reader = response.body?.getReader();
          if (!reader) throw new Error("empty attachment");
          const parts: Uint8Array<ArrayBuffer>[] = [];
          let size = 0;
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) break;
              size += chunk.value.byteLength;
              if (size > IMPORT_LIMITS.bytesPerAsset) throw new Error("attachment exceeds 10 MB");
              parts.push(new Uint8Array(chunk.value));
            }
          } finally {
            await reader.cancel();
          }
          const runtime = createUploadRuntime();
          const capabilityHash = await runtime.hashCapability(runtime.createCapability());
          await ctx.runMutation(internal.uploadMutations.issue, { ownerId, id: runtime.newId(), capabilityHash });
          const begun = await ctx.runMutation(internal.uploadMutations.begin, { capabilityHash, attemptId: runtime.newId() });
          if (begun.state !== "receiving") throw new Error("This transfer already received bytes.");
          const storageId = await ctx.storage.store(new Blob(parts, { type }));
          try {
            const metadata = await ctx.runQuery(internal.uploadMutations.storedMetadata, { storageId });
            if (!metadata || metadata.size !== size || metadata.type !== type) throw new Error("Transferred file metadata does not match stored bytes.");
            await ctx.runMutation(internal.uploadMutations.complete, { attempt: begun.attempt, blob: { storageId, ...metadata } });
          } catch (error) {
            try {
              await ctx.runMutation(internal.uploadOrphans.adopt, {
                attempt: begun.attempt,
                storageId,
                orphanId: runtime.newId(),
                cleanupId: runtime.newId(),
                capabilityHash: await runtime.hashCapability(runtime.createCapability()),
              });
            } catch {
              // Total receiver failure still needs inventory reconciliation.
            }
            throw error;
          }
          media.push({ blockId: m.blockId, storageId, name: m.name.slice(0, 200), type, size, kind: m.kind });
        } catch {
          converted.warnings.push({
            sourceId: task.sourceId,
            message: `${m.name}: attachment could not be transferred. It may be expired, larger than 10 MB, or an unsupported type.`,
          });
        }
      }
      const tasks: ImportTask[] = job.includeDescendants
        ? converted.childSources.map((s) => ({
            sourceId: s.id,
            kind: s.kind,
            parentSourceId: task.sourceId,
            parentId: null,
            databaseId: null,
            cursor: null,
            depth: task.depth + 1,
          }))
        : [];
      if (!job.includeDescendants && converted.childSources.length)
        converted.warnings.push({ sourceId: task.sourceId, message: "Subpages were not selected; their links still point to Notion." });
      if (task.depth >= IMPORT_LIMITS.depth && tasks.length) throw new Error("This import exceeds the supported hierarchy depth. Select a smaller subtree.");
      const icon = entity.icon ? object(entity.icon) : {};
      if (entity.cover) converted.warnings.push({ sourceId: task.sourceId, message: "The Notion cover was not transferred. Choose a new cover in Max." });
      await write("commit", {
        itemId,
        leaseUntil,
        generation,
        entity: { title: source.title, icon: text(icon.emoji) || null, values: entity.properties ?? {} },
        blocks: converted.blocks,
        tasks,
        warnings: converted.warnings,
        media,
        skipped: converted.media.length - media.length,
      });
      // Unregistered receipts remain pending for bounded cleanup. A stale lease
      // or lost acknowledgement must never delete a committed attachment.
    } catch (error) {
      // A transport error can follow a successful commit. Keep these bytes until
      // receipt-aware cleanup proves that no committed attachment references them.
      const message = error instanceof NotionError || error instanceof Error ? error.message : "The import stopped. Reconnect Notion and retry.";
      await write("fail", { itemId, leaseUntil, generation, message: message.slice(0, 500) });
    }
    return null;
  },
});
