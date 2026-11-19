import { expect, test } from "@playwright/test";
import { PNG } from "pngjs";

test("the membership card lives in About: number, note on the back, artwork as it came, download", async ({ page }) => {
  await page.goto("/home?settings=account");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  // Your name is set in My account and carried to the card.
  await settings.getByLabel("Name", { exact: true }).fill("عمر Omar");
  await settings.getByLabel("Name", { exact: true }).press("Enter");
  await expect(page.getByText("Name saved", { exact: true })).toBeVisible();

  await page.goto("/home?settings=about");
  const preview = settings.getByRole("article", { name: "Your profile card preview" });
  await expect(preview).toBeVisible();
  await expect(preview).toContainText("عمر Omar");
  await expect(preview).toContainText(/NO\. \d{6}/);
  await expect(settings.getByText(/^No\. \d/)).toBeVisible();
  // No hints or labels around the card: it explains itself.
  await expect(settings.getByText(/Hover the card|Read the note/)).toHaveCount(0);

  // Hovering turns it over to the handwritten note (no QR, no invitation text).
  await preview.hover();
  await expect(preview.getByRole("button", { name: "Show the front of the card" })).toHaveAttribute("aria-pressed", "true");
  await expect(preview).toContainText("thank you for joining");
  await expect(preview).toContainText("The Max team");
  await page.mouse.move(5, 5);
  await expect(preview.getByRole("button", { name: "Show the back of the card" })).toBeVisible();
  await expect(settings.getByRole("button", { name: "Enable phone tilt" })).toHaveCount(0);

  // The artwork is what you get: no reshuffling, and it stays the same after a reload.
  await expect(settings.getByRole("button", { name: "Change artwork" })).toHaveCount(0);
  const art = () => preview.locator("svg").first().evaluate((svg) => Array.from(svg.querySelectorAll("path, stop, circle")).map((e) => [e.getAttribute("d"), e.getAttribute("stop-color"), e.getAttribute("r")]));
  const before = await art();
  await page.reload();
  await expect(preview).toContainText(/NO\. \d{6}/);
  await expect.poll(art).toEqual(before);

  // Your note for people you invite, and the invite link.
  await settings.getByLabel("Your note for people you invite").fill("{name},\nso glad you're here.");
  await settings.getByLabel("Your note for people you invite").blur();
  await expect(page.getByText("Note saved", { exact: true })).toBeVisible();
  await expect(settings.getByText(/\/join\?from=\d+/)).toBeVisible();

  const download = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Download PNG", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("max-workspace-card.png");
  const { readFile } = await import("node:fs/promises");
  const png = PNG.sync.read(await readFile((await file.path())!));
  // Both sides, side by side.
  expect(png.width).toBeGreaterThan(png.height * 1.5);
  await file.saveAs("test-results/max-workspace-card.png");
});

test("the invite page remembers who sent you", async ({ page }) => {
  await page.goto("/join?from=42");
  await expect(page.getByText("You're invited")).toBeVisible();
  await expect(page.getByText("#42")).toBeVisible();
  await expect(page.getByRole("link", { name: "Join Max" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("max:invited-by"))).toBe("42");
});
