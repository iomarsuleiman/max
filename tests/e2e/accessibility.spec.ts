import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function audit(page: Page, name: string) {
  // Let toasts finish animating in, so contrast is measured on the settled UI.
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const problems = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} × ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + " " + n.html.slice(0, 160)).join(" | ")}`);
  expect(problems, `${name}\n${problems.join("\n")}`).toEqual([]);
}

test.describe("accessibility (axe, WCAG 2.2 AA)", () => {
  test("main screens have no violations", async ({ page }) => {
    await page.goto("/home");
    await expect(page.getByRole("tree", { name: "Pages" })).toBeVisible();
    await audit(page, "home");

    await page.goto("/templates");
    await page.getByRole("button", { name: "Add to my pages" }).first().waitFor();
    await audit(page, "templates");
    await page.getByRole("button", { name: "Add to my pages" }).first().click();
    await page.waitForURL(/\/p\//);
    await page.getByRole("tab", { name: /All videos/ }).click();
    await expect(page.getByRole("row").nth(1)).toBeVisible();
    await audit(page, "database table");

    await page.getByRole("button", { name: /^Open / }).first().click();
    await expect(page.getByRole("dialog", { name: "Side peek" })).toBeVisible();
    await page.waitForTimeout(800);
    await audit(page, "side peek");
    await page.keyboard.press("Escape");

    await page.goto("/home");
    await page.getByRole("treeitem").filter({ hasText: "Welcome to Max" }).getByRole("link").click();
    await page.locator(".bn-editor").waitFor();
    await audit(page, "page");

    await page.keyboard.press("Control+k");
    await audit(page, "search");
    await page.keyboard.press("Escape");

    for (const s of ["account", "preferences", "connections", "shortcuts"]) {
      await page.goto(`/home?settings=${s}`);
      await page.getByRole("dialog", { name: "Settings" }).waitFor();
      await audit(page, `settings ${s}`);
    }

    await page.goto("/trash");
    await audit(page, "trash");
  });
});
