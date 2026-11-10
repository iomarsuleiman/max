import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("landing butterfly responds to keyboard, drag and reduced motion", async ({ page }) => {
  await page.goto("/welcome");
  const logo = page.getByRole("button", { name: "Spin the Max butterfly" });
  await expect(logo).toBeVisible();
  await logo.focus();
  await page.keyboard.press("ArrowRight");
  await expect(logo.locator("span")).toHaveAttribute("style", /rotate\(30deg\)/);
  const box = await logo.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 10, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(logo.locator("span")).not.toHaveAttribute("style", /rotate\(30deg\)/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(60);
  const paused = await logo.locator("span").getAttribute("style");
  await page.waitForTimeout(100);
  expect(await logo.locator("span").getAttribute("style")).toBe(paused);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: "test-results/max-landing.png", fullPage: true });
});

test("offline fallback and optional Paper hop work without caching private pages", async ({ page, context }) => {
  await page.goto("/welcome");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => {
    const cache = await caches.open("max-offline-v1");
    return (await cache.keys()).map((request) => new URL(request.url).pathname).sort();
  });
  expect(cached).toEqual(["/offline-game.js", "/offline.html"]);
  await context.setOffline(true);
  await page.goto("/a-page-never-visited-before");
  await expect(page.getByRole("heading", { name: /A little pause/ })).toBeVisible();
  await page.getByRole("button", { name: "Start playing" }).click();
  await expect(page.getByRole("button", { name: "Pause game" })).toBeVisible();
  await page.getByRole("img", { name: /Paper hop playfield/ }).press("Space");
  await page.getByRole("button", { name: "Pause game" }).click();
  await expect(page.getByRole("button", { name: "Resume playing" })).toBeVisible();
  await context.setOffline(false);
});
