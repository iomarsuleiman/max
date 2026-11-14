import { expect, test } from "@playwright/test";

test("search dismissal returns keyboard focus to the editor and navigation commands focus their destination", async ({ page, request }) => {
  await request.post("/api/local/ops", { data: { op: "account.init", args: {} } });
  await request.post("/api/local/ops", { data: { op: "settings.update", args: { profileCardOnboarded: true } } });
  await page.goto("/home");
  const editor = page.locator(".bn-editor[contenteditable=true]");
  await editor.waitFor();
  await editor.focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search", exact: true })).toHaveCount(0);
  await expect(editor).toBeFocused();
  await page.keyboard.insertText("Focus returned to writing");
  await expect(editor).toContainText("Focus returned to writing");

  await page.keyboard.press("Control+k");
  await page.getByRole("combobox").fill("Open settings");
  await page.getByRole("option").filter({ hasText: "Open settings" }).click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect.poll(() => settings.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
});
