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

// Drops a file the way the browser does: dragenter, dragover and drop at a point.
async function dropFile(page: import("@playwright/test").Page, at: { x: number; y: number }, file: { name: string; type: string; text?: string; url?: string }) {
  await page.evaluate(
    async ({ at, file }) => {
      const bytes = file.url ? new Uint8Array(await (await fetch(file.url)).arrayBuffer()) : new TextEncoder().encode(file.text ?? "");
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], file.name, { type: file.type }));
      const target = document.elementFromPoint(at.x, at.y)!;
      for (const type of ["dragenter", "dragover", "drop"]) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: at.x, clientY: at.y }));
    },
    { at, file },
  );
}

test("adding an image never breaks the editor, and pictures and Markdown can be dropped in", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const { page: created } = (await (await page.request.post("/api/local/ops", { data: { op: "pages.create", args: { title: "Drops", markdown: "First line" } } })).json()).result;
  await page.goto(`/p/${created._id}`);
  const editor = page.locator(".bn-editor");
  await editor.getByText("First line").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/image");
  await page.keyboard.press("Enter");
  // An empty image block asks for a picture instead of crashing the page.
  await expect(page.locator("[data-content-type=image]")).toHaveCount(1);
  await expect(page.getByText("The editor stopped working")).toHaveCount(0);

  const line = (await editor.getByText("First line").boundingBox())!;
  await dropFile(page, { x: line.x + 10, y: line.y + line.height / 2 }, { name: "butterfly.png", type: "image/png", url: "/icon-192.png" });
  await expect(page.locator("img.bn-visual-media")).toHaveCount(1);

  await dropFile(page, { x: line.x + 10, y: line.y + line.height / 2 }, { name: "notes.md", type: "text/markdown", text: "## From a file\n\n- one" });
  await expect(editor.locator("h2", { hasText: "From a file" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("a Markdown file dropped on the sidebar opens as a new page", async ({ page, isMobile }) => {
  test.skip(isMobile, "The sidebar is a drawer on phones.");
  await page.goto("/home");
  const sidebar = page.locator("[data-sidebar]");
  await expect(sidebar).toBeVisible();
  const box = (await sidebar.boundingBox())!;
  await dropFile(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { name: "Packing list.md", type: "text/markdown", text: "- passport\n- charger" });
  await expect(page).toHaveURL(/\/p\//);
  await expect(page.getByLabel("Page title")).toHaveValue("Packing list");
  await expect(page.locator(".bn-editor").getByText("passport")).toBeVisible();
});
