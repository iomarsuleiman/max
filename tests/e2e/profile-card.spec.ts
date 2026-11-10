import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";

test("profile card previews, saves and persists across reload", async ({ page }) => {
  await page.goto("/home?settings=account");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { name: "Welcome to Max." })).toBeVisible();
  await settings.getByLabel("Card name", { exact: true }).fill("عمر Omar");
  await settings.getByText("More about you", { exact: true }).click();
  await settings.getByLabel("About you", { exact: true }).fill("Collecting ideas in two languages.");
  await settings.getByLabel("Card subtitle", { exact: true }).fill("Curious explorer");
  const preview = settings.getByRole("article", { name: "Your profile card preview" });
  const before = await preview.innerHTML();
  await settings.getByRole("button", { name: "Shuffle design" }).click();
  expect(await preview.innerHTML()).not.toBe(before);
  const savedDesign = await preview
    .locator("svg")
    .first()
    .evaluate((svg) => Array.from(svg.querySelectorAll("path, stop")).map((element) => [element.getAttribute("d"), element.getAttribute("stop-color")]));
  await expect(preview).toContainText("عمر Omar");
  await expect(preview).toContainText("Collecting ideas in two languages.");
  await settings.getByRole("button", { name: "Save my card", exact: true }).click();
  await expect(page.getByText("Profile card saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(settings.getByLabel("Card name", { exact: true })).toHaveValue("عمر Omar");
  expect(
    await preview
      .locator("svg")
      .first()
      .evaluate((svg) => Array.from(svg.querySelectorAll("path, stop")).map((element) => [element.getAttribute("d"), element.getAttribute("stop-color")])),
  ).toEqual(savedDesign);
  await settings.getByLabel("Card name", { exact: true }).fill("");
  await expect(settings.getByRole("article", { name: "Your profile card preview" })).toBeVisible();
  await settings.getByLabel("Card name", { exact: true }).fill("Omar Suleiman");
  const download = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Download PNG", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("max-workspace-card.png");
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  expect((await readFile(path!)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const png = PNG.sync.read(await readFile(path!));
  const scanned = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  expect(scanned?.data).toBe("https://max.chaos.fail");
  await file.saveAs("test-results/max-workspace-card.png");
});
