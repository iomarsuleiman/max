import { expect, test } from "@playwright/test";

test("shared workspaces are discoverable and local mode returns to personal Max", async ({ page }) => {
  await page.goto("/home");
  await page.waitForURL(/\/p\//);
  await page.getByRole("link", { name: "Workspaces" }).click();
  await expect(page).toHaveURL(/\/spaces$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  await expect(page.getByText("Shared workspaces require a configured cloud account.")).toBeVisible();
  await page.getByRole("link", { name: "Back to Max" }).click();
  await expect(page.getByText("Shared workspaces require a configured cloud account.")).toBeHidden();
});

test("invitation URLs do not expose tokens in local setup", async ({ page }) => {
  for (const path of ["/join", "/join?token=private-invalid-token"]) {
    await page.goto(path);
    await expect(page.getByText("Shared workspaces require a configured cloud account.")).toBeVisible();
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator("body")).not.toContainText("private-invalid-token");
  }
});
