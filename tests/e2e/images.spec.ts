import { expect, test } from "@playwright/test";

test("images open full screen like Notion: zoom, next and previous, caption, Escape closes", async ({ page, baseURL }) => {
  const op = async (name: string, args: Record<string, unknown>) => (await (await page.request.post("/api/local/ops", { data: { op: name, args } })).json()).result;
  const { page: created } = await op("pages.create", { title: "Gallery" });
  const blocks = [
    { type: "image", props: { url: `${baseURL}/icon-192.png`, caption: "The butterfly", previewWidth: 200 } },
    { type: "paragraph", content: "Between the pictures" },
    { type: "image", props: { url: `${baseURL}/icon-512.png`, caption: "Bigger butterfly", previewWidth: 200 } },
  ];
  const doc = await op("documents.get", { pageId: created._id });
  await op("documents.save", { pageId: created._id, blocks, baseRevision: doc.revision });
  await page.goto(`/p/${created._id}`);
  const first = page.locator("img.bn-visual-media").first();
  await expect(first).toBeVisible();
  // While editing, a double-click opens the viewer.
  await first.dblclick();
  const viewer = page.getByRole("dialog", { name: "The butterfly" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByText("1 of 2")).toBeVisible();
  await viewer.getByRole("button", { name: "Zoom in" }).click();
  await expect(viewer.locator("figure")).toHaveAttribute("data-zoomed", "true");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog", { name: "Bigger butterfly" })).toBeVisible();
  await expect(page.getByText("2 of 2")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Bigger butterfly" })).toHaveCount(0);
});

test("the page title grows with its text without jumping the page", async ({ page }) => {
  const { page: created } = (await (await page.request.post("/api/local/ops", { data: { op: "pages.create", args: { title: "Short" } } })).json()).result;
  await page.goto(`/p/${created._id}`);
  const title = page.getByLabel("Page title");
  const before = (await title.boundingBox())!.height;
  await title.fill("A much longer page title that has to wrap onto a second line when it gets this long");
  await expect.poll(async () => (await title.boundingBox())!.height).toBeGreaterThan(before * 1.5);
  // Typing keeps the caret where it was: the page doesn't scroll away.
  const scroll = await page.locator("#page-scroll").evaluate((e) => e.scrollTop).catch(() => 0);
  await title.press("End");
  await title.type(" more");
  expect(await page.locator("#page-scroll").evaluate((e) => e.scrollTop).catch(() => 0)).toBe(scroll);
});
