import { expect, test } from "@playwright/test";

test("outline follows headings, jumps within the page, and updates after editing", async ({ page, request }) => {
  const created = await request.post("/api/local/ops", { data: { op: "pages.create", kind: "mutation", args: { title: "Outline navigation" } } });
  const {
    result: { page: createdPage },
  } = await created.json();
  const loaded = await request.post("/api/local/ops", { data: { op: "documents.get", kind: "query", args: { pageId: createdPage._id } } });
  const { result: doc } = await loaded.json();
  const saved = await request.post("/api/local/ops", {
    data: {
      op: "documents.save",
      kind: "mutation",
      args: {
        pageId: createdPage._id,
        baseRevision: doc.revision,
        blocks: [
          { id: "outline-first", type: "heading", props: { level: 1 }, content: "First section" },
          ...Array.from({ length: 45 }, (_, i) => ({ id: `outline-paragraph-${i}`, type: "paragraph", content: `Paragraph ${i + 1}` })),
          { id: "outline-last", type: "heading", props: { level: 2 }, content: "Last section" },
        ],
      },
    },
  });
  expect(saved.ok()).toBeTruthy();
  await request.post("/api/local/ops", { data: { op: "pages.update", kind: "mutation", args: { id: createdPage._id, cover: "gradient:1" } } });
  await page.goto(`/p/${createdPage._id}`);
  const outline = page.getByRole("navigation", { name: "Page outline" });
  await expect(outline).toBeVisible();
  const rail = outline.getByRole("button", { name: "Show page outline" });
  const coverBounds = await page.locator(".max-page-header .cover-gradient-1").boundingBox();
  const railBounds = await rail.boundingBox();
  const scrollBounds = await page.locator("#page-scroll").boundingBox();
  expect(coverBounds).not.toBeNull();
  expect(railBounds!.y).toBeGreaterThan(coverBounds!.y + coverBounds!.height);
  expect(railBounds!.x + railBounds!.width).toBeLessThanOrEqual(scrollBounds!.x + scrollBounds!.width - 24);
  for (const tick of await rail.locator("span").all()) {
    const tickBounds = await tick.boundingBox();
    expect(tickBounds!.x).toBeGreaterThanOrEqual(railBounds!.x);
    expect(tickBounds!.x + tickBounds!.width).toBeLessThanOrEqual(railBounds!.x + railBounds!.width);
  }
  await outline.getByRole("button", { name: "Show page outline" }).focus();
  await expect(outline.getByRole("button", { name: "First section", exact: true })).toBeVisible();
  await outline.getByRole("button", { name: "Last section", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Last section", exact: true })).toBeInViewport();
  await page.getByRole("heading", { name: "Last section", exact: true }).click();
  await page.keyboard.press("End");
  await page.keyboard.type(" updated");
  await expect.poll(() => page.evaluate((id) => localStorage.getItem(`max:draft:${id}`), createdPage._id)).toContain("Last section updated");
  await outline.getByRole("button", { name: "Show page outline" }).hover();
  await expect(outline.getByRole("button", { name: "Last section updated", exact: true })).toBeVisible();
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(25, 25, 25)");
  await page.screenshot({ path: "test-results/outline.png" });
  await page.evaluate(() => { document.documentElement.dir = "rtl"; });
  await expect.poll(async () => {
    const bounds = await outline.boundingBox();
    const scroll = await page.locator("#page-scroll").boundingBox();
    return Math.round(bounds!.x - scroll!.x);
  }).toBeGreaterThanOrEqual(24);
  await page.evaluate(() => { document.documentElement.dir = "ltr"; });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(outline).toBeHidden();
});

test("narrow sidebar truncates long page names while keeping action buttons inside the row", async ({ page, request }) => {
  const title = `A long page title that should end with an ellipsis rather than run underneath the sidebar controls ${Date.now()}`;
  const created = await request.post("/api/local/ops", { data: { op: "pages.create", args: { title } } });
  const { result: { page: createdPage } } = await created.json();
  await request.post("/api/local/ops", { data: { op: "settings.update", args: { sidebarWidth: 200 } } });
  await request.post("/api/local/ops", { data: { op: "pages.setFavorite", args: { id: createdPage._id, favorite: true } } });
  try {
    await page.goto(`/p/${createdPage._id}`);
    const sidebar = page.getByRole("complementary", { name: "Sidebar", exact: true });
    await expect(sidebar).toHaveCSS("width", "200px");
    const tree = page.getByRole("tree", { name: "Pages", exact: true });
    const row = tree.getByRole("treeitem").filter({ hasText: title });
    const label = row.locator("[data-page-title]");
    await expect(label).toHaveCSS("text-overflow", "ellipsis");
    expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await row.hover();
    const actions = row.getByRole("button", { name: "Page actions", exact: true });
    await expect(actions).toBeVisible();
    const sidebarBounds = await sidebar.boundingBox();
    const labelBounds = await label.boundingBox();
    const actionBounds = await actions.boundingBox();
    const addBounds = await row.getByRole("button", { name: "Add a page inside", exact: true }).boundingBox();
    expect(labelBounds!.x + labelBounds!.width).toBeLessThanOrEqual(actionBounds!.x + 1);
    expect(addBounds!.x + addBounds!.width).toBeLessThanOrEqual(sidebarBounds!.x + sidebarBounds!.width - 4);
    // The sidebar's resize hit area intentionally extends 6px outside it; its page tree must not.
    expect(await tree.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    for (const section of ["Favorites", "Recents"]) {
      const region = sidebar.getByRole("region", { name: section, exact: true });
      const shortcut = region.locator("[data-shortcut-title]").filter({ hasText: title });
      await expect(shortcut).toHaveCSS("text-overflow", "ellipsis");
      expect(await shortcut.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
      const link = region.getByRole("link", { name: title, exact: true });
      const bounds = await link.boundingBox();
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(sidebarBounds!.x + sidebarBounds!.width - 4);
    }
    await page.screenshot({ path: "test-results/sidebar-long-title.png" });
  } finally {
    await request.post("/api/local/ops", { data: { op: "settings.update", args: { sidebarWidth: 248 } } });
  }
});
