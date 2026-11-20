import { describe, expect, it } from "vitest";
import { setup } from "./harness";

describe("sidebar tree (issue #88)", () => {
  it("keeps pages and databases inside a database row out of the sidebar's top level", async () => {
    const call = setup().as("u1");
    const { database } = await call<{ database: { _id: string } }>("databases.create", { title: "Video Projects" });
    const { record } = await call<{ record: { _id: string } }>("records.create", { databaseId: database._id, values: {} });
    // A row with its own sub-page and a nested database, as Notion imports create them.
    await call("pages.create", { title: "Editing Checklist", parentId: record._id });
    await call("databases.create", { title: "Shot List", parentId: record._id });
    await call("pages.create", { title: "Real root page" });

    const { pages } = await call<{ pages: { _id: string; title: string; parentId: string | null }[] }>("pages.tree");
    const titles = pages.map((p) => p.title);
    expect(titles).toContain("Video Projects");
    expect(titles).toContain("Real root page");
    expect(titles).not.toContain("Editing Checklist");
    expect(titles).not.toContain("Shot List");
    // Nothing is re-parented: the row still holds them.
    const children = await call<{ pages: { title: string }[] }>("pages.children", { parentId: record._id });
    expect(children.pages.map((p) => p.title).sort()).toEqual(["Editing Checklist", "Shot List"]);
  });
});
