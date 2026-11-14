import { defineTestApp } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../../convex/schema";
import * as notionStore from "../../convex/notionStore";
import * as notionWorker from "../../convex/notionWorker";
import * as notion from "../../convex/notion";
import * as notionCleanup from "../../convex/notionCleanup";
import * as uploadMutations from "../../convex/uploadMutations";
import * as uploadOrphans from "../../convex/uploadOrphans";
import { convertBlocks, convertValues, remapNotionLinks } from "../../lib/notion/convert";
import { encryptToken, decryptToken } from "../../lib/notion/crypto";
import { trustedMediaUrl } from "../../lib/notion/client";

const app = defineTestApp({ schema }).defineModules({ notionStore, notionWorker, notion, notionCleanup, uploadMutations, uploadOrphans });
const ownerId = "alice";
const sourceId = "12345678-1234-1234-1234-123456789abc";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function setup() {
  vi.useFakeTimers();
  const t = app.createTest();
  const write = (command: string, args: Record<string, unknown> = {}, owner = ownerId) =>
    t.mutation(app.internal.notionStore.write, { ownerId: owner, command, args });
  return { t, write };
}
async function start(write: ReturnType<typeof setup>["write"], kind = "page") {
  await write("connect", { workspaceId: "workspace", workspaceName: "Workspace", encryptedToken: "cipher" });
  return write("start", {
    idempotencyKey: "stable-key",
    parentId: null,
    tasks: [{ sourceId, kind, parentSourceId: null, parentId: null, databaseId: null, cursor: null, depth: 0 }],
  });
}
describe("Notion import persistence", () => {
  it("runs provider reads, durable media, nested copies and link repair through the real worker", async () => {
    const { t, write } = setup();
    const { jobId } = await start(write);
    vi.stubEnv("NOTION_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
    await write("connect", { workspaceId: "workspace", workspaceName: "Workspace", encryptedToken: await encryptToken("provider-token") });
    const childId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const mediaUrl = "https://file.notion.so/image.png";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url === mediaUrl) {
          expect(options?.headers).toBeUndefined();
          return new Response(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"), {
            headers: { "Content-Type": "image/png" },
          });
        }
        const path = new URL(url).pathname;
        if (path === `/v1/pages/${sourceId}` || path === `/v1/pages/${childId}`)
          return Response.json({
            id: path.endsWith(childId) ? childId : sourceId,
            object: "page",
            properties: { Name: { type: "title", title: [{ plain_text: path.endsWith(childId) ? "Child" : "Root" }] } },
          });
        if (path === `/v1/blocks/${sourceId}/children`)
          return Response.json({
            results: [
              { id: childId, type: "child_page", child_page: { title: "Child" } },
              { id: "image-block", type: "image", image: { type: "file", file: { url: mediaUrl }, caption: [{ plain_text: "Picture" }] } },
            ],
            has_more: false,
          });
        if (path === `/v1/blocks/${childId}/children`)
          return Response.json({
            results: [{ id: "paragraph", type: "paragraph", paragraph: { rich_text: [{ plain_text: "Hello مرحبا" }] } }],
            has_more: false,
          });
        throw new Error(`Unexpected provider path ${path}`);
      }),
    );
    for (let step = 0; step < 5; step++) await t.action(app.internal.notionWorker.step, { ownerId, jobId });
    const { job, items } = await t.query(app.internal.notionStore.read, { ownerId, jobId });
    expect(job.status).toBe("completed_with_warnings");
    expect(job.created).toBe(2);
    expect(job.attachments).toBe(1);
    const pages = await t.run((ctx) => ctx.db.query("pages").collect());
    const root = pages.find((page) => page.title === "Root");
    const child = pages.find((page) => page.title === "Child");
    expect(child?.parentId).toBe(root?._id);
    expect(items?.filter((item) => item.kind !== "repair")).toHaveLength(2);
    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    const body = docs.find((doc) => doc.pageId === root?._id)?.content || "";
    expect(body).toContain(`/p/${child?._id}`);
    expect(body).toContain("max-asset://");
    expect(body).not.toContain(mediaUrl);
    expect(await t.run((ctx) => ctx.db.query("assets").collect())).toHaveLength(1);
    const receipts = await t.run((ctx) => ctx.db.query("uploadReceipts").take(2));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ ownerId, state: "registered" });
  });
  it("refuses media without an uploader receipt and rolls the destination back", async () => {
    const { t, write } = setup();
    const { jobId } = await start(write);
    const task = await write("claim", { jobId });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["test"], { type: "text/plain" })));
    await expect(
      write("commit", {
        jobId,
        itemId: task._id,
        leaseUntil: task.leaseUntil,
        generation: task.generation,
        entity: { title: "Unowned media" },
        blocks: [],
        media: [{ blockId: "missing", storageId, name: "unowned.txt", type: "text/plain", size: 4, kind: "file" }],
      }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("pages").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("assets").take(1))).toEqual([]);
  });
  it("blocks stale workers after disconnect and after lease recovery", async () => {
    const { t, write } = setup();
    const { jobId } = await start(write);
    const old = await write("claim", { jobId });
    vi.setSystemTime(Date.now() + 181_000);
    const current = await write("claim", { jobId });
    expect(current.generation).toBeGreaterThan(old.generation);
    const payload = { jobId, itemId: old._id, leaseUntil: old.leaseUntil, generation: old.generation, entity: { title: "Stale" }, blocks: [], tasks: [] };
    expect(await write("commit", payload)).toBeNull();
    await write("disconnect");
    expect(await write("commit", { ...payload, generation: current.generation, leaseUntil: current.leaseUntil })).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("pages").collect())).toHaveLength(0);
  });
  it("does not let an OAuth exchange reconnect after the user disconnects", async () => {
    const { write } = setup();
    await write("state", { hash: "pending-oauth" });
    await write("consume", { hash: "pending-oauth" });
    await write("disconnect");
    await expect(
      write("connect", { stateHash: "pending-oauth", workspaceId: "workspace", workspaceName: "Workspace", encryptedToken: "cipher" }),
    ).rejects.toThrow("invalid_state");
  });
  it("purges credentials and journals only for the deleted account", async () => {
    const { t, write } = setup();
    await start(write);
    await write("connect", { workspaceId: "other", workspaceName: "Other", encryptedToken: "other-cipher" }, "bob");
    await t.mutation(app.internal.notionCleanup.purge, { ownerId });
    expect(await t.run((ctx) => ctx.db.query("notionItems").collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("notionJobs").collect())).toEqual([]);
    const connections = await t.run((ctx) => ctx.db.query("notionConnections").collect());
    expect(connections).toHaveLength(1);
    expect(connections[0].ownerId).toBe("bob");
  });
  it("fences duplicate claims and cancelled workers before they create pages", async () => {
    const { t, write } = setup();
    const { jobId } = await start(write);
    const item = await write("claim", { jobId });
    expect(item).toBeTruthy();
    expect(await write("claim", { jobId })).toBeNull();
    await write("cancel", { jobId });
    expect(
      await write("commit", { jobId, itemId: item._id, leaseUntil: item.leaseUntil, generation: item.generation, entity: { title: "Cancelled" }, blocks: [] }),
    ).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("pages").collect())).toEqual([]);
  });
  it("replays starts, rejects cross-owner access and consumes OAuth state once", async () => {
    const { t, write } = setup();
    const first = await start(write);
    const second = await start(write);
    expect(second.jobId).toBe(first.jobId);
    await expect(t.query(app.internal.notionStore.read, { ownerId: "bob", jobId: first.jobId })).rejects.toThrow("Import not found");
    await write("state", { hash: "hash" });
    await write("consume", { hash: "hash" });
    await expect(write("consume", { hash: "hash" })).rejects.toThrow("invalid_state");
  });
  it("creates native database schema, custom title, rows and bodies atomically", async () => {
    const { t, write } = setup();
    const { jobId } = await start(write, "data_source");
    const task = await write("claim", { jobId });
    const dbResult = await write("commit", {
      jobId,
      itemId: task._id,
      leaseUntil: task.leaseUntil,
      generation: task.generation,
      entity: {
        title: "Projects",
        properties: {
          Task: { type: "title", title: {} },
          Status: { type: "status", status: { options: [{ name: "Ready" }] } },
          Cost: { type: "number", number: {} },
        },
      },
      blocks: [],
      tasks: [
        { sourceId: "abcdefab-1234-1234-1234-123456789abc", kind: "page", parentSourceId: sourceId, parentId: null, databaseId: null, cursor: null, depth: 1 },
      ],
      warnings: [],
    });
    const rowTask = await write("claim", { jobId });
    const row = await write("commit", {
      jobId,
      itemId: rowTask._id,
      leaseUntil: rowTask.leaseUntil,
      generation: rowTask.generation,
      entity: {
        title: "Launch",
        values: {
          Task: { type: "title", title: [{ plain_text: "Launch" }] },
          Status: { type: "status", status: { name: "Ready" } },
          Cost: { type: "number", number: 42 },
        },
      },
      blocks: [{ id: "body", type: "paragraph", content: "Arabic Ù…Ø±Ø­Ø¨Ø§", children: [] }],
      tasks: [],
      warnings: [],
    });
    const pages = await t.run((ctx) => ctx.db.query("pages").collect());
    const db = pages.find((p) => p._id === dbResult.destinationId);
    const record = pages.find((p) => p._id === row.destinationId);
    expect(db?.kind).toBe("database");
    expect(db?.properties.map((p: { name: string }) => p.name).sort()).toEqual(["Cost", "Status", "Task"]);
    expect(record?.databaseId).toBe(db?._id);
    expect(record?.title).toBe("Launch");
    expect(Object.values(record?.values)).toContain(42);
    const docs = await t.run((ctx) => ctx.db.query("documents").collect());
    expect(docs.find((d) => d.pageId === record?._id)?.text).toContain("Ù…Ø±Ø­Ø¨Ø§");
  });
  it("rolls back a failed item instead of leaving a duplicate destination", async () => {
    const { t, write } = setup();
    const { jobId } = await start(write, "data_source");
    const task = await write("claim", { jobId });
    await expect(
      write("commit", {
        jobId,
        itemId: task._id,
        leaseUntil: task.leaseUntil,
        generation: task.generation,
        entity: {
          title: "Invalid DB",
          properties: { TooMany: { type: "select", select: { options: Array.from({ length: 201 }, (_, i) => ({ name: String(i) })) } } },
        },
        blocks: [],
      }),
    ).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("pages").collect())).toHaveLength(0);
  });
});
describe("Notion conversions and credentials", () => {
  it("preserves styles, checked state, equations and reports unsupported blocks", () => {
    const result = convertBlocks(
      [
        { raw: { id: "a", type: "to_do", to_do: { checked: true, rich_text: [{ plain_text: "Ù…Ø±Ø­Ø¨Ø§", annotations: { bold: true } }] } }, children: [] },
        { raw: { id: "b", type: "equation", equation: { expression: "x^2" } }, children: [] },
        { raw: { id: "c", type: "unsupported" }, children: [] },
      ],
      sourceId,
    );
    expect(result.blocks[0].props.checked).toBe(true);
    expect(result.blocks[1].type).toBe("equation");
    expect(result.warnings).toHaveLength(1);
    const links = remapNotionLinks(
      [
        {
          id: "x",
          type: "paragraph",
          props: {},
          children: [],
          content: [{ type: "link", href: `https://www.notion.so/${sourceId.replaceAll("-", "")}`, content: [{ type: "text", text: "Link" }] }],
        },
      ],
      new Map([[sourceId, "native-page"]]),
    );
    expect(JSON.stringify(links)).toContain("/p/native-page");
  });
  it("encrypts with authenticated encryption and refuses local or redirected media URLs", async () => {
    vi.stubEnv("NOTION_TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
    const encrypted = await encryptToken("private-token");
    expect(encrypted).not.toContain("private-token");
    expect(await decryptToken(encrypted)).toBe("private-token");
    expect(trustedMediaUrl("https://127.0.0.1/test")).toBe(false);
    expect(trustedMediaUrl("https://file.notion.so.evil.test/file")).toBe(false);
    expect(trustedMediaUrl("https://file.notion.so/file")).toBe(true);
    expect(convertValues({ CustomTitle: { type: "title", title: [{ plain_text: "Title" }] } })).toEqual({});
  });
});
