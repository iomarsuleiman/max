import { describe, expect, it } from "vitest";
import { MemoryDb } from "@/lib/domain/memoryDb";
import type { PageRow } from "@/lib/domain/types";
import { setup } from "./harness";
import type { Block } from "@/lib/domain/blocks";

describe("v2 recovery baseline", () => {
  it("remaps page references without rewriting prose, code, block IDs or external URLs", async () => {
    const { db, as } = setup();
    const call = as("alice");
    const { page } = await call<{ page: PageRow }>("pages.create", { title: "Target" });
    const externalUrl = `https://example.com/p/${page._id}`;
    await call("documents.save", { pageId: page._id, baseRevision: 1, blocks: [
      { id: page._id, type: "paragraph", content: [
        { type: "text", text: `Literal ${page._id}`, styles: {} },
        { type: "link", href: externalUrl, content: [{ type: "text", text: page._id, styles: {} }] },
        { type: "link", href: `/p/target-${page._id}#anchor`, content: [{ type: "text", text: "Internal", styles: {} }] },
        { type: "pageMention", props: { pageId: page._id, title: page._id } },
      ] },
      { id: "code-id", type: "codeBlock", props: { language: "text" }, content: page._id },
      { id: "page-link", type: "pageLink", props: { pageId: page._id } },
    ] });
    const backup = await call<{ content: string }>("export.all", { format: "json" });
    await as("restored")("import.maxExport", { data: backup.content });
    const [copy] = await db.list("pages", "restored");
    const { blocks } = await as("restored")<{ blocks: Block[] }>("documents.get", { pageId: copy._id });
    expect(blocks[0].id).toBe(page._id);
    expect(blocks[0].content).toEqual([
      { type: "text", text: `Literal ${page._id}`, styles: {} },
      { type: "link", href: externalUrl, content: [{ type: "text", text: page._id, styles: {} }] },
      { type: "link", href: `/p/target-${copy._id}#anchor`, content: [{ type: "text", text: "Internal", styles: {} }] },
      { type: "pageMention", props: { pageId: copy._id, title: page._id } },
    ]);
    expect(blocks[1].content).toEqual([{ type: "text", text: page._id, styles: {} }]);
    expect(blocks[2].props.pageId).toBe(copy._id);
  });

  it("restores relations and relation filters onto copied databases without rewriting text values", async () => {
    const { as, db } = setup();
    const call = as("alice");
    const { database: projects } = await call<{ database: PageRow }>("databases.create", { title: "Projects" });
    const { record: project } = await call<{ record: PageRow }>("records.create", { databaseId: projects._id, values: { Name: "Project" } });
    const { database: tasks } = await call<{ database: PageRow }>("databases.create", { title: "Tasks" });
    const { property } = await call<{ property: { id: string } }>("properties.add", { databaseId: tasks._id, name: "Project", type: "relation", relationDatabaseId: projects._id });
    const { property: note } = await call<{ property: { id: string } }>("properties.add", { databaseId: tasks._id, name: "Notes", type: "text" });
    await call("records.create", { databaseId: tasks._id, values: { Name: project._id, [property.id]: [project._id], [note.id]: project._id } });
    const taskDatabase = await db.get("pages", tasks._id);
    if (!taskDatabase?.views) throw new Error("Missing fixture views");
    await db.patch("pages", tasks._id, { views: taskDatabase.views.map((view) => ({ ...view, filters: [{ id: "filter", propertyId: property.id, operator: "contains", value: project._id }] })) });
    const backup = await call<{ content: string }>("export.all", { format: "json" });
    await as("restored")("import.maxExport", { data: backup.content });
    const pages = await db.list("pages", "restored");
    const copiedProjects = pages.find((p) => p.title === "Projects");
    const copiedProject = pages.find((p) => p.title === "Project");
    const copiedTasks = pages.find((p) => p.title === "Tasks");
    const copiedTask = pages.find((p) => p.databaseId === copiedTasks?._id);
    expect(copiedTasks?.properties?.find((p) => p.id === property.id)?.relationDatabaseId).toBe(copiedProjects?._id);
    expect(copiedTasks?.views?.[0].filters[0].value).toBe(copiedProject?._id);
    expect(copiedTask?.values?.[property.id]).toEqual([copiedProject?._id]);
    expect(copiedTask?.title).toBe(project._id);
    expect(copiedTask?.values?.[note.id]).toBe(project._id);
  });
  it("restores an exact snapshot after edits, including nested IDs and revisions", async () => {
    const { db, as } = setup();
    const call = as("alice");
    const { page: parent } = await call<{ page: PageRow }>("pages.create", { title: "Root" });
    const { page: child } = await call<{ page: PageRow }>("pages.create", { title: "ملاحظات", parentId: parent._id, markdown: "## Notes\n\n- [x] محفوظ" });
    await as("bob")("pages.create", { title: "Private" });
    const before = db.snapshot();
    const document = await call("documents.get", { pageId: child._id });
    await call("documents.save", { pageId: child._id, blocks: [{ type: "paragraph", content: "changed" }], baseRevision: document.revision });
    const recovered = new MemoryDb();
    recovered.restore(before);
    expect(recovered.snapshot()).toBe(before);
    expect(await recovered.get("pages", child._id)).toEqual(child);
    expect((await recovered.list("documents", "alice", { field: "pageId", value: child._id }))[0].content).toBe(JSON.stringify(document.blocks));
    expect(await recovered.list("pages", "bob")).toHaveLength(1);
  });

  it("imports exported nested pages as copies without changing originals or leaking another owner", async () => {
    const { db, as } = setup();
    const call = as("alice", "mcp");
    const { page: root } = await call<{ page: PageRow }>("pages.create", { title: "Root", markdown: "Original" });
    const { page: child } = await call<{ page: PageRow }>("pages.create", { title: "Child", parentId: root._id, markdown: "- [x] محفوظ" });
    await as("bob")("pages.create", { title: "Never export this" });
    const originals = await db.list("documents", "alice");
    const backup = await call<{ content: string }>("export.all", { format: "json" });
    expect(backup.content).not.toContain("Never export this");
    await call("import.maxExport", { data: backup.content });
    const copies = (await db.list("pages", "alice")).filter((p) => p._id !== root._id && p._id !== child._id);
    expect(copies).toHaveLength(2);
    const copiedRoot = copies.find((p) => p.title === "Root");
    expect(copiedRoot).toBeDefined();
    expect(copies.find((p) => p.title === "Child")?.parentId).toBe(copiedRoot?._id);
    for (const original of originals) {
      expect(await db.get("documents", original._id)).toEqual(original);
      const title = original.pageId === root._id ? "Root" : "Child";
      const copy = copies.find((p) => p.title === title);
      expect(copy).toBeDefined();
      const restored = await db.list("documents", "alice", { field: "pageId", value: copy?._id ?? "" });
      expect(restored[0].content).toBe(original.content);
    }
  });
});
