import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { siteNav, siteRead, siteSearch } from "@/lib/domain/sites";

async function world() {
  const h = setup();
  const alice = h.as("user_alice");
  const home = (await alice<{ page: { _id: string } }>("pages.create", { title: "Garden notes", icon: "🌱" })).page;
  const tomatoes = (await alice<{ page: { _id: string } }>("pages.create", { title: "Tomatoes", parentId: home._id })).page;
  await alice("documents.writeMarkdown", { pageId: tomatoes._id, markdown: "Water deeply twice a week in July." });
  const secret = (await alice<{ page: { _id: string } }>("pages.create", { title: "Diary" })).page;
  return { h, alice, home, tomatoes, secret };
}

describe("published websites", () => {
  it("publishes a page and what's inside it, and nothing else", async () => {
    const { h, alice, home, tomatoes, secret } = await world();
    await alice("sites.publish", { pageId: home._id, slug: "garden", name: "My garden" });
    const { site, nav } = await siteNav(h.db, "garden");
    expect(site).toMatchObject({ slug: "garden", name: "My garden", icon: "🌱", search: true, rootId: home._id });
    expect(nav.map((n) => n.title)).toEqual(["Garden notes", "Tomatoes"]);
    const doc = (await siteRead(h.db, h.storage, "garden", "documents.get", { pageId: tomatoes._id, format: "markdown" }, Date.now())) as { markdown: string };
    expect(doc.markdown).toContain("Water deeply");
    // Pages outside the site, and anything but reading, stay private.
    await expect(siteRead(h.db, h.storage, "garden", "documents.get", { pageId: secret._id }, Date.now())).rejects.toThrow();
    await expect(siteRead(h.db, h.storage, "garden", "pages.update", { id: tomatoes._id, title: "x" }, Date.now())).rejects.toThrow(/isn't available/);
    await expect(siteRead(h.db, h.storage, "garden", "comments.list", { pageId: tomatoes._id }, Date.now())).rejects.toThrow(/isn't available/);
    // Breadcrumbs start at the site's home.
    const got = (await siteRead(h.db, h.storage, "garden", "pages.get", { id: tomatoes._id }, Date.now())) as { breadcrumbs: { title: string }[] };
    expect(got.breadcrumbs.map((b) => b.title)).toEqual(["Garden notes", "Tomatoes"]);
  });

  it("searches the site, guards addresses, and takes a site down", async () => {
    const { h, alice, home, secret } = await world();
    await alice("sites.publish", { pageId: home._id, slug: "garden", name: "My garden" });
    expect((await siteSearch(h.db, "garden", "twice a week")).results.map((r) => r.title)).toEqual(["Tomatoes"]);
    expect((await siteSearch(h.db, "garden", "diary")).results).toEqual([]);
    await expect(alice("sites.publish", { pageId: secret._id, slug: "garden", name: "Taken" })).rejects.toThrow(/taken/);
    await expect(alice("sites.publish", { pageId: secret._id, slug: "admin", name: "Reserved" })).rejects.toThrow(/reserved/);
    await expect(alice("sites.publish", { pageId: secret._id, slug: "No Spaces!", name: "Bad" })).rejects.toThrow();
    const other = h.as("user_bob");
    await expect(other("sites.publish", { pageId: home._id, slug: "mine", name: "Not yours" })).rejects.toThrow();
    // Updating keeps one site per page; search can be turned off.
    await alice("sites.publish", { pageId: home._id, slug: "my-garden", name: "Garden", search: false });
    await expect(siteNav(h.db, "garden")).rejects.toThrow();
    await expect(siteSearch(h.db, "my-garden", "water")).rejects.toThrow(/off/);
    await alice("sites.unpublish", { pageId: home._id });
    await expect(siteNav(h.db, "my-garden")).rejects.toThrow();
  });

  it("keeps private relation and rollup values out of published database queries", async () => {
    const { h, alice, home } = await world();
    const { database: publicDb } = await alice<{ database: { _id: string } }>("databases.create", { title: "Public", parentId: home._id });
    const { database: privateDb } = await alice<{ database: { _id: string } }>("databases.create", { title: "Private" });
    const { property: price } = await alice<{ property: { id: string } }>("properties.add", { databaseId: privateDb._id, name: "Price", type: "number" });
    const { record: privateRow } = await alice<{ record: { _id: string } }>("records.create", { databaseId: privateDb._id, values: { Name: "Private", Price: 8675309 } });
    const { property: relation } = await alice<{ property: { id: string } }>("properties.add", { databaseId: publicDb._id, name: "Items", type: "relation", relationDatabaseId: privateDb._id });
    const { property: rollup } = await alice<{ property: { id: string } }>("properties.add", {
      databaseId: publicDb._id, name: "Total", type: "rollup", rollup: { relationPropertyId: relation.id, targetPropertyId: price.id, fn: "sum" },
    });
    await alice("records.create", { databaseId: publicDb._id, values: { Name: "Public row", Items: [privateRow._id] } });
    await alice("sites.publish", { pageId: home._id, slug: "garden", name: "Garden" });
    const query = (args: object) => siteRead(h.db, h.storage, "garden", "databases.query", { databaseId: publicDb._id, ...args }, Date.now());
    const publicResult = await query({});
    expect(publicResult).toMatchObject({ total: 1, records: [{ title: "Public row", values: {} }] });
    expect(JSON.stringify(publicResult)).not.toContain(rollup.id);
    expect(JSON.stringify(publicResult)).not.toContain(privateRow._id);
    expect(await query({ search: "8675309" })).toMatchObject({ total: 0 });
    expect(await alice("databases.query", { databaseId: publicDb._id, search: "8675309" })).toMatchObject({ total: 1 });
  });
});
