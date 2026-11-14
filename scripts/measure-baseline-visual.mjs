import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "@playwright/test";
import { PNG } from "pngjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "compare";
assert(["capture", "compare"].includes(command), "Usage: node scripts/measure-baseline-visual.mjs capture|compare [test-results-directory]");
const source = path.resolve(process.argv[3] ?? path.join(root, "test-results"));
const destination = path.join(root, "docs", "baselines", process.platform);
const modes = {
  "wide-light": { width: 1440, height: 900, theme: "light", direction: "ltr" },
  "narrow-dark-rtl": { width: 820, height: 900, theme: "dark", direction: "rtl" },
  "phone-light": { width: 390, height: 844, theme: "light", direction: "ltr" },
  "phone-dark-rtl": { width: 390, height: 844, theme: "dark", direction: "rtl" },
};
async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesBelow(path.join(directory, entry.name)) : path.join(directory, entry.name))))
  ).flat();
}
const buildFile = path.join(root, ".next", "BUILD_ID");
const buildTime = (await stat(buildFile)).mtimeMs;
const records = [];
for (const file of await filesBelow(source)) {
  const filename = path.basename(file, ".png");
  if (!file.endsWith(".png") || !filename.startsWith("reference-")) continue;
  const match = /^reference-(.+)-tile-(\d+)$/.exec(filename);
  if (!match) continue;
  const mode = match[1];
  if (!Object.hasOwn(modes, mode)) continue;
  const directory = path.basename(path.dirname(file));
  if (!directory.startsWith("editor-baseline-")) continue;
  const project = directory.endsWith("-mobile-webkit")
    ? "mobile-webkit"
    : directory.endsWith("-mobile")
      ? "mobile"
      : directory.endsWith("-desktop")
        ? "desktop"
        : null;
  if (!project) continue;
  assert((await stat(file)).mtimeMs >= buildTime, `Stale screenshot ${file}. Run the corpus browser suite after the current build.`);
  const metadata = JSON.parse(await readFile(path.join(path.dirname(file), `reference-${mode}.json`), "utf8"));
  const tile = metadata.tiles.find((tile) => tile.filename === path.basename(file));
  assert(tile, `Missing tile geometry for ${file}`);
  records.push({
    source: file,
    project,
    mode,
    filename: `${project}-${mode}-tile-${match[2]}.png`,
    tileIndex: Number(match[2]),
    scrollTop: tile.scrollTop,
    clip: tile.clip,
    contentHeight: tile.contentHeight,
    viewportHeight: tile.viewportHeight,
    ...modes[mode],
  });
}
assert.equal(
  new Set(records.map((record) => `${record.project}-${record.mode}`)).size,
  12,
  "Expected tiled captures for all four corpus modes in desktop Chromium, mobile Chromium and mobile WebKit. Run the full editor-baseline suite first.",
);
assert.equal(new Set(records.map((record) => record.filename)).size, records.length, "Duplicate corpus screenshots; use a fresh output directory.");
for (const group of new Set(records.map((record) => `${record.project}-${record.mode}`))) {
  const tiles = records.filter((record) => `${record.project}-${record.mode}` === group).sort((a, b) => a.tileIndex - b.tileIndex);
  assert.equal(tiles[0].scrollTop, 0, `${group}: top of document not captured`);
  assert(tiles.at(-1).scrollTop + tiles.at(-1).viewportHeight >= tiles.at(-1).contentHeight - 1, `${group}: bottom of document not captured`);
  for (let index = 1; index < tiles.length; index++) {
    assert.equal(tiles[index].tileIndex, index, `${group}: missing tile`);
    assert(tiles[index].scrollTop <= tiles[index - 1].scrollTop + tiles[index - 1].viewportHeight, `${group}: uncaptured gap between tiles`);
  }
}
if (command === "capture") {
  await mkdir(destination, { recursive: true });
  const browsers = {};
  for (const [name, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch();
    browsers[name] = browser.version();
    await browser.close();
  }
  const screenshots = [];
  for (const { source: file, ...record } of records.sort((a, b) => a.filename.localeCompare(b.filename))) {
    const bytes = await readFile(file);
    const png = PNG.sync.read(bytes);
    await copyFile(file, path.join(destination, record.filename));
    screenshots.push({
      ...record,
      pixelWidth: png.width,
      pixelHeight: png.height,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  const retained = new Set(screenshots.map((record) => record.filename));
  for (const entry of await readdir(destination)) {
    if (/^(desktop|mobile|mobile-webkit)-(wide-light|narrow-dark-rtl|phone-light|phone-dark-rtl)(-tile-\d+)?\.png$/.test(entry) && !retained.has(entry))
      await unlink(path.join(destination, entry));
  }
  await writeFile(
    path.join(destination, "manifest.json"),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        platform: process.platform,
        arch: process.arch,
        browsers,
        buildId: (await readFile(buildFile, "utf8")).trim(),
        fixtureSha256: createHash("sha256")
          .update(await readFile(path.join(root, "tests", "fixtures", "editor-document.json")))
          .digest("hex"),
        fixedClock: "2026-11-10T12:00:00Z",
        screenshotAnimations: "disabled",
        scope:
          "Overlapping viewport tiles of the synthetic editor corpus. Real scroll surface preserved; topbar/sidebar excluded. Diagram SVG loaded before capture; attachments synthetic and external embeds stubbed. Platform-specific diagnostic references, not design approval or assistive-technology certification.",
        screenshots,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Captured ${screenshots.length} corpus references in ${path.relative(root, destination)}.`);
} else {
  const manifest = JSON.parse(await readFile(path.join(destination, "manifest.json"), "utf8"));
  assert.equal(manifest.platform, process.platform);
  assert.equal(manifest.screenshots.length, records.length, "Tile coverage changed; inspect the document geometry.");
  assert.equal(
    createHash("sha256")
      .update(await readFile(path.join(root, "tests", "fixtures", "editor-document.json")))
      .digest("hex"),
    manifest.fixtureSha256,
    "Corpus changed; review it before accepting new references.",
  );
  const differences = [];
  for (const record of records) {
    const reference = await readFile(path.join(destination, record.filename));
    const entry = manifest.screenshots.find((entry) => entry.filename === record.filename);
    assert(entry, `Missing manifest entry ${record.filename}`);
    assert.deepEqual(
      { scrollTop: record.scrollTop, clip: record.clip, contentHeight: record.contentHeight, viewportHeight: record.viewportHeight },
      { scrollTop: entry.scrollTop, clip: entry.clip, contentHeight: entry.contentHeight, viewportHeight: entry.viewportHeight },
      `Tile geometry changed: ${record.filename}`,
    );
    assert.equal(createHash("sha256").update(reference).digest("hex"), entry.sha256, `Reference checksum changed: ${record.filename}`);
    const before = PNG.sync.read(reference);
    const after = PNG.sync.read(await readFile(record.source));
    assert.equal(after.width, before.width, record.filename);
    assert.equal(after.height, before.height, record.filename);
    let changedPixels = 0;
    for (let index = 0; index < before.data.length; index += 4) {
      if ([0, 1, 2, 3].some((channel) => Math.abs(before.data[index + channel] - after.data[index + channel]) > 16)) changedPixels++;
    }
    differences.push({
      filename: record.filename,
      changedPixels,
      totalPixels: before.width * before.height,
      changedFraction: changedPixels / (before.width * before.height),
    });
  }
  console.log(JSON.stringify({ platform: process.platform, channelTolerance: 16, maxChangedFraction: 0.005, differences }, null, 2));
  assert(
    differences.every((difference) => difference.changedFraction <= 0.005),
    "Visual differences exceed 0.5%; inspect images and update deliberately. Do not recapture to hide a regression.",
  );
}
