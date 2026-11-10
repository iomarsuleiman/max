import { describe, expect, it } from "vitest";
import { setup } from "./harness";

describe("pages", () => {
  it("persists cover crops, copies them into templates, and enforces crop bounds and page locks", async () => {
    const { as } = setup();
    const call = as("alice");
    const id = (await call("pages.create", { title: "Cover crop" })).page._id;
    await call("pages.update", { id, cover: "cover:met-435857", coverPosition: 78 });
    expect((await call("pages.get", { id })).page.coverPosition).toBe(78);
    const template = (await call("templates.create", { fromPageId: id })).template;
    const copy = await call("templates.apply", { templateId: template._id });
    expect((await call("pages.get", { id: copy.id })).page.coverPosition).toBe(78);
    await expect(call("pages.update", { id, coverPosition: 101 })).rejects.toMatchObject({ code: "VALIDATION" });
    await call("pages.update", { id, locked: true });
    await expect(call("pages.update", { id, coverPosition: 20 })).rejects.toMatchObject({ code: "READ_ONLY" });
    await expect(as("bob")("pages.update", { id, coverPosition: 20 })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creates, nests, orders and moves pages", async () => {
    const { as } = setup();
    const call = as("alice");
    const a = (await call("pages.create", { title: "A" })).page._id;
    const b = (await call("pages.create", { title: "B" })).page._id;
    const c = (await call("pages.create", { title: "C", index: 0 })).page._id;
    let tree = (await call("pages.tree")).pages.map((p: any) => p.title);
    expect(tree).toEqual(["C", "A", "B"]);
    await call("pages.move", { id: c, parentId: a });
    const child = (await call("pages.create", { title: "A1", parentId: c })).page._id;
    const kids = await call("pages.children", { parentId: a });
    expect(kids.pages.map((p: any) => p._id)).toEqual([c]);
    await expect(call("pages.move", { id: a, parentId: child })).rejects.toMatchObject({ code: "VALIDATION" });
    await call("pages.move", { id: b, parentId: null, index: 0 });
    tree = (await call("pages.tree")).pages.filter((p: any) => !p.parentId).map((p: any) => p.title);
    expect(tree).toEqual(["B", "A"]);
    const got = await call("pages.get", { id: child });
    expect(got.breadcrumbs.map((x: any) => x.title)).toEqual(["A", "C", "A1"]);
  });

  it("trashes and restores a subtree, and restores to the top level when the parent is gone", async () => {
    const { as } = setup();
    const call = as("alice");
    const parent = (await call("pages.create", { title: "Parent" })).page._id;
    const child = (await call("pages.create", { title: "Child", parentId: parent })).page._id;
    const grand = (await call("pages.create", { title: "Grand", parentId: child })).page._id;
    await call("pages.archive", { id: child });
    expect((await call("pages.tree")).pages.map((p: any) => p.title)).toEqual(["Parent"]);
    expect((await call("trash.list")).pages.map((p: any) => p.title)).toEqual(["Child"]);
    await call("pages.archive", { id: parent });
    await call("pages.restore", { id: child });
    const restored = await call("pages.get", { id: child });
    expect(restored.page.parentId).toBeNull();
    expect((await call("pages.get", { id: grand })).inTrash).toBe(false);
  });

  it("requires confirmation for permanent deletion", async () => {
    const { as } = setup();
    const call = as("alice");
    const p = (await call("pages.create", { title: "Gone" })).page._id;
    await expect(call("pages.deletePermanently", { id: p, confirm: true })).rejects.toMatchObject({ code: "VALIDATION" });
    await call("pages.archive", { id: p });
    await expect(call("pages.deletePermanently", { id: p })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await call("pages.deletePermanently", { id: p, confirm: true });
    await expect(call("pages.get", { id: p })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("duplicates a page with its subpages and content", async () => {
    const { as } = setup();
    const call = as("alice");
    const p = (await call("pages.create", { title: "Doc", markdown: "# Hi\n\nBody text" })).page._id;
    await call("pages.create", { title: "Sub", parentId: p });
    const { id } = await call("pages.duplicate", { id: p });
    const copy = await call("pages.get", { id });
    expect(copy.page.title).toBe("Doc (copy)");
    expect(copy.children.map((c: any) => c.title)).toEqual(["Sub"]);
    const doc = await call("documents.get", { pageId: id, format: "markdown" });
    expect(doc.markdown).toContain("Body text");
  });

  it("keeps favorites and recents in order", async () => {
    const { as } = setup();
    const call = as("alice");
    const ids = [];
    for (const t of ["One", "Two", "Three"]) ids.push((await call("pages.create", { title: t })).page._id);
    for (const id of ids) await call("pages.setFavorite", { id, favorite: true });
    await call("pages.moveFavorite", { id: ids[2], index: 0 });
    expect((await call("pages.favorites")).pages.map((p: any) => p.title)).toEqual(["Three", "One", "Two"]);
    await call("pages.touch", { id: ids[1] });
    await call("pages.touch", { id: ids[0] });
    expect((await call("pages.recents")).pages.map((p: any) => p.title)).toEqual(["One", "Two"]);
  });
});

describe("account isolation", () => {
  it("never reveals or changes another account's pages", async () => {
    const { as } = setup();
    const alice = as("alice");
    const bob = as("bob");
    const secret = (await alice("pages.create", { title: "Secret", markdown: "hidden words" })).page._id;
    await expect(bob("pages.get", { id: secret })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bob("documents.get", { pageId: secret })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bob("pages.update", { id: secret, title: "pwned" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bob("pages.move", { id: secret, parentId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bob("pages.archive", { id: secret })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const mine = (await bob("pages.create", { title: "Mine" })).page._id;
    await expect(bob("pages.move", { id: mine, parentId: secret })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await bob("search.query", { query: "hidden" })).results).toEqual([]);
    expect((await bob("pages.tree")).pages.map((p: any) => p.title)).toEqual(["Mine"]);
    expect((await alice("pages.get", { id: secret })).page.title).toBe("Secret");
  });
});
