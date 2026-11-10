// Adds each cover's average color to lib/client/cover-manifest.json, so a page can paint
// the cover's color instantly while the image loads. Run after scripts/fetch-covers.mjs.
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

// sharp ships with Next.js; resolve it through Next so no extra dependency is needed.
const sharp = createRequire(createRequire(import.meta.url).resolve("next/package.json"))("sharp");
const file = path.join(process.cwd(), "lib/client/cover-manifest.json");
const manifest = JSON.parse(await readFile(file, "utf8"));
let done = 0;
for (const collection of manifest.collections) {
  for (const item of collection.items) {
    const id = item.value.replace(/^cover:/, "");
    // A 1×1 resize averages the whole image.
    const { data } = await sharp(path.join(process.cwd(), "public/covers", `${id}.jpg`)).resize(1, 1, { fit: "cover" }).raw().toBuffer({ resolveWithObject: true });
    item.color = `#${[...data.subarray(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
    done++;
  }
}
await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Added colors for ${done} covers.`);
