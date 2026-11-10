import { expect, test } from "@playwright/test";

test("touch gestures spin around the logo in both directions, pull the center and stop cleanly", async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/welcome");
  const logo = page.getByRole("button", { name: "Spin the Max butterfly" });
  await expect(logo).toBeVisible();
  const box = (await logo.boundingBox())!;
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const mark = logo.locator("span");
  const client = await context.newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const resting = /translate\(0px, 0px\) scale\(1\) rotate\(0deg\)/;
  for (const direction of [1, -1]) {
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: center.x, y: center.y - 65 }] });
    for (let i = 1; i <= 8; i++) {
      const angle = -Math.PI / 2 + (direction * i * Math.PI) / 8;
      await client.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: center.x + Math.cos(angle) * 65, y: center.y + Math.sin(angle) * 65 }],
      });
      await page.waitForTimeout(12);
    }
    const beforeRelease = await mark.getAttribute("style");
    expect(beforeRelease).toMatch(direction > 0 ? /rotate\(1[0-9]{2}/ : /rotate\(-1[0-9]{2}/);
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => mark.getAttribute("style")).not.toBe(beforeRelease);
    await expect(mark).toHaveAttribute("style", resting, { timeout: 8500 });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [center] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: center.x + 45, y: center.y + 20 }] });
  await expect(mark).toHaveAttribute("style", /translate\(45px, 20px\)/);
  await client.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(mark).toHaveAttribute("style", resting, { timeout: 4000 });
  await logo.focus();
  await page.keyboard.press("ArrowRight");
  await expect(mark).not.toHaveAttribute("style", resting);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(mark).toHaveAttribute("style", resting);
  const still = await mark.getAttribute("style");
  await page.waitForTimeout(150);
  expect(await mark.getAttribute("style")).toBe(still);
});
