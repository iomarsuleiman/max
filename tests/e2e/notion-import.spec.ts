import { expect, test } from "@playwright/test";
import { notionExportZip } from "../fixtures/notionExport";

test("a Notion export comes across like a duplicate", async ({ page }) => {
  await page.goto("/home");
  await page.getByRole("button", { name: "Import", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import" });
  await dialog.getByRole("radio", { name: "Notion" }).click();
  await dialog.locator('input[type="file"]').setInputFiles({ name: "Export-5f1c9b2e.zip", mimeType: "application/zip", buffer: Buffer.from(notionExportZip()) });
  await expect(dialog.getByText("Import finished")).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toContainText("Added 2 pages, 1 database with 3 rows and 1 image");
  await dialog.getByRole("button", { name: "Open imported pages" }).click();

  // Root page: callout, links and image.
  await expect(page.getByLabel("Page title")).toHaveValue("Studio");
  const editor = page.locator(".bn-editor");
  await expect(editor).toContainText("Film on Tuesdays, edit on Wednesdays.");
  await expect(page.locator(".lx-callout")).toHaveCount(1);
  await expect(editor.locator("img.bn-visual-media")).toHaveCount(1);
  await expect(editor.getByRole("link", { name: "Ideas" })).toHaveAttribute("href", /\/p\//);

  // Hierarchy in the sidebar.
  const tree = page.getByRole("tree", { name: "Pages" });
  await tree.getByRole("button", { name: "Expand Studio" }).last().click();
  await expect(tree).toContainText("Video Tracker");
  await expect(tree).toContainText("Ideas");

  // Subpage: numbered list, toggle, table, link back.
  await editor.getByRole("link", { name: "Ideas" }).click();
  await expect(page.getByLabel("Page title")).toHaveValue("Ideas");
  await expect(page.locator(".bn-editor")).toContainText("Viewer Q&A");
  await expect(page.locator(".bn-editor")).toContainText("Rejected ideas");
  await expect(page.locator(".bn-editor table")).toHaveCount(1);

  // Database: typed columns and rows.
  await tree.getByRole("link", { name: "Video Tracker" }).last().click();
  await expect(page.getByRole("columnheader").filter({ hasText: /\S/ })).toHaveText(["Select and reorder", "Name", "Stage", "Platform", "Publish Date", "Views", "Published", "Link"]);
  await expect(page.getByRole("row")).toHaveCount(4);
  const trailer = page.getByRole("row").filter({ hasText: "Launch trailer" });
  await expect(trailer).toContainText("Editing");
  await expect(trailer).toContainText("Nov 20, 2026");
  await expect(trailer).toContainText("1,250");
  await expect(page.getByRole("row").filter({ hasText: "Behind the scenes" })).toContainText("TikTok");

  // Row page opens in a side peek and keeps its content.
  await trailer.getByRole("button", { name: "Open" }).click();
  const peek = page.getByRole("dialog", { name: "Side peek" });
  await expect(peek.getByLabel("Page title")).toHaveValue("Launch trailer");
  await expect(peek.locator(".bn-editor")).toContainText("Open on the empty studio");
  await expect(peek.locator(".bn-editor")).toContainText("Color grade");
});
