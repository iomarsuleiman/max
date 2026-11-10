import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("landing butterfly responds to keyboard, drag and reduced motion", async ({ page }) => {
  await page.goto("/welcome");
  const logo = page.getByRole("button", { name: "Spin the Max butterfly" });
  await expect(logo).toBeVisible();
  await logo.focus();
  await page.keyboard.press("ArrowRight");
  await expect(logo.locator("span")).not.toHaveAttribute("style", /rotate\(0deg\)/);
  await expect(logo.locator("span")).toHaveAttribute("style", /rotate\(0deg\)/, { timeout: 8500 });
  const box = await logo.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 10, box!.y + box!.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect(logo.locator("span")).not.toHaveAttribute("style", /rotate\(30deg\)/);
  await expect(logo.locator("span")).toHaveAttribute("style", /rotate\(0deg\)/, { timeout: 8500 });
  await logo.click();
  await expect(logo.locator("span")).not.toHaveAttribute("style", /rotate\(0deg\)/);
  await expect(logo.locator("span")).toHaveAttribute("style", /rotate\(0deg\)/, { timeout: 8500 });
  await logo.focus();
  await page.keyboard.press("ArrowLeft");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(60);
  const paused = await logo.locator("span").getAttribute("style");
  await page.waitForTimeout(100);
  expect(await logo.locator("span").getAttribute("style")).toBe(paused);
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
  expect(paint.image).toContain("/textures/paper.png");
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
  await expect(page.getByRole("tabpanel")).toContainText("From Notion");
  await explore.getByRole("tab").first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(explore.getByRole("tab").nth(1)).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Preview sage card" }).click();
  await expect(page.getByRole("button", { name: "Preview sage card" })).toHaveAttribute("aria-pressed", "true");
  await explore.getByRole("tab").nth(2).click();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(page.getByLabel("Sample project board")).toBeVisible();
  await page.getByRole("button", { name: "Table", exact: true }).click();
  await expect(page.getByLabel("Sample project table")).toBeVisible();
  await explore.getByRole("tab").first().click();
  const texture = await page.request.get("/textures/paper.png");
  expect((await texture.body()).byteLength).toBeLessThan(2048);
  await page.screenshot({ path: "test-results/max-landing-light.png", fullPage: true });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(landing).toHaveCSS("color-scheme", "dark");
  await expect(landing).toHaveCSS("background-image", /paper-dark\.png/);
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
  await expect(page.getByLabel("Sample membership card")).toBeVisible();
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
