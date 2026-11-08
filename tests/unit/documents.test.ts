import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { blocksToMarkdown, markdownToBlocks } from "@/lib/domain/blocks";

describe("documents", () => {
  it("saves with revisions and rejects stale writes", async () => {
    const { as } = setup();
    const call = as("alice");
    const p = (await call("pages.create", { title: "Doc" })).page._id;
    const doc = await call("documents.get", { pageId: p });
    const blocks = [{ type: "paragraph", content: "first" }];
    const saved = await call("documents.save", { pageId: p, blocks, baseRevision: doc.revision });
    expect(saved.revision).toBe(doc.revision + 1);
    const same = await call("documents.save", { pageId: p, blocks: (await call("documents.get", { pageId: p })).blocks, baseRevision: saved.revision });
    expect(same.unchanged).toBe(true);
    await expect(call("documents.save", { pageId: p, blocks: [{ type: "paragraph", content: "stale" }], baseRevision: doc.revision })).rejects.toMatchObject({ code: "CONFLICT" });
    const forced = await call("documents.save", { pageId: p, blocks: [{ type: "paragraph", content: "mine" }], baseRevision: doc.revision, force: true });
    expect(forced.revision).toBe(saved.revision + 1);
  });

  it("edits blocks by id", async () => {
    const { as } = setup();
    const call = as("alice", "mcp");
    const p = (await call("pages.create", { title: "Doc", markdown: "Hello world\n\n- a\n- b" })).page._id;
    let doc = await call("documents.get", { pageId: p });
    const [para, a] = doc.blocks;
    const ins = await call("blocks.insert", { pageId: p, markdown: "## Title", placement: "before", targetBlockId: para.id });
    await call("blocks.update", { pageId: p, blockId: a.id, type: "checkListItem", props: { checked: true } });
    await call("blocks.formatText", { pageId: p, blockId: para.id, text: "world", styles: { bold: true } });
    await call("blocks.move", { pageId: p, blockIds: [ins.result.blockIds[0]], placement: "end" });
    doc = await call("documents.get", { pageId: p, format: "markdown" });
    expect(doc.markdown).toBe("Hello **world**\n\n- [x] a\n\n- b\n\n## Title\n");
    await call("blocks.delete", { pageId: p, blockIds: [para.id] });
    expect((await call("documents.get", { pageId: p })).blocks).toHaveLength(3);
  });

  it("edits tables", async () => {
    const { as } = setup();
    const call = as("alice");
    const p = (await call("pages.create", { markdown: "| A | B |\n| --- | --- |\n| 1 | 2 |" })).page._id;
    const t = (await call("documents.get", { pageId: p })).blocks[0];
    await call("tables.edit", { pageId: p, blockId: t.id, action: "insert_column", column: 2 });
    await call("tables.edit", { pageId: p, blockId: t.id, action: "set_cell", row: 1, column: 2, value: "3" });
    const md = (await call("documents.get", { pageId: p, format: "markdown" })).markdown;
    expect(md).toContain("| 1 | 2 | 3 |");
  });

  it("round-trips Markdown", () => {
    const md = "# Title\n\nSome **bold** and *italic* and `code` with [a link](https://example.com).\n\n- [ ] todo\n\n- [x] done\n\n1. one\n\n2. two\n\n> quote\n\n```ts\nconst x = 1;\n```\n\n---\n";
    const out = blocksToMarkdown(markdownToBlocks(md));
    expect(out).toContain("**bold**");
    expect(out).toContain("[a link](https://example.com)");
    expect(out).toContain("- [x] done");
    expect(out).toContain("```ts\nconst x = 1;\n```");
    expect(blocksToMarkdown(markdownToBlocks(out))).toBe(out);
  });

  it("searches titles and content", async () => {
    const { as } = setup();
    const call = as("alice");
    await call("pages.create", { title: "Recipes", markdown: "Lemon cake with vanilla" });
    await call("pages.create", { title: "Vanilla notes" });
    const res = await call("search.query", { query: "vanilla" });
    expect(res.results.map((r: any) => r.title)).toEqual(["Vanilla notes", "Recipes"]);
    expect(res.results[1].snippet).toContain("vanilla");
    expect((await call("search.query", { query: "vanilla", titleOnly: true })).results).toHaveLength(1);
  });
});
