import { describe, expect, it } from "vitest";
import { defaultBlockSpecs } from "@blocknote/core";
import fixture from "../fixtures/editor-document.json";
import { MAX_CONTENT_BYTES, normalizeBlocks, parseContent, referencedPageIds, walk, type Block } from "@/lib/domain/blocks";
import { setup } from "./harness";
import type { PageRow } from "@/lib/domain/types";

type Document = { blocks: Block[]; revision: number };

describe("editor migration fixtures", () => {
  it("preserves every persisted block and inline type through save, export and restore", async () => {
    const { as, db } = setup();
    const call = as("alice");
    const { page } = await call<{ page: PageRow }>("pages.create", { title: "Editor golden document" });
    await call("documents.save", { pageId: page._id, blocks: fixture, baseRevision: 1 });
    const expected = normalizeBlocks(fixture);
    const saved = await call<Document>("documents.get", { pageId: page._id });
    expect(saved.blocks).toEqual(expected);
    expect([...walk(saved.blocks)].map(({ block }) => block.id)).toEqual([...walk(expected)].map(({ block }) => block.id));
    expect(new Set([...walk(saved.blocks)].map(({ block }) => block.type))).toEqual(new Set([
      ...Object.keys(defaultBlockSpecs), "callout", "equation", "youtube", "diagram", "pageLink", "bookmark", "toc", "embed", "databaseView", "columnList", "column",
    ]));
    expect(referencedPageIds(saved.blocks).sort()).toEqual(["fixturedatabase01", "fixturepage001"]);
    const backup = await call<{ content: string }>("export.all", { format: "json" });
    await as("restored", "mcp")("import.maxExport", { data: backup.content });
    const [copy] = await db.list("pages", "restored");
    expect((await as("restored")<Document>("documents.get", { pageId: copy._id })).blocks).toEqual(expected);
    expect((await call<Document>("documents.get", { pageId: page._id })).blocks).toEqual(expected);
  });

  it("rejects an oversized document without changing the last acknowledged content", async () => {
    const { as, db } = setup();
    const call = as("alice");
    const { page } = await call<{ page: PageRow }>("pages.create", { title: "Size limit", markdown: "Keep this" });
    const before = db.snapshot();
    await expect(call("documents.save", { pageId: page._id, baseRevision: 1, blocks: [{ type: "paragraph", content: "x".repeat(MAX_CONTENT_BYTES) }] })).rejects.toMatchObject({ code: "LIMIT" });
    expect(db.snapshot()).toBe(before);
  });

  it("normalizes incomplete block shapes and duplicate IDs without losing nested text", async () => {
    const { as } = setup();
    const call = as("alice");
    const { page } = await call<{ page: PageRow }>("pages.create", { title: "Partial document" });
    await call("documents.save", { pageId: page._id, blocks: [
      { id: "duplicate", type: "paragraph", content: "First", children: [{ id: "duplicate", content: "Nested" }] },
      { id: "duplicate", content: "Second", children: "invalid children" },
    ], baseRevision: 1 });
    const saved = await call<Document>("documents.get", { pageId: page._id });
    const blocks = [...walk(saved.blocks)].map(({ block }) => block);
    expect(new Set(blocks.map((block) => block.id)).size).toBe(3);
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "paragraph", "paragraph"]);
    expect(saved.blocks[0].id).toBe("duplicate");
    expect(JSON.stringify(saved.blocks)).toContain("Nested");
  });

  it.each(["{truncated", "null", '{"blocks":[]}'])('reads damaged serialized content %s without overwriting the stored bytes', async (content) => {
    const { as, db } = setup();
    const call = as("alice");
    const { page } = await call<{ page: PageRow }>("pages.create", { title: "Damaged document" });
    const [document] = await db.list("documents", "alice", { field: "pageId", value: page._id });
    await db.patch("documents", document._id, { content });
    const before = db.snapshot();
    expect((await call<Document>("documents.get", { pageId: page._id })).blocks).toEqual([]);
    expect(db.snapshot()).toBe(before);
    expect(parseContent(content)).toEqual([]);
  });
});
