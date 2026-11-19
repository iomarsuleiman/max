import { expect, test, type Browser } from "@playwright/test";

async function person(browser: Browser, baseURL: string, name: string) {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "max-dev-user", value: name, url: baseURL }]);
  return ctx;
}

test("admin: see users, suspend with a reason they see, reports, ban and restore", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  // Erin uses Max for a bit.
  const erin = await person(browser, baseURL!, "erin");
  const e = await erin.newPage();
  await e.goto("/home");
  await e.waitForURL(/\/p\//);
  await erin.request.post("/api/local/ops", { data: { op: "settings.update", kind: "mutation", args: { displayName: "Erin" } } });

  // The person running this Max (the admin) opens the dashboard from the sidebar.
  await page.goto("/home");
  await page.waitForURL(/\/p\//);
  await page.getByRole("link", { name: "Admin" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: /Users/ }).click();
  const row = page.getByRole("table", { name: "Users" }).getByRole("row").filter({ hasText: "Erin" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Suspend" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Too many spam pages, please tidy up.");
  await page.getByRole("dialog").getByRole("button", { name: "Suspend" }).click();
  await expect(row.getByText("Suspended")).toBeVisible();

  // Erin sees why, and can read but not change anything.
  await e.reload();
  await expect(e.getByRole("alert").filter({ hasText: "Your account is suspended" })).toContainText("Too many spam pages, please tidy up.");
  const blocked = await erin.request.post("/api/local/ops", { data: { op: "pages.create", kind: "mutation", args: { title: "x" } } });
  expect(blocked.status()).toBe(403);

  // Erin reports a problem; it lands in the admin's inbox.
  await e.goto("/home?settings=about");
  await e.getByRole("button", { name: "Report", exact: true }).click();
  await e.getByRole("dialog", { name: "Report a problem" }).getByRole("textbox").fill("I was suspended by mistake.");
  await e.getByRole("dialog", { name: "Report a problem" }).getByRole("button", { name: "Send report" }).click();
  await expect(e.getByText("Thanks. We'll look into it.")).toBeVisible();
  await page.reload();
  await page.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: /Reports/ }).click();
  const report = page.getByRole("list", { name: "Reports" }).getByRole("listitem").filter({ hasText: "I was suspended by mistake." });
  await expect(report).toBeVisible();
  await report.getByRole("button", { name: "Resolve" }).click();
  await expect(report).toHaveCount(0);

  // Banned: Erin sees the reason instead of her workspace. Then restored.
  await page.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: /Users/ }).click();
  await row.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
  await row.getByRole("button", { name: "Ban" }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("Spam after a warning.");
  await page.getByRole("dialog").getByRole("button", { name: "Ban" }).click();
  await e.goto("/home");
  await expect(e.getByRole("heading", { name: "This account has been banned" })).toBeVisible();
  await expect(e.getByRole("alert").filter({ hasText: "This account has been banned" })).toContainText("Spam after a warning.");
  await row.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Restore" }).click();
  await e.goto("/home");
  await expect(e.getByRole("heading", { name: "This account has been banned" })).toHaveCount(0);

  // Not everyone gets in.
  const f = await (await person(browser, baseURL!, "frank")).newPage();
  await f.goto("/admin");
  await expect(f.getByText("This page is for Max's admins")).toBeVisible();
  await erin.close();
});
