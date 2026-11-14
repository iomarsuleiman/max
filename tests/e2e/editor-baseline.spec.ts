import { expect, test, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import fixture from "../fixtures/editor-document.json";
import { normalizeBlocks, walk, type Block } from "@/lib/domain/blocks";
import { remapDocumentReferences } from "@/lib/domain/importReferences";

async function op<T>(request: APIRequestContext, name: string, args: Record<string, unknown> = {}): Promise<T> {
  const response = await request.post("/api/local/ops", { data: { op: name, args } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).result;
}

// BlockNote 0.55 upgrades legacy inline-array cells to explicit tableCell nodes.
// Compare both forms with the same defaults, retaining all text, styles and spans.
function canonicalContent(content: Block["content"]) {
  if (!content || Array.isArray(content)) return content;
  return { ...content, rows: content.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => ({
    type: "tableCell",
    content: Array.isArray(cell) ? cell : cell.content,
    props: { backgroundColor: "default", textColor: "default", textAlignment: "left", colspan: 1, rowspan: 1, ...(Array.isArray(cell) ? {} : cell.props) },
  })) })) };
}

test("the complete editor corpus survives editing, reload, themes and narrow RTL layouts", async ({ page, request }, testInfo) => {
  test.setTimeout(180_000);
  await page.clock.setFixedTime(new Date("2026-11-10T12:00:00Z"));
  // The baseline records Max, without loading third-party players or embeds.
  await page.route(/https:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com|figma\.com)\//, (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fixture embed</title>" }));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await op(request, "account.init");
  await op(request, "settings.update", { profileCardOnboarded: true });
  const { page: target } = await op<{ page: { _id: string } }>(request, "pages.create", { title: "Linked page" });
  const { database } = await op<{ database: { _id: string } }>(request, "databases.create", { title: "Fixture database" });
  const { page: note } = await op<{ page: { _id: string } }>(request, "pages.create", { title: "Editor baseline" });
  const blocks = remapDocumentReferences(normalizeBlocks(fixture), new Map([["fixturepage001", target._id], ["fixturedatabase01", database._id]]));
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  for (const { block } of walk(blocks)) {
    if (!["image", "video", "audio", "file"].includes(block.type)) continue;
    const type = block.type === "image" ? "image/png" : block.type === "video" ? "video/mp4" : block.type === "audio" ? "audio/wav" : "application/pdf";
    const { uploadUrl } = await op<{ uploadUrl: string }>(request, "assets.createUploadUrl", {});
    const upload = await request.post(uploadUrl, { data: png, headers: { "Content-Type": type } });
    expect(upload.ok()).toBe(true);
    const { storageId } = await upload.json();
    const asset = await op<{ url: string }>(request, "assets.register", { pageId: note._id, storageId, name: block.props.name, type, size: png.length });
    block.props.url = asset.url;
  }
  await op(request, "documents.save", { pageId: note._id, blocks, baseRevision: 1 });
  await page.goto(`/p/${note._id}`);
  const editor = page.locator(".bn-editor");
  await expect(editor).toContainText("English العربية");
  const heading = editor.getByRole("heading", { name: "Heading one", exact: true });
  await heading.click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" edited");
  await expect.poll(async () => JSON.stringify(await op(request, "documents.get", { pageId: note._id }))).toContain("Heading one edited");
  await page.reload();
  await expect(editor).toContainText("Heading one edited");
  for (const id of ["gold-toggle", "gold-heading-3"]) {
    const toggle = editor.locator(`[data-id="${id}"]`).getByRole("button", { name: "Toggle content", exact: true }).first();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.focus();
    await toggle.press("Space");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await toggle.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  }
  await expect(editor.getByRole("combobox", { name: "Code language", exact: true })).toHaveValue("javascript");
  const saved = await op<{ blocks: Block[] }>(request, "documents.get", { pageId: note._id });
  const byId = new Map([...walk(saved.blocks)].map(({ block }) => [block.id, block]));
  for (const { block } of walk(blocks)) {
    expect(byId.get(block.id)?.type, block.id).toBe(block.type);
    expect(byId.get(block.id)?.props, block.id).toMatchObject(block.props);
    if (block.id !== "gold-heading-1") expect(canonicalContent(byId.get(block.id)?.content), block.id).toEqual(canonicalContent(block.content));
    expect(byId.get(block.id)?.children.map((child) => child.id), block.id).toEqual(block.children.map((child) => child.id));
  }
  for (const mode of [
    { name: "wide-light", width: 1440, height: 900, dark: false, dir: "ltr" },
    { name: "narrow-dark-rtl", width: 820, height: 900, dark: true, dir: "rtl" },
    { name: "phone-light", width: 390, height: 844, dark: false, dir: "ltr" },
    { name: "phone-dark-rtl", width: 390, height: 844, dark: true, dir: "rtl" },
  ]) {
    await page.setViewportSize({ width: mode.width, height: mode.height });
    await page.evaluate(({ dark, dir }) => { document.documentElement.classList.toggle("dark", dark); document.documentElement.dir = dir; }, mode);
    await page.locator("#page-scroll").evaluate((element) => { element.scrollTop = 0; });
    await page.locator("#page-scroll").evaluate((element) => { element.scrollTop = 0; });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(editor).toContainText("Heading one edited");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth), mode.name).toBeLessThanOrEqual(1);
    await expect.poll(() => page.locator("#page-scroll").evaluate((element) => element.scrollWidth - element.clientWidth), mode.name).toBeLessThanOrEqual(1);
    // Provider content is synthetic and outside Max's UI scope. Keep auditing
    // the wrapper/caption, and verify each iframe's own accessible name here.
    expect(await editor.locator("iframe").evaluateAll((frames) => frames.every((frame) => Boolean(frame.getAttribute("title")?.trim())))).toBe(true);
    const audit = await new AxeBuilder({ page }).include(".lx-editor").exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), mode.name).toEqual([]);
    const screenshot = testInfo.outputPath(`${mode.name}.png`);
    await page.screenshot({ path: screenshot, animations: "disabled" });
    await testInfo.attach(mode.name, { path: screenshot, contentType: "image/png" });
    // Element screenshots are clipped by the real scrolling ancestors. Capture
    // overlapping viewport tiles so below-fold content is actually painted.
    await editor.locator('[data-id="gold-diagram"][data-node-type="blockOuter"]').scrollIntoViewIfNeeded();
    const diagram = editor.locator('.lx-diagram img[alt="Diagram"]');
    await expect(diagram).toBeVisible();
    await expect.poll(() => diagram.evaluate((element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0)).toBe(true);
    const scroller = page.locator("#page-scroll");
    const bounds = await scroller.boundingBox();
    expect(bounds).not.toBeNull();
    if (!bounds) throw new Error("The page scroll surface is missing.");
    const viewport = page.viewportSize();
    if (!viewport) throw new Error("The visual baseline requires a fixed viewport.");
    const clip = { x: Math.ceil(bounds.x), y: Math.ceil(bounds.y), width: Math.floor(Math.min(bounds.width, viewport.width - bounds.x)), height: Math.floor(Math.min(bounds.height, viewport.height - bounds.y)) };
    const geometry = await scroller.evaluate((element) => ({ contentHeight: element.scrollHeight, viewportHeight: element.clientHeight }));
    const step = geometry.viewportHeight - 24;
    const last = Math.max(0, geometry.contentHeight - geometry.viewportHeight);
    const offsets = [...new Set([...Array.from({ length: Math.ceil(last / step) }, (_, index) => Math.min(index * step, last)), last])];
    const tiles = [];
    for (const [index, scrollTop] of offsets.entries()) {
      await scroller.evaluate((element, top) => { element.scrollTop = top; }, scrollTop);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const tileAudit = await new AxeBuilder({ page }).include(".lx-editor").exclude("iframe").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(tileAudit.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => ({ target: node.target, html: node.html, summary: node.failureSummary })) })), `${mode.name} tile ${index}`).toEqual([]);
      const filename = `reference-${mode.name}-tile-${String(index).padStart(2, "0")}.png`;
      const reference = testInfo.outputPath(filename);
      await page.screenshot({ path: reference, clip, animations: "disabled" });
      tiles.push({ filename, scrollTop: await scroller.evaluate((element) => element.scrollTop), clip, ...geometry });
      await testInfo.attach(filename, { path: reference, contentType: "image/png" });
    }
    await expect(editor.locator('[data-id="gold-left-text"][data-node-type="blockOuter"]')).toBeInViewport();
    await writeFile(testInfo.outputPath(`reference-${mode.name}.json`), JSON.stringify({ mode: mode.name, tiles }, null, 2));
  }
  await expect(page.getByText("The editor stopped working", { exact: true })).toHaveCount(0);
  await expect(page.locator(".lx-block-crash")).toHaveCount(0);
  expect(errors).toEqual([]);
});
