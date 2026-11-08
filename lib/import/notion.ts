/**
 * Converts a Notion "Markdown & CSV" export into an import bundle (pages, databases and rows),
 * keeping the page hierarchy, database columns (with inferred types), row content, internal links
 * and images. Pure functions: the zip is read by the caller.
 */

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export interface BundleItem {
  key: string;
  parentKey: string | null;
  title: string;
  icon?: string | null;
  markdown?: string;
  database?: {
    properties: { name: string; type: string; options?: string[] }[];
    rows: { key?: string; title: string; values: Record<string, unknown>; markdown?: string }[];
  };
}

export interface ImportReport {
  pages: number;
  databases: number;
  rows: number;
  images: number;
  skipped: string[];
}

const ID_SUFFIX = /\s+[0-9a-f]{32}$/i;
const decoder = new TextDecoder();

export const cleanTitle = (name: string) => decodeURIComponent(safeDecode(name)).replace(ID_SUFFIX, "").trim() || "Untitled";
function safeDecode(s: string) {
  try {
    return decodeURIComponent(s) === s ? s : s;
  } catch {
    return s;
  }
}

const stripExt = (p: string) => p.replace(/(_all)?\.(md|csv)$/i, "");
const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** RFC 4180 CSV parsing (quotes, escaped quotes, newlines in cells, BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function toIsoDate(v: string): string | null {
  const first = v.split("→")[0].replace(/\s*\(GMT[^)]*\)\s*$/, "").trim();
  if (!first) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(first)) return first.slice(0, 10);
  const slash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})/.exec(first);
  if (slash) return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;
  if (!/[a-z]/i.test(first) && !/\d{1,2}\/\d{1,2}\/\d{2,4}/.test(first)) return null;
  const t = Date.parse(first);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Guesses a property type from a column's values. */
export function inferType(name: string, values: string[]): { type: string; options?: string[] } {
  const present = values.map((v) => v.trim()).filter(Boolean);
  if (!present.length) return { type: "text" };
  if (present.every((v) => /^(Yes|No)$/i.test(v))) return { type: "checkbox" };
  if (present.every((v) => /^-?[\d,]*\.?\d+%?$/.test(v.replace(/^\$/, "")))) return { type: "number" };
  if (present.every((v) => toIsoDate(v) !== null)) return { type: "date" };
  if (present.every((v) => /^https?:\/\/\S+$/.test(v))) return { type: "url" };
  if (present.every((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))) return { type: "email" };
  if (present.some((v) => /\.md\)/.test(v))) return { type: "text" }; // relations: kept as readable text
  const tokens = present.flatMap((v) => v.split(/,\s*/));
  const distinct = [...new Set(tokens)];
  const multi = present.some((v) => v.includes(", "));
  if (distinct.length <= Math.max(3, Math.min(40, Math.ceil(tokens.length * 0.6))) && distinct.every((t) => t.length <= 60)) {
    if (multi) return { type: "multi_select", options: distinct };
    if (/^status$/i.test(name)) return { type: "status", options: distinct };
    return { type: "select", options: distinct };
  }
  return { type: "text" };
}

function convertValue(type: string, raw: string): unknown {
  const v = raw.trim();
  if (!v) return null;
  switch (type) {
    case "checkbox":
      return /^yes$/i.test(v);
    case "number":
      return Number(v.replace(/[$,%]/g, ""));
    case "date":
      return toIsoDate(v);
    case "multi_select":
      return v.split(/,\s*/).filter(Boolean);
    default:
      return v.replace(/\s*\(([^()]*?\.md)\)/g, "");
  }
}

/** Cleans Notion-flavoured Markdown: callouts, toggles, page links and the leading title. */
export function cleanMarkdown(md: string, resolveLink: (href: string) => string | null): { body: string; title: string | null; props: Record<string, string> } {
  let text = md.replace(/\r\n?/g, "\n");
  let title: string | null = null;
  const h1 = /^# (.+)\n+/.exec(text);
  if (h1) {
    title = h1[1].trim();
    text = text.slice(h1[0].length);
  }
  // Row pages begin with "Property: value" lines.
  const props: Record<string, string> = {};
  const lines = text.split("\n");
  let i = 0;
  while (i < lines.length && /^[^:\n#>*\-|`]{1,60}: .*$/.test(lines[i])) {
    const [k, ...rest] = lines[i].split(": ");
    props[k.trim()] = rest.join(": ").trim();
    i++;
  }
  if (i > 0 && (lines[i] === "" || i === lines.length)) text = lines.slice(i).join("\n").replace(/^\n+/, "");
  else for (const k of Object.keys(props)) delete props[k];
  text = text
    .replace(/<aside>\s*\n?([\s\S]*?)<\/aside>/g, (_m, inner: string) => {
      const body = inner.trim().replace(/^(\p{Extended_Pictographic}️?)\s*/u, "");
      return "> [!INFO]\n" + body.split("\n").map((l: string) => `> ${l}`).join("\n");
    })
    .replace(/<details>\s*<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g, (_m, s: string, b: string) => `- ${s.trim()}\n${b.trim().split("\n").map((l: string) => `  ${l}`).join("\n")}`)
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang: string, label: string, href: string) => {
      if (/^(https?:|mailto:)/.test(href)) return m;
      const resolved = resolveLink(href);
      if (bang) return resolved ? `![${label}](${resolved})` : label ? `*(image: ${label})*` : "";
      return resolved ? `[${label}](${resolved})` : label;
    });
  return { body: text.trim(), title, props };
}

/**
 * Builds the bundle. `uploadImage` stores an image and returns its URL (or null to skip).
 */
export async function buildNotionBundle(entries: ZipEntry[], uploadImage?: (entry: ZipEntry) => Promise<string | null>, onProgress?: (msg: string) => void): Promise<{ items: BundleItem[]; report: ImportReport }> {
  const report: ImportReport = { pages: 0, databases: 0, rows: 0, images: 0, skipped: [] };
  // Strip the shared export folder prefix.
  const paths = entries.map((e) => e.path).filter((p) => !p.endsWith("/"));
  const first = paths[0]?.split("/")[0] ?? "";
  const common = first && paths.every((p) => p.startsWith(first + "/")) && !/\.(md|csv)$/i.test(first) ? first + "/" : "";
  const files = new Map<string, ZipEntry>();
  for (const e of entries) if (!e.path.endsWith("/")) files.set(e.path.slice(common.length), e);

  const csvByKey = new Map<string, string>();
  for (const p of files.keys()) {
    if (!/\.csv$/i.test(p)) continue;
    const key = stripExt(p);
    if (/_all\.csv$/i.test(p) || !csvByKey.has(key)) csvByKey.set(key, p);
  }
  const mdKeys = [...files.keys()].filter((p) => /\.md$/i.test(p)).map(stripExt);
  const dbKeys = new Set(csvByKey.keys());
  const pageKeys = new Set(mdKeys);

  const items: BundleItem[] = [];
  const rowKeyByPath = new Map<string, string>();
  const parentOf = (key: string): string | null => {
    let dir = dirOf(key);
    while (dir) {
      if (pageKeys.has(dir) && !isRowOf(dir)) return dir;
      if (dbKeys.has(dir)) return dir;
      dir = dirOf(dir);
    }
    return null;
  };
  const isRowOf = (key: string): string | null => {
    const dir = dirOf(key);
    return dbKeys.has(dir) ? dir : null;
  };
  const resolveFor = (fromKey: string) => (href: string): string | null => {
    let target: string;
    try {
      target = decodeURIComponent(href.split("#")[0]);
    } catch {
      target = href;
    }
    const base = dirOf(fromKey);
    const parts = (base ? base + "/" + target : target).split("/");
    const norm: string[] = [];
    for (const part of parts) {
      if (part === "..") norm.pop();
      else if (part && part !== ".") norm.push(part);
    }
    const path = norm.join("/");
    if (/\.(md|csv)$/i.test(path)) {
      const key = stripExt(path);
      return pageKeys.has(key) || dbKeys.has(key) ? `max-import://${encodeURIComponent(key)}` : null;
    }
    if (imageUrls.has(path)) return imageUrls.get(path)!;
    return null;
  };

  // Upload images referenced anywhere.
  const imageUrls = new Map<string, string>();
  if (uploadImage) {
    const images = [...files.keys()].filter((p) => /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(p));
    let n = 0;
    for (const p of images) {
      onProgress?.(`Uploading images (${++n} of ${images.length})…`);
      try {
        const url = await uploadImage(files.get(p)!);
        if (url) {
          imageUrls.set(p, url);
          report.images++;
        } else report.skipped.push(`${baseOf(p)} (image)`);
      } catch {
        report.skipped.push(`${baseOf(p)} (image upload failed)`);
      }
    }
  }

  // Databases with their rows.
  const rowContent = new Map<string, { body: string; key: string }>();
  for (const key of mdKeys) {
    const db = isRowOf(key);
    if (!db) continue;
    const { body } = cleanMarkdown(decoder.decode(files.get(key + ".md")!.data), resolveFor(key));
    rowContent.set(key, { body, key });
  }

  const ordered = [...new Set([...mdKeys, ...dbKeys])].filter((k) => !isRowOf(k) || dbKeys.has(k)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  for (const key of ordered) {
    onProgress?.(`Reading ${cleanTitle(baseOf(key))}…`);
    if (dbKeys.has(key)) {
      const rows = parseCsv(decoder.decode(files.get(csvByKey.get(key)!)!.data));
      const [header = [], ...body] = rows;
      const columns = header.map((h) => h.trim());
      const types = columns.map((name, i) => (i === 0 ? { type: "title" } : inferType(name, body.map((r) => r[i] ?? ""))));
      const dbRows = body.map((r) => {
        const title = (r[0] ?? "").trim() || "Untitled";
        const values: Record<string, unknown> = {};
        columns.forEach((c, i) => {
          if (i > 0) values[c] = convertValue(types[i].type, r[i] ?? "");
        });
        // Match the row's own page by title.
        const match = [...rowContent.keys()].find((k) => dirOf(k) === key && cleanTitle(baseOf(k)) === title && !rowKeyByPath.has(k));
        if (match) rowKeyByPath.set(match, match);
        return { key: match, title, values, markdown: match ? rowContent.get(match)!.body : undefined };
      });
      // Row pages that weren't in the CSV still come through.
      for (const [k, v] of rowContent) {
        if (dirOf(k) === key && !rowKeyByPath.has(k)) dbRows.push({ key: k, title: cleanTitle(baseOf(k)), values: {}, markdown: v.body });
      }
      const pageMd = files.get(key + ".md");
      items.push({
        key,
        parentKey: parentOf(key),
        title: cleanTitle(baseOf(key)),
        markdown: pageMd ? cleanMarkdown(decoder.decode(pageMd.data), resolveFor(key)).body : undefined,
        database: {
          properties: columns.slice(1).map((name, i) => ({ name: name || `Column ${i + 2}`, type: types[i + 1].type, options: types[i + 1].options })),
          rows: dbRows,
        },
      });
      report.databases++;
      report.rows += dbRows.length;
    } else {
      const { body, title } = cleanMarkdown(decoder.decode(files.get(key + ".md")!.data), resolveFor(key));
      items.push({ key, parentKey: parentOf(key), title: title || cleanTitle(baseOf(key)), markdown: body });
      report.pages++;
    }
  }
  // Pages nested under database rows become children of those rows.
  for (const item of items) {
    if (!item.parentKey) {
      const dir = dirOf(item.key);
      if (dir && rowKeyByPath.has(dir)) item.parentKey = dir;
    }
  }
  // Parents must come before children.
  const known = new Set<string>();
  for (const i of items) for (const r of i.database?.rows ?? []) if (r.key) known.add(r.key);
  const sorted: BundleItem[] = [];
  const pending = [...items];
  let guard = 0;
  while (pending.length && guard++ < 10_000) {
    const idx = pending.findIndex((i) => !i.parentKey || known.has(i.parentKey));
    if (idx < 0) {
      for (const i of pending) {
        i.parentKey = null;
        sorted.push(i);
      }
      break;
    }
    const [item] = pending.splice(idx, 1);
    known.add(item.key);
    sorted.push(item);
  }
  for (const p of files.keys()) if (!/\.(md|csv|png|jpe?g|gif|webp|avif|svg)$/i.test(p)) report.skipped.push(baseOf(p));
  return { items: sorted, report };
}
