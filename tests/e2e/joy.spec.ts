import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("landing butterfly flaps its wings on arrival, click and keyboard, and stays still with reduced motion", async ({ page }) => {
  await page.goto("/welcome");
  const logo = page.getByRole("button", { name: "Flap the Max butterfly's wings" });
  await expect(logo).toBeVisible();
  const body = logo.locator(".butterfly-body");
  // Flaps once on arrival, then settles.
  await expect(body).toHaveAttribute("data-flapping", "");
  const wing = logo.locator(".butterfly-wing--left");
  await expect.poll(() => wing.evaluate((el) => getComputedStyle(el).animationName)).toBe("butterfly-wing-left");
  await page.waitForTimeout(1100);
  await logo.click();
  await expect(body).toHaveAttribute("data-flapping", "");
  await page.waitForTimeout(1100);
  await logo.focus();
  await page.keyboard.press("Enter");
  await expect(body).toHaveAttribute("data-flapping", "");
  await page.waitForTimeout(1100);
  // Grab it, carry it away and fling it: it spins, then floats home upright.
  const mover = body.locator("..");
  const box = (await logo.boundingBox())!;
  await page.waitForTimeout(1100);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 30, box.y + box.height / 2 + i * 6, { steps: 1 });
  await page.mouse.up();
  await expect.poll(() => mover.evaluate((el) => el.style.transform)).toMatch(/translate\((?!0px, 0px)/);
  await expect.poll(() => mover.evaluate((el) => el.style.transform), { timeout: 15_000 }).toBe("translate(0px, 0px) rotate(0deg)");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(60);
  await logo.click();
  await expect(logo).toHaveAttribute("data-still", "true");
  await expect.poll(() => wing.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(results.violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: "test-results/max-landing.png", fullPage: true });
});

test("landing texture stays small and static, with system colors and no navigation or theme toggle", async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem("max:theme")) localStorage.setItem("max:theme", "dark"); });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/welcome");
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.getByRole("banner")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Switch to .* mode/ })).toHaveCount(0);
  const landing = page.locator(".landing-system");
  await expect(landing).toHaveCSS("color-scheme", "light");
  const paint = await landing.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      image: style.backgroundImage,
      animation: style.animationName,
      filter: style.filter,
      blend: style.backgroundBlendMode,
      logo: getComputedStyle(element.querySelector("button")!).color,
      text: getComputedStyle(element.querySelector("h1")!).color,
    };
  });
  expect(paint.image).toContain("/textures/grain.svg");
  expect(paint.animation).toBe("none");
  expect(paint.filter).toBe("none");
  expect(paint.blend).toBe("normal");
  expect(paint.logo).toBe(paint.text);
  const explore = page.getByRole("tablist", { name: "Explore Max" });
  await explore
    .getByRole("tab")
    .first()
    .evaluate((element) => element.scrollIntoView({ block: "start" }));
  await expect(page.getByRole("tabpanel")).toHaveCSS("position", "sticky");
  const pinnedTop = (await page.getByRole("tabpanel").boundingBox())!.y;
  await page.evaluate(() => window.scrollBy(0, 80));
  await expect.poll(async () => (await page.getByRole("tabpanel").boundingBox())!.y).toBeCloseTo(pinnedTop, 0);
  await explore.getByRole("tab").first().click();
  const shot = page.getByRole("tabpanel").getByRole("img");
  await expect(shot).toHaveAttribute("src", "/screenshots/editor-light.webp");
  await expect.poll(() => shot.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1280);
  await explore.getByRole("tab").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(explore.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(shot).toHaveAttribute("src", "/screenshots/graph-light.webp");
  await explore.getByRole("tab").nth(2).click();
  await expect(shot).toHaveAttribute("src", "/screenshots/card-light.webp");
  await explore.getByRole("tab").nth(3).click();
  await expect(shot).toHaveAttribute("src", "/screenshots/sidebar-light.webp");
  // The screenshot is shown whole, never cut off at the edge of the window.
  expect((await shot.boundingBox())!.x + (await shot.boundingBox())!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await explore.getByRole("tab").first().click();
  const texture = await page.request.get("/textures/grain.svg");
  expect((await texture.body()).byteLength).toBeLessThan(2048);
  await page.screenshot({ path: "test-results/max-landing-light.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(landing).toHaveCSS("color-scheme", "dark");
  await expect(landing).toHaveCSS("background-image", /grain-dark\.svg/);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: "test-results/max-landing-dark.png", fullPage: true });
  await page.goto("/connect/status?reason=invalid_target");
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.reload();
  await expect(page.locator("html")).toHaveClass(/light/);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations.map((violation) => violation.id)).toEqual([]);
  await page.screenshot({ path: "test-results/max-recovery-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  await expect(page.getByRole("tabpanel")).toHaveCSS("position", "static");
  await page.getByRole("tablist", { name: "Explore Max" }).getByRole("tab").nth(1).click();
  await expect(page.getByRole("tabpanel").getByRole("img")).toHaveAttribute("src", "/screenshots/graph-light.webp");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/max-landing-mobile.png", fullPage: true });
});

test("offline fallback and optional Paper hop work without caching private pages", async ({ page, context }) => {
  await page.addInitScript(() => { if (!localStorage.getItem("max:theme")) localStorage.setItem("max:theme", "dark"); });
  await page.goto("/welcome");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const cached = await page.evaluate(async () => {
    const cache = await caches.open("max-offline-v3");
    return (await cache.keys()).map((request) => new URL(request.url).pathname).sort();
  });
  expect(cached).toEqual(["/offline-game.js", "/offline.html"]);
  await context.setOffline(true);
  await page.goto("/a-page-never-visited-before");
  await expect(page.getByRole("heading", { name: /A little pause/ })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Switch color theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Sound off" }).click();
  await expect(page.getByRole("button", { name: "Sound on" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Start playing" }).click();
  await expect(page.getByRole("button", { name: "Pause game" })).toBeVisible();
  await page.getByRole("img", { name: /Paper hop playfield/ }).press("Space");
  await page.getByRole("button", { name: "Pause game" }).click();
  await expect(page.getByRole("button", { name: "Resume playing" })).toBeVisible();
  await context.setOffline(false);
});
