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
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("public/covers");
const MANIFEST = path.resolve("lib/client/cover-manifest.json");
const PER_COLLECTION = 12;

const MET = "https://collectionapi.metmuseum.org/public/collection/v1";
const metCollections = [
  { name: "The Met Museum", slug: "met", query: "landscape painting", departmentId: 11 },
  { name: "Japanese prints", slug: "japanese-prints", query: "Hokusai", departmentId: 6 },
];
const nasaCollections = [
  { name: "NASA Archive", slug: "nasa", query: "earth from space apollo" },
  { name: "James Webb Telescope", slug: "webb", query: "james webb space telescope nebula" },
];

async function json(url) {
  const res = await fetch(url, { headers: { "User-Agent": "max-cover-fetch" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 3_000_000) throw new Error("too large");
  await writeFile(file, buf);
}

async function metCollection(c) {
  const search = await json(`${MET}/search?hasImages=true&isPublicDomain=true&departmentId=${c.departmentId}&q=${encodeURIComponent(c.query)}`);
  const items = [];
  for (const id of (search.objectIDs ?? []).slice(0, 80)) {
    if (items.length >= PER_COLLECTION) break;
    try {
      const o = await json(`${MET}/objects/${id}`);
      if (!o.isPublicDomain || !o.primaryImageSmall) continue;
      const fileName = `${c.slug}-${id}.jpg`;
      await download(o.primaryImageSmall, path.join(OUT, fileName));
      items.push({ value: `cover:${fileName.replace(/\.jpg$/, "")}`, label: o.title?.slice(0, 80) || "Untitled", creator: o.artistDisplayName || "", source: o.objectURL, license: "Public domain (The Met Open Access, CC0)" });
    } catch (err) {
      console.warn("skip", id, err.message);
    }
  }
  return { name: c.name, items };
}

async function nasaCollection(c) {
  const search = await json(`https://images-api.nasa.gov/search?media_type=image&q=${encodeURIComponent(c.query)}`);
  const items = [];
  for (const item of search.collection?.items ?? []) {
    if (items.length >= PER_COLLECTION) break;
    const data = item.data?.[0];
    const href = item.links?.[0]?.href;
    if (!data || !href) continue;
    const large = href.replace(/~thumb\.jpg$/, "~medium.jpg");
    const fileName = `${c.slug}-${data.nasa_id.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}.jpg`;
    try {
      await download(large, path.join(OUT, fileName));
      items.push({ value: `cover:${fileName.replace(/\.jpg$/, "")}`, label: data.title?.slice(0, 80) || "Untitled", creator: data.center || "NASA", source: `https://images.nasa.gov/details/${data.nasa_id}`, license: "Public domain (NASA media usage guidelines)" });
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
