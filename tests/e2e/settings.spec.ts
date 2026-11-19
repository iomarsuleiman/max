import { expect, test } from "@playwright/test";

const settingsOf = async (request: import("@playwright/test").APIRequestContext) => (await (await request.post("/api/local/ops", { data: { op: "settings.get", args: {} } })).json()).result.settings;

test("settings: search, accent color, date and time, and the space editor", async ({ page }) => {
  await page.goto("/home?settings=account");
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  const nav = settings.getByRole("navigation", { name: "Settings sections" });

  // Search matches what's inside sections, not only their names.
  await settings.getByLabel("Search settings").fill("export");
  await expect(nav.getByRole("button", { name: "Data & export" })).toBeVisible();
  await expect(nav.getByRole("button", { name: "Editor" })).toHaveCount(0);
  await settings.getByLabel("Search settings").fill("dark");
  await nav.getByRole("button", { name: "Preferences" }).click();
  await settings.getByLabel("Search settings").fill("");

  // Accent color recolors the app.
  await settings.getByRole("radiogroup", { name: "Accent color" }).getByRole("radio", { name: "Green" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "green");
  await expect.poll(async () => (await settingsOf(page.request)).accent).toBe("green");

  // Date & time.
  await settings.getByRole("combobox", { name: "Date format" }).click();
  await page.getByRole("option", { name: "2026-11-19" }).click();
  await settings.getByRole("radiogroup", { name: "Clock" }).getByRole("radio", { name: "24-hour" }).click();
  await settings.getByRole("radiogroup", { name: "First day of the week" }).getByRole("radio", { name: "Sunday" }).click();
  await expect.poll(async () => { const s = await settingsOf(page.request); return [s.dateFormat, s.timeFormat, s.weekStart]; }).toEqual(["iso", "24h", "sunday"]);

  // Window: floating card or edge to edge.
  await settings.getByRole("radiogroup", { name: "Window" }).getByRole("radio", { name: "Edge to edge" }).click();
  await expect(page.locator("main#main")).toHaveAttribute("data-frame", "full");

  // The space editor floats over the app (Settings closes), so you can see the change.
  await settings.getByRole("button", { name: "Edit space" }).click();
  await expect(settings).not.toBeVisible();
  const panel = page.getByRole("dialog", { name: "Edit your space" });
  await panel.getByRole("radio", { name: "Use dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await panel.getByRole("radio", { name: "Use light mode" }).click();
  // Dragging a color, adding one, a preset, grain and strength all save.
  const dot = panel.locator(".space-dot").first();
  await dot.scrollIntoViewIfNeeded();
  const box = (await dot.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 120, box.y + 60, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await settingsOf(page.request)).space?.colors?.length).toBe(2);
  await panel.getByRole("button", { name: "Add a color" }).click();
  await expect.poll(async () => (await settingsOf(page.request)).space?.colors?.length).toBe(3);
  const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tint-1"));
  await panel.getByRole("radiogroup", { name: "Preset colors" }).getByRole("radio", { name: "ocean" }).click();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--tint-1"))).not.toBe(before);
  await panel.getByRole("slider", { name: "Color strength" }).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await settingsOf(page.request)).space?.intensity).toBe(33);
  await panel.getByRole("slider", { name: "Grain" }).fill("80");
  await panel.getByRole("slider", { name: "Grain" }).press("ArrowRight");
  await expect.poll(async () => (await settingsOf(page.request)).space?.grain).toBeGreaterThanOrEqual(80);
  await panel.getByRole("button", { name: "Done" }).click();
  await expect(panel).not.toBeVisible();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-accent", "green");
  await expect(page.locator("main#main")).toHaveAttribute("data-frame", "full");
});
