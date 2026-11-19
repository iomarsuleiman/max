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
  // Carrying it slowly moves it without turning it.
  {
    const b0 = (await logo.boundingBox())!;
    await page.waitForTimeout(1100);
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(b0.x + b0.width / 2 + i * 10, b0.y + b0.height / 2, { steps: 1 });
      expect(await mover.evaluate((el) => el.style.transform)).toMatch(/rotate\(0deg\)$/);
    }
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => mover.evaluate((el) => el.style.transform), { timeout: 15_000 }).toBe("translate(0px, 0px) rotate(0deg)");
  }
  const box = (await logo.boundingBox())!;
  await page.waitForTimeout(1100);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2 + i * 30, box.y + box.height / 2 + i * 6, { steps: 1 });
  await page.mouse.up();
  await expect.poll(() => mover.evaluate((el) => el.style.transform)).toMatch(/translate\((?!0px, 0px)/);
  // A flick spins it.
  await expect.poll(() => mover.evaluate((el) => el.style.transform)).toMatch(/rotate\((?!0deg)/);
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

test("landing grain stays small and static, follows the chosen theme, with no navbar (other pages have a solid one)", async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem("max:theme")) localStorage.setItem("max:theme", "dark"); });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/welcome");
  // The landing has no navbar; the other public pages have a full-width, solid one.
  await expect(page.getByRole("navigation", { name: "Site" })).toHaveCount(0);
  await page.goto("/privacy");
  await expect(page.getByRole("navigation", { name: "Site" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Switch to .* mode/ })).toBeVisible();
  expect((await page.getByRole("banner").boundingBox())!.width).toBeGreaterThanOrEqual(page.viewportSize()!.width - 20);
  expect(await page.locator(".site-header").evaluate((e) => getComputedStyle(e).backdropFilter)).toBe("none");
  await page.goto("/welcome");
  const landing = page.locator(".landing-system");
  // A saved choice (dark) wins over the system (light), like every other page.
  await expect(landing).toHaveCSS("color-scheme", "dark");
  await page.evaluate(() => localStorage.setItem("max:theme", "light"));
  await page.reload();
  await expect(landing).toHaveCSS("color-scheme", "light");
  const paint = await landing.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      image: style.backgroundImage,
      animation: style.animationName,
      filter: style.filter,
      blend: style.backgroundBlendMode,
      logo: getComputedStyle(element.querySelector(".butterfly")!).color,
      text: getComputedStyle(element.querySelector("h1")!).color,
    };
  });
  expect(paint.image).toContain("/textures/grain.svg");
  expect(paint.animation).toBe("none");
  expect(paint.filter).toBe("none");
  expect(paint.blend).toBe("normal");
  expect(paint.logo).toBe(paint.text);
  // "Made for your mind": the current feature lights up and the drawn window points at it.
  await expect(page.getByRole("heading", { name: /Made for your mind/ })).toBeVisible();
  const connect = page.getByRole("button", { name: /Connect the dots/ });
  await connect.click();
  await expect(connect).toHaveAttribute("aria-current", "true");
  await expect(page.locator(".mind-callout-pill")).toHaveText("Graph view");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const texture = await page.request.get("/textures/grain.svg");
  expect((await texture.body()).byteLength).toBeLessThan(2048);
  await page.screenshot({ path: "test-results/max-landing-light.png", fullPage: true });
  await page.evaluate(() => localStorage.setItem("max:theme", "dark"));
  await page.reload();
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
  await expect(page.getByRole("heading", { name: /Made for your mind/ })).toBeVisible();
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
