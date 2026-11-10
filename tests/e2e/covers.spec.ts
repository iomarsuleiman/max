import { expect, test } from "@playwright/test";

test("cover crops persist, cancel restores the crop, images download, and gallery uses artwork", async ({ page, request }) => {
  const created = await request.post("/api/local/ops", { data: { op: "pages.create", kind: "mutation", args: { title: "Cover tools" } } });
  const {
    result: { page: createdPage },
  } = await created.json();
  const updated = await request.post("/api/local/ops", {
    data: { op: "pages.update", kind: "mutation", args: { id: createdPage._id, cover: "cover:met-435857" } },
  });
  expect(updated.ok()).toBeTruthy();
  await page.goto(`/p/${createdPage._id}`);
  // Built-in covers are served resized through Next's image optimizer.
  const image = page.locator('img[src*="met-435857"]');
  await expect(image).toBeVisible();
  await page.getByRole("button", { name: "Reposition", exact: true }).click();
  await page.getByRole("slider", { name: "Cover position" }).press("End");
  await expect(image).toHaveCSS("object-position", "50% 100%");
  await page.getByRole("button", { name: "Save position" }).click();
  await expect(page.getByRole("slider", { name: "Cover position" })).toBeHidden();
  await page.reload();
  await expect(image).toHaveCSS("object-position", "50% 100%");
  await page.getByRole("button", { name: "Reposition", exact: true }).click();
  await page.getByRole("slider", { name: "Cover position" }).press("Home");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(image).toHaveCSS("object-position", "50% 100%");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download cover" }).click();
  expect((await downloaded).suggestedFilename()).toBe("Cover tools.jpg");
  await page.getByRole("button", { name: "Change cover" }).click();
  await expect(page.getByRole("heading", { name: "Colors", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gradients", exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: /^Japanese prints:/ })
    .first()
    .click();
  await expect(page.locator('img[src*="japanese-prints-"]').first()).toHaveCSS("object-position", "50% 50%");
});
