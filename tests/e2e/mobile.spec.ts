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
