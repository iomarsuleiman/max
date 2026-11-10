import { expect, test } from "@playwright/test";

test("mobile navigation drawer opens and navigates", async ({ page }) => {
  await page.goto("/home");
  await page.waitForURL(/\/p\//);
  await page.getByRole("button", { name: "Open navigation" }).click();
  const nav = page.getByRole("dialog", { name: "Navigation" });
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Templates" }).click();
  await expect(page).toHaveURL(/\/templates/);
  await expect(page.getByRole("heading", { name: "Templates", exact: true })).toBeVisible();
});

test("mobile card stays compact and settings remain reachable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/home?settings=account");
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  const card = dialog.getByRole("article", { name: "Your profile card preview" });
  await expect(card).toBeVisible();
  expect((await card.boundingBox())!.width).toBeLessThanOrEqual(248);
  await dialog.getByLabel("Name", { exact: true }).fill("A very long name with lots of words for a small card");
  await dialog.getByRole("button", { name: "Change" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/max-mobile-card.png" });
  await dialog.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(dialog).not.toBeVisible();
});

test("mobile keyboard toolbar formats, inserts blocks and saves without losing focus", async ({ page }) => {
  // A real phone opens the OS keyboard. Model its visual viewport here, keeping layout width unchanged.
  await page.addInitScript(() => {
    // Windows WebKit emulates touch events but reports zero touch points; model the phone hardware too.
    Object.defineProperty(navigator, "maxTouchPoints", { configurable: true, get: () => 5 });
    let height = 840;
    if (window.visualViewport) Object.defineProperty(window.visualViewport, "height", { configurable: true, get: () => height });
    Object.defineProperty(window, "setTestKeyboardHeight", {
      value: (next: number) => {
        height = next;
        window.visualViewport?.dispatchEvent(new Event("resize"));
      },
    });
  });
  await page.goto("/home");
  await page.waitForURL(/\/p\//);
  const original = page.url();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog", { name: "Navigation" }).getByRole("button", { name: "New page", exact: true }).last().click();
  await page.waitForURL((url) => url.href !== original && url.pathname.startsWith("/p/"));
  const editor = page.locator(".bn-editor");
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("Control+End");
  await editor.press("Enter");
  await page.evaluate(() => {
    Reflect.get(window, "setTestKeyboardHeight")(470);
  });
  const toolbar = page.locator(".bn-mobile-formatting-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: /^Bold/ }).click();
  await page.keyboard.insertText("Mobile bold note");
  await expect(editor.locator("strong").filter({ hasText: "Mobile bold note" })).toBeVisible();
  await toolbar.getByRole("button", { name: "More formatting", exact: true }).click();
  await expect(toolbar.getByRole("group", { name: "More formatting" })).toBeVisible();
  await expect(toolbar.getByRole("button", { name: /^Underline/ })).toBeVisible();
  expect(await toolbar.evaluate((element) => element.scrollWidth <= innerWidth)).toBe(true);
  await toolbar.getByRole("button", { name: "More formatting", exact: true }).click();
  await toolbar.getByRole("button", { name: "Insert block", exact: true }).click();
  await page.getByRole("option", { name: /^Heading 2/ }).click();
  await page.keyboard.insertText("Phone heading");
  await expect(editor.getByRole("heading", { name: "Phone heading", exact: true }).last()).toBeVisible();
  await toolbar.getByRole("button", { name: "More formatting", exact: true }).click();
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Phone heading", exact: true })).toHaveCount(0);
  await toolbar.getByRole("button", { name: "Redo", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Phone heading", exact: true })).toBeVisible();
  await toolbar.getByRole("button", { name: "More formatting", exact: true }).click();
  await toolbar.getByRole("button", { name: "Insert block", exact: true }).click();
  await page.getByRole("option", { name: /^Code/ }).click();
  await page.keyboard.insertText("const message = '" + "A_long_unbroken_code_line_".repeat(30) + "';");
  const code = editor.locator('[data-content-type="codeBlock"] pre');
  await expect(code).toBeVisible();
  expect(await code.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const scroll = page.locator("#page-scroll");
  expect(await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await toolbar.getByRole("button", { name: "More formatting", exact: true }).click();
  await toolbar.getByRole("button", { name: "Duplicate block", exact: true }).click();
  await expect(editor.locator('[data-content-type="codeBlock"]')).toHaveCount(2);
  await toolbar.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(editor.locator('[data-content-type="codeBlock"]')).toHaveCount(1);
  await page.screenshot({ path: "test-results/max-mobile-editor.png" });
  await toolbar.getByRole("button", { name: "Done editing", exact: true }).click();
  await expect(toolbar).not.toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible({ timeout: 10000 });
  await page.reload();
  await expect(editor).toContainText("Phone heading");
  await expect(editor).toContainText("Mobile bold note");
});


test("wide mobile documents wrap text, stack columns and scroll tables locally", async ({ page, request }) => {
  const created = await request.post("/api/local/ops", { data: { op: "pages.create", args: { title: "Wide phone document" } } });
  expect(created.ok()).toBe(true);
  const pageId = (await created.json()).result.page._id;
  const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text, styles: {} }] });
  const saved = await request.post("/api/local/ops", { data: { op: "documents.save", args: { pageId, blocks: [
    paragraph("Unbroken_".repeat(60)),
    { type: "columnList", children: [
      { type: "column", props: { width: 1 }, children: [paragraph("First column on a phone")] },
      { type: "column", props: { width: 1 }, children: [paragraph("Second column on a phone")] },
    ] },
    { type: "table", content: { type: "tableContent", rows: [
      { cells: Array.from({ length: 12 }, (_, index) => [{ type: "text", text: `Column ${index}`, styles: {} }]) },
      { cells: Array.from({ length: 12 }, () => [{ type: "text", text: "A wide table cell", styles: {} }]) },
    ] } },
  ] } } });
  expect(saved.ok()).toBe(true);
  await page.goto(`/p/${pageId}`);
  const editor = page.locator(".bn-editor");
  await expect(editor).toContainText("Second column on a phone");
  await expect(editor.locator(".bn-block-column-list")).toHaveCSS("flex-direction", "column");
  await expect(page.locator(".lx-side-menu:visible")).toHaveCount(0);
  const scroll = page.locator("#page-scroll");
  expect(await scroll.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const table = editor.locator('[data-content-type="table"] .tableWrapper');
  await table.scrollIntoViewIfNeeded();
  expect(await table.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  await table.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  expect(await table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results/max-mobile-wide-content.png" });
});
