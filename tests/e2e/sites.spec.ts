import { expect, test } from "@playwright/test";

test("publish a page as a website and browse it as a visitor", async ({ page, browser }) => {
  const ops = async (op: string, kind: "query" | "mutation", args: Record<string, unknown>) => (await (await page.request.post("/api/local/ops", { data: { op, kind, args } })).json()).result;
  const home = (await ops("pages.create", "mutation", { title: "Field guide", icon: "🧭" })).page as { _id: string };
  const birds = (await ops("pages.create", "mutation", { title: "Birds", parentId: home._id, markdown: "Robins sing at dawn." })).page as { _id: string };
  await ops("pages.create", "mutation", { title: "Trees", parentId: home._id, markdown: "Oaks live for centuries." });
  await ops("pages.create", "mutation", { title: "Private plans" });

  await page.goto(`/p/${home._id}`);
  // Publishing lives in Share → Publish, like Notion.
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await page.getByRole("tab", { name: "Publish" }).click();
  const dialog = page.getByRole("form", { name: "Publish as a site" });
  await dialog.getByLabel("Address").fill("field-guide");
  await dialog.getByRole("button", { name: "Publish site" }).click();
  await expect(page.getByText("Your site is live")).toBeVisible();

  // A visitor without an account: navigation, content, search, previous/next.
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto("/site/field-guide");
  const nav = v.getByRole("navigation", { name: "Field guide pages" });
  await expect(nav.getByRole("link", { name: "Birds" })).toBeVisible();
  await expect(nav.getByText("Private plans")).toHaveCount(0);
  await nav.getByRole("link", { name: "Birds" }).click();
  await expect(v).toHaveURL(new RegExp(`/site/field-guide/birds-${birds._id}`));
  await expect(v.locator(".bn-editor")).toContainText("Robins sing at dawn.");
  await expect(v.locator(".bn-editor")).toHaveAttribute("contenteditable", "false");
  await v.getByRole("link", { name: /Next/ }).click();
  await expect(v.locator(".bn-editor")).toContainText("Oaks live for centuries.");
  await v.getByRole("button", { name: "Search this site" }).click();
  await v.getByRole("dialog", { name: "Search this site" }).getByLabel("Search this site").fill("robins");
  await v.getByRole("dialog", { name: "Search this site" }).getByRole("button", { name: /Birds/ }).click();
  await expect(v.locator(".bn-editor")).toContainText("Robins sing at dawn.");
  // Unknown sites say so.
  await v.goto("/site/nope-not-here");
  await expect(v.getByText("This site isn't published")).toBeVisible();
  await visitor.close();
});
