import { test, expect } from "@playwright/test";

const readLab = (page) => page.evaluate(() => window.__maxLab?.read());
const getIds = (blocks) => {
  const ids = [];
  const visit = (items) => {
    for (const block of items) {
      ids.push(block.id);
      visit(block.children ?? []);
    }
  };
  visit(blocks);
  return ids;
};
const seed = async (page) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push("console: " + message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) browserErrors.push("http: " + response.status() + " " + response.url());
  });
  const response = await page.goto("/");
  try {
    await expect.poll(() => page.evaluate(() => window.__maxLab?.ready), { timeout: 12000 }).toBe(true);
  } catch (cause) {
    const pageState = await page.evaluate(() => ({
      url: location.href,
      title: document.title,
      hasLab: Boolean(window.__maxLab),
      body: (document.body?.innerText ?? "").slice(0, 250),
    })).catch(() => null);
    throw new Error("Isolated Max browser lab did not initialize: " +
      JSON.stringify({ response: response?.status(), pageState, browserErrors: browserErrors.slice(0, 12) }), { cause });
  }
  await page.evaluate(() => window.__maxLab.seed());
  await expect.poll(async () => (await readLab(page)).marked?.[1]?.id, { timeout: 35000 }).toBe("gold-callout");
};

test("two real Max custom-schema BlockNote editors mount and preserve custom identifiers through Yjs", async ({ page }) => {
  await seed(page);
  const snapshot = await readLab(page);
  expect(snapshot.marked[0]?.props?.tone).toBe("tip");
  expect(snapshot.marked[1]?.props?.tone).toBe("tip");
  for (const blocks of [snapshot.alice, snapshot.bob]) {
    const ids = getIds(blocks);
    expect(ids).toContain("gold-callout");
    expect(ids).toContain("gold-page-link");
    expect(ids).toContain("gold-bookmark");
    expect(ids.length).toBe(new Set(ids).size);
    expect(JSON.stringify(blocks)).toContain("مرحبا Max custom schema");
  }
  expect(snapshot.connected).toBe(true);
});

test("two mounted editors retain divergent offline edits and converge after explicit in-memory reconnect", async ({ page }) => {
  await seed(page);
  await page.evaluate(() => {
    window.__maxLab.disconnect();
    window.__maxLab.divergentEdits();
  });
  let snapshot = await readLab(page);
  expect(getIds(snapshot.alice)).toContain("offline-alice");
  expect(getIds(snapshot.bob)).toContain("offline-bob");
  expect(getIds(snapshot.alice)).not.toContain("offline-bob");
  expect(getIds(snapshot.bob)).not.toContain("offline-alice");
  await page.evaluate(() => window.__maxLab.reconnect());
  await expect.poll(async () => {
    const state = await readLab(page);
    const left = getIds(state.alice);
    const right = getIds(state.bob);
    return left.includes("offline-alice") && left.includes("offline-bob") &&
      right.includes("offline-alice") && right.includes("offline-bob");
  }, { timeout: 35000 }).toBe(true);
  snapshot = await readLab(page);
  expect(JSON.stringify(snapshot.alice)).toContain("تحرير Alice بالعربية");
  expect(JSON.stringify(snapshot.bob)).toContain("Offline Bob English");
  expect(snapshot.alice).toEqual(snapshot.bob);
});

test("a synthetic Yjs snapshot reconstructs the same Max collaborative XML fragment", async ({ page }) => {
  await seed(page);
  const result = await page.evaluate(() => window.__maxLab.replayOfflineSnapshot());
  expect(result.equal).toBe(true);
  expect(result.bytes).toBeGreaterThan(0);
  expect((await readLab(page)).yjsRestored).toBe(true);
});
