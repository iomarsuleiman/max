import { expect, test } from "@playwright/test";

test("create a personal workspace, keep its pages separate, and switch back", async ({ page }) => {
  const name = `Side ${Date.now().toString(36)}`;
  await page.goto("/home");
  await page.getByRole("button", { name: /workspace menu$/ }).click();
  await page.getByRole("menuitem", { name: "New workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create workspace" }).click();

  // The new workspace opens empty, with its name in the sidebar.
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText(name);
  const sidebar = page.getByRole("complementary", { name: "Sidebar" });
  await expect(sidebar.getByText("Welcome to Max")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const created = await page.evaluate(async () => {
    const ws = localStorage.getItem("max:workspace");
    const res = await fetch("/api/local/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "pages.create", kind: "mutation", args: { title: "Only in the side workspace" }, ws }) });
    return (await res.json()).result.page._id as string;
  });
  expect(created).toBeTruthy();
  await page.reload();
  await expect(sidebar.getByText("Only in the side workspace")).toBeVisible();

  // Back to the main workspace: the side page isn't there.
  await page.getByRole("button", { name: /workspace menu$/ }).click();
  await page.getByRole("menuitem", { name: "Personal" }).click();
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText("Personal");
  await expect(sidebar.getByText("Only in the side workspace")).toHaveCount(0);

  // Settings → Workspace lists both, and the side one can be deleted from inside it.
  await page.getByRole("button", { name: /workspace menu$/ }).click();
  await page.getByRole("menuitem", { name }).click();
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText(name);
  await page.goto("/home?settings=workspace");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { name: "Workspace", exact: true })).toBeVisible();
  await settings.getByRole("button", { name: "Delete", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: `Delete ${name}?` });
  await confirm.getByRole("textbox").fill(name);
  await confirm.getByRole("button", { name: "Delete workspace" }).click();
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText("Personal");
});
