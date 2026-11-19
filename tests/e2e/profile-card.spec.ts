import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";

test("profile card previews, saves and persists across reload", async ({ page }) => {
  await page.goto("/home?settings=account");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings.getByRole("heading", { name: "Welcome to Max." })).toBeVisible();
  await settings.getByLabel("Name", { exact: true }).fill("عمر Omar");
  await expect(settings.getByLabel("Preferred name", { exact: true })).toHaveCount(0);
  await expect(settings.getByLabel("About you", { exact: true })).toHaveCount(0);
  await expect(settings.getByLabel("Card name", { exact: true })).toHaveCount(0);
  const preview = settings.getByRole("article", { name: "Your profile card preview" });
  await expect(preview).toContainText(/NO\. \d{6}/);
  const before = await preview.innerHTML();
  await settings.getByRole("button", { name: "Change" }).click();
  expect(await preview.innerHTML()).not.toBe(before);
  const savedDesign = await preview
    .locator("svg")
    .first()
    .evaluate((svg) => Array.from(svg.querySelectorAll("path, stop")).map((element) => [element.getAttribute("d"), element.getAttribute("stop-color")]));
  await expect(preview).toContainText("عمر Omar");
  await settings.getByRole("button", { name: "Save my card", exact: true }).click();
  await expect(page.getByText("Profile card saved", { exact: true })).toBeVisible();
  const stored = await page.request.post("/api/local/ops", { data: { op: "settings.get", args: {} } });
  const data = (await stored.json()).result.settings;
  expect(data.displayName).toBe("عمر Omar");
  expect(data.profileCard.createdAt).toBeGreaterThan(0);
  const issued = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(data.profileCard.createdAt);
  await expect(preview).toContainText(issued);
  await expect(preview).not.toContainText("YOUR WORKSPACE CARD");
  // The card flips to a handwritten member number and join date, with just the code.
  await expect(preview).toContainText(/NO\. \d{6}/);
  await preview.getByRole("button", { name: "Show the back of the card" }).click();
  await expect(preview.getByRole("button", { name: "Show the front of the card" })).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toContainText(/#\d+/);
  await expect(preview).not.toContainText("invited");
  await expect(settings.getByRole("button", { name: "Enable phone tilt" })).toHaveCount(0);
  await settings.getByRole("button", { name: "Show front" }).click();
  await page.reload();
  await expect(settings.getByLabel("Name", { exact: true })).toHaveValue("عمر Omar");
  await expect(preview).toContainText(/NO\. \d{6}/);
  expect(
    await preview
      .locator("svg")
      .first()
      .evaluate((svg) => Array.from(svg.querySelectorAll("path, stop")).map((element) => [element.getAttribute("d"), element.getAttribute("stop-color")])),
  ).toEqual(savedDesign);
  await settings.getByLabel("Name", { exact: true }).fill("");
  await expect(settings.getByRole("article", { name: "Your profile card preview" })).toBeVisible();
  await settings.getByLabel("Name", { exact: true }).fill("Omar Suleiman");
  const download = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Download PNG", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("max-workspace-card.png");
  const path = await file.path();
  const { readFile } = await import("node:fs/promises");
  expect((await readFile(path!)).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const png = PNG.sync.read(await readFile(path!));
  const scanned = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  // The QR is an invite to Max that names the member only by number.
  expect(scanned?.data).toMatch(/^https:\/\/max\.chaos\.fail\/join\?from=\d+$/);
  await file.saveAs("test-results/max-workspace-card.png");
});

test("the card's QR opens an invitation to Max", async ({ page }) => {
  await page.goto("/join?from=42");
  await expect(page.getByText("You're invited")).toBeVisible();
  await expect(page.getByText("#42")).toBeVisible();
  await expect(page.getByRole("link", { name: "Join Max" })).toBeVisible();
});
