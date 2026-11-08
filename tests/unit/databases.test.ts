import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { evaluateFormula } from "@/lib/domain/formula";

describe("personal databases", () => {
  it("creates rows, coerces values, filters and sorts", async () => {
    const { as } = setup();
    const call = as("alice");
    const { database } = await call("databases.create", { title: "Books" });
    const dbId = database._id;
    await call("properties.add", { databaseId: dbId, name: "Pages", type: "number" });
    await call("records.create", { databaseId: dbId, values: { Name: "Dune", Pages: "412", Tags: "scifi, classic", Status: "Done" } });
    await call("records.create", { databaseId: dbId, values: { Name: "Emma", Pages: 300, Tags: ["classic"] } });
    await expect(call("records.create", { databaseId: dbId, values: { Pages: "lots" } })).rejects.toMatchObject({ code: "VALIDATION" });
    const schema = await call("databases.get", { databaseId: dbId });
    const pages = schema.properties.find((p: any) => p.name === "Pages").id;
    const tags = schema.properties.find((p: any) => p.name === "Tags");
    expect(tags.options.map((o: any) => o.name)).toEqual(["scifi", "classic"]);
    const sorted = await call("databases.query", { databaseId: dbId, sorts: [{ propertyId: pages, direction: "asc" }] });
    expect(sorted.records.map((r: any) => r.title)).toEqual(["Emma", "Dune"]);
    const filtered = await call("databases.query", { databaseId: dbId, filters: [{ propertyId: tags.id, operator: "contains", value: "scifi" }] });
    expect(filtered.records.map((r: any) => r.title)).toEqual(["Dune"]);
    expect(filtered.unfilteredTotal).toBe(2);
  });

  it("computes formulas and rollups", async () => {
    const { as } = setup();
    const call = as("alice");
    const items = (await call("databases.create", { title: "Items" })).database._id;
    await call("properties.add", { databaseId: items, name: "Price", type: "number" });
    const a = (await call("records.create", { databaseId: items, values: { Name: "A", Price: 5 } })).record._id;
    const b = (await call("records.create", { databaseId: items, values: { Name: "B", Price: 7 } })).record._id;
    const orders = (await call("databases.create", { title: "Orders" })).database._id;
    const rel = (await call("properties.add", { databaseId: orders, name: "Items", type: "relation", relationDatabaseId: items })).property;
    const schemaItems = await call("databases.get", { databaseId: items });
    const price = schemaItems.properties.find((p: any) => p.name === "Price").id;
    const roll = (await call("properties.add", { databaseId: orders, name: "Total", type: "rollup", rollup: { relationPropertyId: rel.id, targetPropertyId: price, fn: "sum" } })).property;
    const f = (await call("properties.add", { databaseId: orders, name: "Label", type: "formula", formula: 'concat(prop("Name"), ": ", prop("Total") * 2)' })).property;
    await call("records.create", { databaseId: orders, values: { Name: "Order 1", Items: [a, b] } });
    const res = await call("databases.query", { databaseId: orders });
    expect(res.records[0].values[roll.id]).toBe(12);
    expect(res.records[0].values[f.id]).toBe("Order 1: 24");
    await expect(call("properties.add", { databaseId: orders, name: "Bad", type: "formula", formula: "prop(" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("formula language", () => {
    const get = (n: string) => ({ a: 2, b: "x", d: "2026-11-10" } as Record<string, any>)[n];
    expect(evaluateFormula('prop("a") * 3 + 1', get)).toBe(7);
    expect(evaluateFormula('if(prop("a") > 1, "big", "small")', get)).toBe("big");
    expect(evaluateFormula('dateBetween(prop("d"), "2026-11-08", "days")', get)).toBe(2);
    expect(() => evaluateFormula("constructor.constructor('x')()", get)).toThrow();
  });

  it("manages views", async () => {
    const { as } = setup();
    const call = as("alice");
    const dbId = (await call("databases.create", { title: "T" })).database._id;
    const { view } = await call("views.create", { databaseId: dbId, name: "Board", type: "board" });
    expect(view.groupByPropertyId).toBeTruthy();
    await call("views.update", { databaseId: dbId, viewId: view.id, patch: { name: "Pipeline" } });
    const schema = await call("databases.get", { databaseId: dbId });
    expect(schema.views.map((v: any) => v.name)).toEqual(["Table", "Pipeline"]);
  });
});

describe("templates", () => {
  it("installs a gallery template and creates rows from its row template", async () => {
    const { as } = setup();
    const call = as("alice");
    const { id } = await call("gallery.install", { key: "video-projects" });
    const schema = await call("databases.get", { databaseId: id });
    expect(schema.views.map((v: any) => v.type)).toEqual(["board", "calendar", "table", "gallery"]);
    const { templates } = await call("templates.list", { databaseId: id });
    expect(templates).toHaveLength(1);
    const made = await call("templates.apply", { templateId: templates[0]._id });
    const doc = await call("documents.get", { pageId: made.id, format: "markdown" });
    expect(doc.markdown).toContain("## Shot list");
    const rows = await call("databases.query", { databaseId: id });
    expect(rows.total).toBe(3);
  });

  it("fills {{today}} in page templates", async () => {
    const { as } = setup();
    const call = as("alice");
    const { template } = await call("templates.create", { title: "Daily {{today}}", markdown: "Date: {{today}}" });
    const { id } = await call("templates.apply", { templateId: template._id });
    const page = await call("pages.get", { id });
    expect(page.page.title).toMatch(/^Daily \d{4}-\d{2}-\d{2}$/);
    expect((await call("pages.tree")).pages).toHaveLength(1);
  });
});

describe("batch and MCP safety", () => {
  it("rolls back the whole batch when one operation fails", async () => {
    const { as } = setup();
    const call = as("alice", "mcp");
    await expect(
      call("batch", { operations: [{ op: "pages.create", args: { title: "kept?" } }, { op: "pages.update", args: { id: "missing", title: "x" } }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", details: { failedIndex: 1 } });
    expect((await call("pages.tree")).pages).toHaveLength(0);
  });

  it("hides credential and account operations from assistants and audits writes", async () => {
    const { as } = setup();
    const mcp = as("alice", "mcp");
    await expect(mcp("tokens.create", { name: "x" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(mcp("account.deleteAllData", { confirm: true })).rejects.toMatchObject({ code: "VALIDATION" });
    await mcp("pages.create", { title: "From assistant" });
    const ui = as("alice");
    const { events } = await ui("audit.list");
    expect(events.map((e: any) => e.op)).toEqual(["pages.create"]);
  });

  it("issues tokens that resolve by hash only", async () => {
    const { as, db } = setup();
    const ui = as("alice");
    const { secret } = await ui("tokens.create", { name: "ChatGPT" });
    const { sha256 } = await import("@/lib/domain/ops/helpers");
    const row = await db.findTokenByHash(await sha256(secret));
    expect(row?.ownerId).toBe("alice");
    expect(JSON.stringify((await ui("tokens.list")).tokens)).not.toContain(secret);
  });
});
