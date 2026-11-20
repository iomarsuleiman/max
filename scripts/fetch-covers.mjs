#!/usr/bin/env node
/**
 * Downloads public-domain cover images from the same kinds of collections Notion's cover gallery
 * uses (The Met open access, NASA image library incl. James Webb), and writes
 * lib/client/cover-manifest.json with title, creator, source and licence for each image.
 *
 *   node scripts/fetch-covers.mjs          (needs internet access)
 *
 * Only items the source marks as public domain / no known copyright are kept.
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const OUT = path.resolve("public/covers");
const MANIFEST = path.resolve("lib/client/cover-manifest.json");
const PER_COLLECTION = 24;
const previous = await readFile(MANIFEST, "utf8")
  .then(JSON.parse)
  .catch(() => ({ collections: [] }));
const existingItems = (name) => [...(previous.collections.find((c) => c.name === name)?.items ?? [])];

const MET = "https://collectionapi.metmuseum.org/public/collection/v1";
const COVER_WIDTH = 2400;
const metCollections = [
  { name: "The Met Museum", slug: "met", query: "painting", departmentId: 11, limit: 60 },
  { name: "Japanese prints", slug: "japanese-prints", query: "Hokusai", departmentId: 6, limit: 24 },
  { name: "The Met Museum — Hudson River School", slug: "hudson", query: "Thomas Cole", departmentId: 1, limit: 8 },
  { name: "The Met Museum — Patterns", slug: "patterns", query: "William Morris", departmentId: 9, limit: 12 },
];
const nasaCollections = [
  { name: "NASA Archive", slug: "nasa", query: "earth from space apollo" },
  { name: "James Webb Telescope", slug: "webb", query: "james webb space telescope nebula" },
  { name: "Artemis II", slug: "artemis", query: "Artemis II moon", limit: 8 },
];

async function json(url) {
  const res = await fetch(url, { headers: { "User-Agent": "max-cover-fetch" }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, file) {
  if (
    await stat(file)
      .then((s) => s.size > 0)
      .catch(() => false)
  )
    return;
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 3_000_000) throw new Error("too large");
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error("not a JPEG image");
  await writeFile(file, buf);
}

async function saveCoverOriginal(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const original = sharp(Buffer.from(await res.arrayBuffer()));
  const { width = 0 } = await original.metadata();
  const existing = await sharp(file).metadata().catch(() => null);
  if (width <= (existing?.width ?? 0)) return false;
  await writeFile(file, await original.rotate().resize({ width: COVER_WIDTH, withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true }).toBuffer());
  return true;
}

async function refreshNasaCover(id, file) {
  const assets = await json(`https://images-api.nasa.gov/asset/${encodeURIComponent(id)}`);
  const urls = (assets.collection?.items ?? []).map((item) => item.href.replace(/^http:/, "https:"));
  const url = urls.find((url) => /~large\.jpg$/i.test(url)) ?? urls.find((url) => /~orig\.(?:jpe?g|png)$/i.test(url));
  return url ? saveCoverOriginal(url, file) : false;
}

if (process.argv.includes("--refresh-nasa")) {
  const nasaDetails = "https://images.nasa.gov/details/";
  const items = previous.collections.flatMap((collection) => collection.items).filter((item) => item.source?.startsWith(nasaDetails));
  let updated = 0;
  let failed = 0;
  for (let offset = 0; offset < items.length; offset += 4) {
    await Promise.all(items.slice(offset, offset + 4).map(async ({ value, source }) => {
      const file = path.join(OUT, `${value.slice(6)}.jpg`);
      if ((await sharp(file).metadata().catch(() => null))?.width >= COVER_WIDTH) return;
      try {
        if (await refreshNasaCover(source.slice(nasaDetails.length), file)) updated++;
      } catch (error) {
        console.warn(`Could not refresh ${value}: ${error.message}`);
        failed++;
      }
    }));
  }
  console.log(`Refreshed ${updated} NASA covers, ${failed} failed.`);
  process.exit(failed ? 1 : 0);
}

async function metCollection(c) {
  const search = await json(
    `${MET.replace(/\/v1$/, "/v1.1")}/search?hasImages=true&isPublicDomain=true&departmentId=${c.departmentId}&q=${encodeURIComponent(c.query)}&limit=300`,
  );
  const items = existingItems(c.name);
  const limit = c.limit ?? PER_COLLECTION;
  const candidates = (search.objectIDs ?? []).filter((id) => !items.some((item) => item.value === `cover:${c.slug}-${id}`));
  for (let offset = 0; offset < candidates.length && items.length < limit; offset += 4) {
    const fetched = await Promise.all(
      candidates.slice(offset, offset + Math.min(4, limit - items.length)).map(async (id) => {
        try {
          const o = await json(`${MET}/objects/${id}`);
          if (!o.isPublicDomain || !o.primaryImageSmall) return null;
          const fileName = `${c.slug}-${id}.jpg`;
          const file = path.join(OUT, fileName);
          const saved = o.primaryImage && await saveCoverOriginal(o.primaryImage, file).catch(() => false);
          if (!saved) await download(o.primaryImageSmall, file);
          return {
            value: `cover:${fileName.replace(/\.jpg$/, "")}`,
            label: o.title?.slice(0, 80) || "Untitled",
            creator: o.artistDisplayName || "",
            source: o.objectURL,
            license: "Public domain (The Met Open Access, CC0)",
          };
        } catch (err) {
          console.warn("skip", id, err.message);
          return null;
        }
      }),
    );
    items.push(...fetched.filter(Boolean));
  }
  return { name: c.name, items };
}

async function nasaCollection(c) {
  const search = await json(`https://images-api.nasa.gov/search?media_type=image&q=${encodeURIComponent(c.query)}`);
  const items = existingItems(c.name);
  for (const item of search.collection?.items ?? []) {
    if (items.length >= (c.limit ?? PER_COLLECTION)) break;
    const data = item.data?.[0];
    const href = item.links?.[0]?.href;
    if (!data || !href) continue;
    const large = href.replace(/~thumb\.jpg$/, "~medium.jpg");
    const fileName = `${c.slug}-${data.nasa_id.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}.jpg`;
    if (items.some((item) => item.value === `cover:${fileName.replace(/\.jpg$/, "")}`)) continue;
    try {
      await download(large, path.join(OUT, fileName));
      items.push({
        value: `cover:${fileName.replace(/\.jpg$/, "")}`,
        label: data.title?.slice(0, 80) || "Untitled",
        creator: data.center || "NASA",
        source: `https://images.nasa.gov/details/${data.nasa_id}`,
        license: "Public domain (NASA media usage guidelines)",
      });
    } catch (err) {
      console.warn("skip", data.nasa_id, err.message);
    }
  }
  return { name: c.name, items };
}

await mkdir(OUT, { recursive: true });
const collections = [];
for (const c of metCollections) collections.push(await metCollection(c));
for (const c of nasaCollections) collections.push(await nasaCollection(c));
await writeFile(MANIFEST, JSON.stringify({ fetchedAt: new Date().toISOString(), collections: collections.filter((c) => c.items.length) }, null, 2) + "\n");
console.log(collections.map((c) => `${c.name}: ${c.items.length}`).join("\n"));
