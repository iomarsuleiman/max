import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("create a personal workspace, keep its pages separate, and switch back", async ({ page, baseURL }) => {
  // Give each attempt its own account so organizations and failed retries cannot change
  // which workspace the first/second keyboard shortcuts select.
  await page.context().addCookies([{ name: "max-dev-user", value: `ws_${randomUUID().replaceAll("-", "")}`, url: baseURL! }]);
  const name = `Side ${Date.now().toString(36)}`;
  await page.goto("/home");
  await expect(page.getByLabel("Page title")).toBeVisible();
  await page.getByRole("button", { name: /workspace menu$/ }).click();
  await page.getByRole("menuitem", { name: "New workspace" }).click();
  const dialog = page.getByRole("dialog", { name: "New workspace" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("button", { name: "Create workspace" }).click();

  // The new workspace opens on its first, empty page, with its name in the sidebar.
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText(name);
  await expect(page).toHaveURL(/\/p\//);
  const firstPageId = new URL(page.url()).pathname.split("-").pop()!.split("/").pop()!;
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

  // Coming back to a workspace returns to the page you were on there.
  await page.getByRole("button", { name: /workspace menu$/ }).click();
  await page.getByRole("menuitem", { name: "Personal" }).click();
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText("Personal");
  await page.getByRole("button", { name: /workspace menu$/ }).click();
  await page.getByRole("menuitem", { name }).click();
  await expect(page).toHaveURL(new RegExp(`${firstPageId}$`));
  // The page itself loads in the new workspace (never "This page doesn't exist").
  await expect(page.getByLabel("Page title")).toBeVisible();
  await expect(page.getByText("This page doesn't exist")).toHaveCount(0);

  // Arc-style: the workspace icons at the foot of the sidebar switch between them.
  const dock = page.getByRole("tablist", { name: "Workspaces" });
  await expect(dock.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
  // A sideways two-finger swipe over the sidebar goes to the previous workspace (Personal).
  await sidebar.hover();
  // One gesture crosses the threshold even when CI delays delivery between commands.
  await page.mouse.wheel(-180, 0);
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText("Personal");
  await expect(dock.getByRole("tab", { name: "Personal" })).toHaveAttribute("aria-selected", "true");
  await dock.getByRole("tab", { name }).click();
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText(name);
  await expect(page).toHaveURL(new RegExp(`${firstPageId}$`));
  await expect(page.getByLabel("Page title")).toBeVisible();
  // Keyboard, like Arc: ⌃1 on a Mac (Alt+1 elsewhere) opens the first workspace, ⌃2 the second.
  const mac = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent));
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press(mac ? "Control+1" : "Alt+1");
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText("Personal");
  await expect(dock.getByRole("tab", { name: "Personal" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Page title")).toBeVisible();
  await page.keyboard.press(mac ? "Control+2" : "Alt+2");
  await expect(page.getByRole("button", { name: /workspace menu$/ })).toContainText(name);

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
