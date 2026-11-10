import { expect, test } from "@playwright/test";

test("unknown public routes give a usable recovery", async ({ page }) => {
  const response = await page.goto("/this-page-does-not-exist");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "This page is out of reach." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Go to my pages" })).toHaveAttribute("href", "/home");
  await expect(page.getByRole("link", { name: "Check trash" })).toHaveAttribute("href", "/trash");
});

test("an unverified success URL cannot claim a Notion connection", async ({ page }) => {
  await page.route("**/api/notion", (route) => route.fulfill({ json: { result: { connected: false } } }));
  await page.goto("/connect/notion?state=success&code=do-not-render-this-code");
  await expect(page.getByRole("heading", { name: "Check your connection in Max." })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("do-not-render-this-code");
  await expect(page.locator("body")).not.toContainText("Notion is connected to your Max account");
});

test("Notion success is shown only after the backend confirms access", async ({ page }) => {
  await page.route("**/api/notion", (route) => route.fulfill({ json: { result: { connected: true, workspace: { id: "workspace", name: "Private" } } } }));
  await page.goto("/connect/notion?state=success");
  await expect(page.getByRole("heading", { name: "Your ideas can come along." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Choose pages to import" })).toHaveAttribute("href", "/home?settings=connections");
});

test("connection failure renders fixed actionable copy", async ({ page }) => {
  await page.goto("/connect/notion?state=error&reason=access_denied&error_description=private-provider-text");
  await expect(page.getByRole("heading", { name: "You stayed in control." })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("private-provider-text");
  await page.goto("/connect/status?reason=invalid_target");
  await expect(page.getByText(/exact MCP server address once/)).toBeVisible();
});
