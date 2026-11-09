import { expect, test, type Page } from "@playwright/test";

async function newPage(page: Page, title: string) {
  // /home opens your home page (or your first page), so wait for that before creating another.
  await page.goto("/home");
  await page.waitForURL(/\/p\//);
  await page.locator(".bn-editor").waitFor();
  const before = page.url();
  await page.getByRole("button", { name: "New page" }).last().click();
  await page.waitForURL((u) => u.href !== before && u.pathname.startsWith("/p/"));
  await page.getByLabel("Page title").fill(title);
  return page.url();
}

test("first visit creates a welcome page", async ({ page }) => {
  await page.goto("/home");
  await expect(page.getByRole("treeitem").first()).toBeVisible();
  await expect(page.getByRole("tree", { name: "Pages" })).toContainText("Welcome to Max");
});

test("write, autosave and find the content after a reload", async ({ page }) => {
  await newPage(page, "Journal entry");
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.getByLabel("Page title").press("Enter");
  const saved = page.waitForResponse((r) => r.url().includes("/api/local/ops") && (r.request().postData() ?? "").includes("documents.save") && r.ok());
  await page.keyboard.type("The quick brown fox");
  await saved;
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel("Page title")).toHaveValue("Journal entry");
  await page.reload();
  await expect(page.locator(".bn-editor")).toContainText("The quick brown fox");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search pages, databases and rows…").fill("brown fox");
  await expect(page.getByRole("option").filter({ hasText: "Journal entry" })).toBeVisible();
});

test("nest pages, move to trash and restore", async ({ page }) => {
  const parentUrl = await newPage(page, "Parent page");
  const parentId = parentUrl.split("/p/")[1].split("?")[0];
  await page.getByRole("treeitem").filter({ hasText: "Parent page" }).hover();
  await page.getByRole("treeitem").filter({ hasText: "Parent page" }).getByRole("button", { name: "Add a page inside" }).click();
  await page.waitForURL((u) => !u.pathname.includes(parentId));
  await page.getByLabel("Page title").fill("Child page");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Parent page");

  await page.goto(parentUrl);
  await page.getByRole("button", { name: "Page options" }).click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await expect(page.getByText(/Moved “Parent page” and 1 subpage to trash/)).toBeVisible();
  await page.goto("/trash");
  await expect(page.getByText("Parent page")).toBeVisible();
  await page.getByRole("button", { name: "Restore Parent page" }).click();
  await expect(page.getByText(/Restored/).first()).toBeVisible();
  await page.goto("/home");
  await expect(page.getByRole("tree", { name: "Pages" })).toContainText("Parent page");
});

test("databases: add rows and filter", async ({ page }) => {
  await page.goto("/templates");
  await page.getByRole("button", { name: "Add to my pages" }).first().click();
  await page.waitForURL(/\/p\//);
  await page.getByRole("tab", { name: /All videos/ }).click();
  await expect(page.getByRole("row")).toHaveCount(3);
  await page.getByRole("button", { name: "New row" }).click();
  await expect(page.getByRole("row")).toHaveCount(4);
  await page.getByRole("button", { name: "Search this database" }).click();
  await page.getByLabel("Search rows").fill("Trailer");
  await expect(page.getByText(/Showing 1 of 3 rows/)).toBeVisible();
});

test("preferences persist", async ({ page }) => {
  await page.goto("/home?settings=preferences");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.getByRole("radio", { name: "Light" }).click();
});

test("MCP: tokens authenticate and tools match the UI", async ({ page, request }) => {
  await page.goto("/home?settings=connections");
  await page.getByLabel("Token name").fill("E2E");
  await page.getByRole("button", { name: "Create token" }).click();
  const secret = await page.locator("code").filter({ hasText: /^max_/ }).innerText();
  const headers = { Authorization: `Bearer ${secret}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  const list = await request.post("/mcp", { headers, data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  const tools = (await list.json()).result.tools.map((t: { name: string }) => t.name);
  expect(tools).toEqual(expect.arrayContaining(["pages_create", "documents_get", "databases_query", "records_update", "templates_apply", "batch"]));
  expect(tools).not.toContain("tokens_create");
  const created = await request.post("/mcp", { headers, data: { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pages_create", arguments: { title: "From an assistant" } } } });
  expect((await created.json()).result.isError).toBeFalsy();
  await page.goto("/home");
  await expect(page.getByRole("tree", { name: "Pages" })).toContainText("From an assistant");
  const denied = await request.post("/mcp", { headers: { "Content-Type": "application/json" }, data: { jsonrpc: "2.0", id: 3, method: "tools/list" } });
  expect(denied.status()).toBe(401);
});
