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
  // No hints around the card, just who welcomed you, and Download / Share.
  await expect(settings.getByText(/Hover the card|Read the note/)).toHaveCount(0);
  await expect(settings.locator(".card-about-from")).toHaveText("with a note from The Max team");
  await expect(settings.getByRole("button", { name: "Share", exact: true })).toBeVisible();

  // Hovering lets you see through to the note (the card doesn't turn); clicking flips it over.
  await preview.hover();
  await expect(preview).toHaveAttribute("data-active", "true");
  await expect(preview.getByRole("button", { name: "Show the back of the card" })).toHaveAttribute("aria-pressed", "false");
  await expect(preview).toContainText("thank you for joining");
  await expect(preview).toContainText("The Max team");
  // The back carries a QR code for your invite link.
  await expect(preview.locator(".profile-card-back svg text", { hasText: "SCAN TO JOIN" })).toHaveCount(1);
  await preview.getByRole("button", { name: "Show the back of the card" }).click();
  await expect(preview.getByRole("button", { name: "Show the front of the card" })).toHaveAttribute("aria-pressed", "true");
  await preview.getByRole("button", { name: "Show the front of the card" }).click();
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
  // The invite link is just max.chaos.fail/<username>.
  const username = (await (await page.request.post("/api/local/ops", { data: { op: "account.username", args: {} } })).json()).result.username as string;
  expect(username).toMatch(/^[a-z0-9._]{3,20}$/);
  await expect(settings.locator("code").filter({ hasText: new RegExp(`/${username}$`) })).toBeVisible();

  const download = page.waitForEvent("download");
  await settings.getByRole("button", { name: "Download", exact: true }).click();
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
  await expect(page.getByRole("heading", { name: "You're invited." })).toBeVisible();
  await expect(page.getByText("INVITED BY MEMBER NO. 000042")).toBeVisible();
  await expect(page.getByRole("link", { name: "Join Max" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("max:invited-by"))).toBe("42");
});

test("max.chaos.fail/<username> is that person's invitation, with their card and a preview image", async ({ page, request }) => {
  const op = async (name: string, args: Record<string, unknown> = {}) => (await (await request.post("/api/local/ops", { data: { op: name, args } })).json()).result;
  await op("account.init", { displayName: "Omar Suleiman" });
  await op("settings.update", { displayName: "Omar Suleiman" });
  const username = `omar${Date.now().toString(36).slice(-5)}`;
  await op("account.setUsername", { username });
  await page.goto(`/${username}`);
  await expect(page.getByRole("heading", { name: "Omar Suleiman invited you." })).toBeVisible();
  await expect(page.locator(".invite-card svg")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("max:invited-by"))).toMatch(/^\d+$/);
  // Link previews say who's inviting.
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Omar Suleiman invited you to Max");
  const image = await page.locator('meta[property="og:image"]').getAttribute("content");
  expect(image).toContain(`/api/og?u=${username}`);
  const png = await request.get(new URL(image!).pathname + new URL(image!).search);
  expect(png.headers()["content-type"]).toBe("image/png");
  expect((await png.body()).length).toBeGreaterThan(5000);
  // Unknown usernames are a plain 404.
  expect((await page.goto("/nobody-here-123"))!.status()).toBe(404);
});

test("a shared link previews as the page, with who shared it", async ({ page, request }) => {
  const op = async (name: string, args: Record<string, unknown> = {}) => (await (await request.post("/api/local/ops", { data: { op: name, args } })).json()).result;
  const created = (await op("pages.create", { title: "Lisbon trip", icon: "✈️" })).page as { _id: string };
  const { link } = (await op("shares.setLink", { pageId: created._id, level: "view" })) as { link: { token: string } };
  const html = await (await request.get(`/p/lisbon-trip-${created._id}?share=${link.token}`)).text();
  expect(html).toMatch(/<meta property="og:title" content="Lisbon trip"/);
  expect(html).toContain(`/api/og?t=${link.token}`);
  const png = await request.get(`/api/og?t=${link.token}&p=${created._id}`);
  expect(png.headers()["content-type"]).toBe("image/png");
});
