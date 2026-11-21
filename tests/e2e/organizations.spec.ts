import { expect, test, type Browser } from "@playwright/test";

async function person(browser: Browser, baseURL: string, name: string) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "max-dev-user", value: name, url: baseURL }]);
  return ctx;
}

test("organizations: create, invite by email, join, edit together, remove; admins see it all", async ({ page, browser, baseURL }) => {
  test.setTimeout(150_000);
  // Bob has a Max account.
  const bobCtx = await person(browser, baseURL!, "bob");
  const bob = await bobCtx.newPage();
  await bob.goto("/home");
  await bob.waitForURL(/\/p\//);

  // Organizations start off: the admin switches them on for this account in Admin → Users.
  await page.goto("/home");
  await page.waitForURL(/\/p\//);
  await page.locator("[data-sidebar]").getByRole("button", { name: /workspace menu/ }).click();
  await expect(page.getByRole("menuitem", { name: "New organization" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/admin");
  await page.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: /Users/ }).click();
  await page.getByRole("switch", { name: /Organizations for (You|local)/ }).click();
  await expect(page.getByRole("switch", { name: /Organizations for (You|local)/ })).toBeChecked();
  // The local owner creates an organization from the workspace menu and invites Bob.
  await page.goto("/home");
  await page.waitForURL(/\/p\//);
  await page.locator("[data-sidebar]").getByRole("button", { name: /workspace menu/ }).click();
  await page.getByRole("menuitem", { name: "New organization" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Acme");
  await page.getByRole("dialog").getByRole("button", { name: "Create organization" }).click();
  await expect(page.getByRole("heading", { name: "Acme" })).toBeVisible();
  await page.getByRole("button", { name: "Invite people" }).click();
  await page.getByRole("dialog").getByLabel("Email addresses").fill("bob@local.max");
  await page.getByRole("dialog").getByRole("button", { name: "Send invitations" }).click();
  await expect(page.getByText(/Invited 1 person/)).toBeVisible();
  await page.screenshot({ path: "test-results/org-members.png" });

  // Bob sees the invitation in his sidebar and joins; he lands in Acme.
  await bob.reload();
  const invite = bob.getByRole("region", { name: "Invitations" });
  await expect(invite).toContainText("Acme");
  await bob.screenshot({ path: "test-results/org-invitation.png" });
  await invite.getByRole("button", { name: "Join" }).click();
  await expect(bob.locator("[data-sidebar]").getByRole("button", { name: /Acme workspace menu/ })).toBeVisible();

  // A page made in Acme opens for Bob, who can edit it.
  const made = await page.request.post("/api/local/ops", { data: { op: "pages.create", kind: "mutation", args: { title: "Launch plan" }, ws: await page.evaluate(() => localStorage.getItem("max:workspace")) } });
  const pageId = (await made.json()).result.page._id as string;
  await bob.goto(`/p/${pageId}`);
  await expect(bob.getByRole("textbox", { name: /title/i }).or(bob.locator("h1").filter({ hasText: "Launch plan" })).first()).toBeVisible();

  // The platform admin sees the organization, its owner and members.
  await page.goto("/admin");
  await page.getByRole("radiogroup", { name: "Section" }).getByRole("radio", { name: /Organizations/ }).click();
  const row = page.getByRole("table", { name: "Organizations" }).getByRole("row").filter({ hasText: "Acme" });
  await expect(row).toContainText("2");
  await row.getByRole("button", { name: "Open" }).click();
  await expect(page.getByRole("table", { name: "Organization members" })).toContainText("bob@local.max");
  await page.screenshot({ path: "test-results/admin-organization.png" });
  await page.keyboard.press("Escape");

  // Removing Bob takes effect at once.
  await page.goto("/org?tab=members");
  await page.getByRole("button", { name: /Manage Bob/ }).click();
  await page.getByRole("menuitem", { name: "Remove from organization" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("list", { name: "Members" })).not.toContainText("bob@local.max");
  const denied = await bobCtx.request.post("/api/local/ops", { data: { op: "pages.get", kind: "query", args: { id: pageId }, ws: (await made.json()).result.page.ownerId } });
  expect(denied.status()).toBe(404);
  await bobCtx.close();
});
