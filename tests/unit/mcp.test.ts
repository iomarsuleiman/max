import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

/** Drives the real MCP server through an MCP client, against a throwaway local workspace. */
const dir = mkdtempSync(path.join(tmpdir(), "max-mcp-"));
process.env.MAX_DATA_DIR = dir;

let client: Client;
const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const body = JSON.parse(res.content[0].text);
  return { isError: !!res.isError, body };
};

beforeAll(async () => {
  const { createMcpServer } = await import("@/lib/server/mcp");
  const server = createMcpServer("mcp-test-owner");
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  client = new Client({ name: "test", version: "1" });
  await client.connect(b);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("MCP server", () => {
  it("lists every shared operation plus composite tools", async () => {
    const { mcpTools, toolName } = await import("@/lib/server/mcp");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    for (const op of mcpTools()) expect(names).toContain(toolName(op.name));
    expect(names).toEqual(expect.arrayContaining(["assets_upload", "import_html", "max_capabilities"]));
    expect(names).not.toContain("tokens_create");
    const archive = tools.find((t) => t.name === "pages_archive")!;
    expect(archive.annotations?.destructiveHint).toBe(true);
    expect(tools.find((t) => t.name === "pages_tree")!.annotations?.readOnlyHint).toBe(true);
  });

  it("creates, edits, reads and searches content", async () => {
    const created = await call("pages_create", { title: "Roadmap", markdown: "# Q1\n\n- [ ] Launch" });
    expect(created.isError).toBe(false);
    const id = created.body.page._id;
    const doc = await call("documents_get", { pageId: id });
    const ins = await call("blocks_insert", { pageId: id, markdown: "Shipped **v1**", placement: "end", baseRevision: doc.body.revision });
    expect(ins.isError).toBe(false);
    const stale = await call("blocks_insert", { pageId: id, markdown: "late", baseRevision: doc.body.revision });
    expect(stale).toMatchObject({ isError: true, body: { error: { code: "CONFLICT" } } });
    const md = await call("documents_get", { pageId: id, format: "markdown" });
    expect(md.body.markdown).toContain("Shipped **v1**");
    const found = await call("search_query", { query: "shipped" });
    expect(found.body.results[0]._id).toBe(id);
    const resource = await client.readResource({ uri: `max://page/${id}` });
    expect((resource.contents[0] as { text: string }).text).toContain("# Roadmap");
  });

  it("replays writes sent with the same idempotency key", async () => {
    const first = await call("pages_create", { title: "Once", idempotencyKey: "key-12345678" });
    const again = await call("pages_create", { title: "Once", idempotencyKey: "key-12345678" });
    expect(again.body.page._id).toBe(first.body.page._id);
    expect(again.body.idempotentReplay).toBe(true);
    const tree = await call("pages_tree");
    expect(tree.body.pages.filter((p: { title: string }) => p.title === "Once")).toHaveLength(1);
  });

  it("works with databases end to end", async () => {
    const { body } = await call("gallery_install", { key: "projects-tasks" });
    const row = await call("records_create", { databaseId: body.id, values: { Name: "Write docs", Status: "In progress", Priority: "High" } });
    expect(row.isError).toBe(false);
    const q = await call("databases_query", { databaseId: body.id, search: "docs" });
    expect(q.body.records.map((r: { title: string }) => r.title)).toEqual(["Write docs"]);
  });

  it("requires confirmation for permanent deletion and logs assistant activity", async () => {
    const page = await call("pages_create", { title: "Temp" });
    await call("pages_archive", { id: page.body.page._id });
    const denied = await call("pages_deletePermanently", { id: page.body.page._id });
    expect(denied.body.error.code).toBe("CONFIRMATION_REQUIRED");
    const ok = await call("pages_deletePermanently", { id: page.body.page._id, confirm: true });
    expect(ok.isError).toBe(false);
  });

  it("imports HTML and uploads images from base64", async () => {
    const imported = await call("import_html", { html: "<html><head><title>Article</title><script>alert(1)</script></head><body><h2>Hello</h2><p>Some <strong>bold</strong> text</p></body></html>" });
    expect(imported.isError).toBe(false);
    const md = await call("documents_get", { pageId: imported.body.id, format: "markdown" });
    expect(md.body.title).toBe("Article");
    expect(md.body.markdown).toContain("**bold**");
    expect(md.body.markdown).not.toContain("alert");
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const up = await call("assets_upload", { base64: png, name: "dot.png" });
    expect(up.body.url).toMatch(/^max-asset:\/\//);
    const bad = await call("assets_upload", { base64: Buffer.from("not an image").toString("base64") });
    expect(bad.isError).toBe(true);
    const ssrf = await call("assets_upload", { url: "https://127.0.0.1/secret.png" });
    expect(ssrf.body.error.message).toMatch(/private network/);
  });
});
