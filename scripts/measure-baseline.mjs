import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Uses an existing production build, never a developer's workspace data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.argv[2] ?? path.join(root, "test-results", "v2-baseline"));
const samples = Number(process.env.MAX_BASELINE_SAMPLES ?? 30);
assert(Number.isInteger(samples) && samples >= 5 && samples <= 200, "MAX_BASELINE_SAMPLES must be 5..200");
await readFile(path.join(root, ".next", "BUILD_ID"));
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(path.join(os.tmpdir(), "max-baseline-"));
const socket = createServer();
await new Promise((resolve, reject) => socket.once("error", reject).listen(0, "127.0.0.1", resolve));
const port = socket.address().port;
await new Promise((resolve) => socket.close(resolve));
const baseURL = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [path.join(root, "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", String(port)],
  {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, MAX_LOCAL_MODE: "true", MAX_DATA_DIR: dataDir, NEXT_PUBLIC_CONVEX_URL: "", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let serverLog = "";
server.stdout.on("data", (data) => {
  serverLog = (serverLog + data).slice(-12_000);
});
server.stderr.on("data", (data) => {
  serverLog = (serverLog + data).slice(-12_000);
});
let browser;
const report = {
  measuredAt: new Date().toISOString(),
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    mode: "isolated local production build",
    baseURL,
    dataDir,
    samples,
  },
  limitations: [
    "Synthetic local Chromium measurements, not deployed p75 Web Vitals or representative-device certification.",
    "Playwright wall-clock interactions include automation overhead. Input-to-frame uses browser input event timestamps.",
    "No cloud credentials or Convex requests are used. Convex traffic and shared concurrency remain unmeasured.",
    "Automated accessibility checks cannot certify screen reader usability, real browser zoom, or human pilot acceptance.",
  ],
};
function summary(values, targetMs) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
  return {
    samples: values.length,
    minMs: sorted[0],
    medianMs: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1),
    ...(targetMs === undefined ? {} : { targetMs, withinSyntheticTarget: percentile(0.95) <= targetMs }),
    rawMs: values,
  };
}
async function filesBelow(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesBelow(path.join(dir, entry.name)) : path.join(dir, entry.name))))).flat();
}
try {
  const deadline = performance.now() + 30_000;
  while (true) {
    if (server.exitCode !== null) throw new Error(`Server exited: ${serverLog}`);
    try {
      if ((await fetch(`${baseURL}/welcome`)).ok) break;
    } catch {
      /* server is starting */
    }
    assert(performance.now() < deadline, `Server did not start: ${serverLog}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  browser = await chromium.launch();
  report.environment.browser = browser.version();
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  const request = context.request;
  async function op(name, args = {}) {
    const response = await request.post("/api/local/ops", { data: { op: name, args } });
    assert(response.ok(), await response.text());
    return (await response.json()).result;
  }
  await op("account.init");
  await op("settings.update", { profileCardOnboarded: true });
  const parent = (await op("pages.create", { title: "Baseline parent" })).page;
  const child = (await op("pages.create", { title: "Baseline child", parentId: parent._id })).page;
  const other = (await op("pages.create", { title: "Baseline alternate" })).page;
  const searchTitles = [];
  for (let index = 0; index < samples; index++) {
    const title = `Search probe ${String(index).padStart(3, "0")}`;
    await op("pages.create", { title });
    searchTitles.push(title);
  }
  for (const note of [parent, child, other]) {
    await op("documents.save", {
      pageId: note._id,
      baseRevision: 1,
      blocks: [
        {
          id: `baseline-${note._id}`,
          type: "paragraph",
          props: {},
          content: [{ type: "text", text: `${note.title}: ` + "Baseline English العربية content. ".repeat(80), styles: {} }],
          children: [],
        },
      ],
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const coldStart = performance.now();
  await page.goto(`/p/${parent._id}`);
  await page.locator(".bn-editor[contenteditable=true]").waitFor();
  report.coldRouteToEditorMs = performance.now() - coldStart;
  const routeTimes = [];
  for (let index = 0; index < samples; index++) {
    const target = index % 2 === 0 ? other : parent;
    const start = performance.now();
    await page.getByRole("treeitem").filter({ hasText: target.title }).getByRole("link").first().click();
    await expect(page.getByLabel("Page title", { exact: true })).toHaveValue(target.title);
    await expect(page.locator(".bn-editor[contenteditable=true]")).toContainText(target.title);
    routeTimes.push(performance.now() - start);
  }
  report.warmRouteToEditor = summary(routeTimes, 1000);
  await page.evaluate(() => {
    window.__baselineSidebarFrames = [];
    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest?.("button");
        if (!/^(Expand|Collapse) Baseline parent$/.test(button?.getAttribute("aria-label") ?? "")) return;
        const at = performance.now();
        requestAnimationFrame(() => window.__baselineSidebarFrames.push(performance.now() - at));
      },
      { capture: true },
    );
  });
  const sidebarTimes = [];
  for (let index = 0; index < samples; index++) {
    const toggle = page.getByRole("button", { name: /^(Expand|Collapse) Baseline parent$/ });
    const expanding = (await toggle.getAttribute("aria-label")).startsWith("Expand");
    const start = performance.now();
    await toggle.click();
    await expect(page.getByRole("treeitem").filter({ hasText: "Baseline child" })).toHaveCount(expanding ? 1 : 0);
    sidebarTimes.push(performance.now() - start);
  }
  report.sidebarExpandCollapse = summary(sidebarTimes);
  const sidebarFrames = await page.evaluate(() => window.__baselineSidebarFrames);
  assert.equal(sidebarFrames.length, samples);
  report.sidebarClickToNextFrame = summary(sidebarFrames, 100);
  const editor = page.locator(".bn-editor[contenteditable=true]");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.evaluate(() => {
    window.__baselineInputFrames = [];
    document.addEventListener(
      "input",
      (event) => {
        if (!event.target.closest?.(".bn-editor")) return;
        const at = performance.now();
        requestAnimationFrame(() => window.__baselineInputFrames.push(performance.now() - at));
      },
      { capture: true },
    );
  });
  for (let index = 0; index < samples; index++) {
    await page.keyboard.insertText("x");
    await page.evaluate(() => new Promise(requestAnimationFrame));
  }
  const inputFrames = await page.evaluate(() => window.__baselineInputFrames);
  assert.equal(inputFrames.length, samples);
  report.inputEventToNextFrame = summary(inputFrames, 50);
  await expect(page.getByRole("status").filter({ hasText: /Saved/ })).toBeVisible({ timeout: 10_000 });
  const searchTimes = [];
  for (let index = 0; index < samples; index++) {
    await page.keyboard.press("Control+k");
    const query = searchTitles[index];
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/local/ops") &&
        response.request().postDataJSON()?.op === "search.query" &&
        response.request().postDataJSON()?.args?.query === query &&
        response.ok(),
    );
    const start = performance.now();
    await page.getByRole("combobox").fill(query);
    await response;
    await expect(page.getByRole("option").filter({ hasText: query }).first()).toBeVisible();
    searchTimes.push(performance.now() - start);
    await page.keyboard.press("Escape");
  }
  report.searchIncludingDebounce = summary(searchTimes, 680);
  const cdp = await context.newCDPSession(page);
  const heap = await cdp.send("Runtime.getHeapUsage");
  report.memory = { ...heap, note: "Single renderer sample after all interactions, no garbage collection forced; not a leak test." };
  report.resources = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((entry) => ({
      name: new URL(entry.name).pathname,
      initiatorType: entry.initiatorType,
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      durationMs: entry.duration,
    })),
  );
  const staticFiles = await filesBelow(path.join(root, ".next", "static"));
  const bundles = await Promise.all(
    staticFiles.filter((file) => /\.(js|css)$/.test(file)).map(async (file) => ({ path: path.relative(root, file), bytes: (await stat(file)).size })),
  );
  report.bundles = {
    totalUncompressedBytes: bundles.reduce((sum, file) => sum + file.bytes, 0),
    files: bundles.sort((a, b) => b.bytes - a.bytes),
    note: "All build JS/CSS chunks, not a per-route transferred bundle.",
  };
  await editor.focus();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("combobox")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Search", exact: true })).toHaveCount(0);
  report.focusReturn = await page.evaluate(() => Boolean(document.activeElement?.closest(".bn-editor")));
  report.accessibility = [];
  for (const mode of [
    { name: "wide-light", width: 1440, height: 900, dark: false, dir: "ltr", scale: 1 },
    { name: "narrow-dark-rtl", width: 820, height: 900, dark: true, dir: "rtl", scale: 1 },
    { name: "phone-light", width: 390, height: 844, dark: false, dir: "ltr", scale: 1 },
    { name: "phone-dark-rtl", width: 390, height: 844, dark: true, dir: "rtl", scale: 1 },
    { name: "reflow-200-percent", width: 1440, height: 900, dark: false, dir: "ltr", scale: 2 },
  ]) {
    await page.setViewportSize({ width: mode.width, height: mode.height });
    await page.evaluate(({ dark, dir, scale }) => {
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.dir = dir;
      document.documentElement.style.zoom = String(scale);
    }, mode);
    const overflowPx = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const audit = await new AxeBuilder({ page }).include(".lx-editor").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    report.accessibility.push({
      ...mode,
      overflowPx,
      violations: audit.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) })),
    });
    await page.screenshot({ path: path.join(output, `${mode.name}.png`), animations: "disabled" });
    assert(overflowPx <= 1, `${mode.name}: viewport overflow ${overflowPx}px`);
    assert.equal(audit.violations.length, 0, `${mode.name}: axe violations`);
  }
  assert.deepEqual(errors, []);
  assert(report.focusReturn, "Search must return focus to editor");
  report.runtimeErrors = errors;
  report.status = "completed";
} catch (error) {
  report.status = "failed";
  report.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await writeFile(path.join(output, "measurements.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ status: report.status, output, failure: report.failure }, null, 2));
}
