import { expect, test } from "@playwright/test";

test("Max 2.0 workspace previews are off by default", async ({ page }) => {
  const response = await page.goto("/w/tenant01");
  expect(response?.status()).toBe(404);
  await expect(page.getByText("Workspace navigation preview")).toHaveCount(0);
});
