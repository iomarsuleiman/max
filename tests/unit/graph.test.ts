import { describe, expect, it } from "vitest";
import { setup } from "./harness";

describe("graph.get", () => {
  it("returns pages, links, nesting, and a local graph by depth", async () => {
    const h = { call: setup().as("u1") };
    const a = (await h.call<{ page: { _id: string } }>("pages.create", { title: "A" })).page;
    const b = (await h.call<{ page: { _id: string } }>("pages.create", { title: "B" })).page;
    const c = (await h.call<{ page: { _id: string } }>("pages.create", { title: "C", parentId: b._id })).page;
    const lone = (await h.call<{ page: { _id: string } }>("pages.create", { title: "Lone" })).page;
    await h.call("documents.writeMarkdown", { pageId: a._id, markdown: `See [B](/p/${b._id})` });

    const all = await h.call<{ nodes: { id: string; degree: number }[]; edges: { source: string; target: string; type: string }[] }>("graph.get", {});
    const ids = all.nodes.map((n) => n.id);
    expect(ids).toEqual(expect.arrayContaining([a._id, b._id, c._id, lone._id]));
    expect(all.edges).toEqual(expect.arrayContaining([{ source: a._id, target: b._id, type: "link" }, { source: b._id, target: c._id, type: "parent" }]));
    expect(all.nodes.find((n) => n.id === b._id)?.degree).toBe(2);

    const local1 = await h.call<{ nodes: { id: string; depth: number }[] }>("graph.get", { pageId: a._id, depth: 1 });
    expect(local1.nodes.map((n) => n.id).sort()).toEqual([a._id, b._id].sort());
    const local2 = await h.call<{ nodes: { id: string; depth: number }[] }>("graph.get", { pageId: a._id, depth: 2 });
    expect(local2.nodes.find((n) => n.id === c._id)?.depth).toBe(2);

    await h.call("pages.archive", { id: b._id });
    const after = await h.call<{ nodes: { id: string }[] }>("graph.get", {});
    expect(after.nodes.map((n) => n.id)).not.toContain(b._id);
  });
});

describe("home page and sidebar settings", () => {
  it("lets any page be the home page and clears it when trashed", async () => {
    const call = setup().as("u1");
    const page = (await call<{ page: { _id: string } }>("pages.create", { title: "My home" })).page;
    await call("settings.update", { homePageId: page._id });
    expect((await call<{ settings: { homePageId: string | null } }>("settings.get")).settings.homePageId).toBe(page._id);
    await call("pages.archive", { id: page._id });
    expect((await call<{ settings: { homePageId: string | null } }>("settings.get")).settings.homePageId).toBeNull();
    await expect(call("settings.update", { homePageId: "missing" })).rejects.toThrow();
  });

  it("drops the retired databases section", async () => {
    const call = setup().as("u1");
    await call("settings.update", { sidebarSections: ["pages", "databases", "favorites", "recents"], collapsedSections: ["databases", "recents"] });
    const { settings } = await call<{ settings: { sidebarSections: string[]; collapsedSections: string[] } }>("settings.get");
    expect(settings.sidebarSections).toEqual(["pages", "favorites", "recents"]);
    expect(settings.collapsedSections).toEqual(["recents"]);
  });
});
