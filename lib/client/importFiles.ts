import { unzipSync } from "fflate";
import { buildNotionBundle, type BundleItem, type ImportReport, type ZipEntry } from "@/lib/import/notion";

import { importSourceOf, type ImportSource } from "./importKinds";

export { importSourceOf, isImportable, type ImportSource } from "./importKinds";
type Call = <T>(op: string, args: Record<string, unknown>) => Promise<T>;
type Upload = (file: File, pageId: string | null) => Promise<string>;

const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml" };

function unzipAll(data: Uint8Array, prefix = "", depth = 0): ZipEntry[] {
  const out: ZipEntry[] = [];
  const files = unzipSync(data);
  for (const [path, bytes] of Object.entries(files)) {
    if (/\.zip$/i.test(path) && depth < 3) out.push(...unzipAll(bytes, prefix, depth + 1));
    else out.push({ path: prefix + path, data: bytes });
  }
  return out;
}

/** Chunks a bundle so each request stays small; parents always precede children. */
function chunk(items: BundleItem[], size = 40): BundleItem[][] {
  const out: BundleItem[][] = [];
  let cur: BundleItem[] = [];
  let weight = 0;
  for (const i of items) {
    const w = 1 + (i.database?.rows.length ?? 0) / 5 + (i.markdown?.length ?? 0) / 50_000;
    if (cur.length && weight + w > size) {
      out.push(cur);
      cur = [];
      weight = 0;
    }
    cur.push(i);
    weight += w;
  }
  if (cur.length) out.push(cur);
  return out;
}

const titleFrom = (name: string) => name.replace(/\.[a-z0-9]+$/i, "");

/**
 * Imports files into the open workspace and says which page to open. Each file is read by its own
 * kind unless `source` forces one (the Import dialog's choice). Templates go to the template list.
 */
export async function importFiles(
  call: Call,
  upload: Upload,
  files: File[],
  opts: { source?: ImportSource; asTemplates?: boolean; onProgress?: (text: string) => void } = {},
): Promise<ImportReport & { firstId?: string }> {
  const progress = opts.onProgress ?? (() => undefined);
  const total: ImportReport & { firstId?: string } = { pages: 0, databases: 0, rows: 0, images: 0, skipped: [] };
  for (const file of files) {
    const source = opts.source ?? importSourceOf(file.name);
    if (!source) {
      total.skipped.push(file.name);
      continue;
    }
    if (source === "notion") {
      if (!/\.zip$/i.test(file.name)) throw new Error("Choose the .zip file Notion created (Settings → Export → Markdown & CSV).");
      progress("Opening the export…");
      const entries = unzipAll(new Uint8Array(await file.arrayBuffer()));
      const { items, report } = await buildNotionBundle(
        entries,
        async (e) => {
          const ext = e.path.split(".").pop()!.toLowerCase();
          if (e.data.byteLength > 20 * 1024 * 1024) return null;
          const f = new File([e.data as BlobPart], e.path.split("/").pop()!, { type: MIME[ext] ?? "application/octet-stream" });
          return upload(f, null);
        },
        progress,
      );
      if (!items.length) throw new Error("No pages or databases were found in that file. Make sure it's a Notion “Markdown & CSV” export.");
      const parts = chunk(items);
      const keys: Record<string, string> = {};
      for (const [i, part] of parts.entries()) {
        progress(`Creating pages (${i + 1} of ${parts.length})…`);
        const res = await call<{ rootIds: string[]; keys: Record<string, string> }>("import.bundle", { items: part, existing: keys, asTemplates: !!opts.asTemplates });
        Object.assign(keys, res.keys);
        if (!opts.asTemplates) total.firstId ??= res.rootIds.find(Boolean);
      }
      total.pages += report.pages;
      total.databases += report.databases;
      total.rows += report.rows;
      total.images += report.images;
      total.skipped.push(...report.skipped);
    } else if (source === "markdown" || source === "html") {
      progress(`Importing ${file.name}…`);
      const text = await file.text();
      // Web pages are turned into Markdown here, in the browser, scripts and styles left out.
      const markdown = (source === "html" ? await htmlToMarkdown(text) : text).slice(0, 400_000);
      const title = source === "html" ? (/<title[^>]*>([^<]{1,300})<\/title>/i.exec(text)?.[1]?.trim() || titleFrom(file.name)) : /^#\s/m.test(text) ? undefined : titleFrom(file.name);
      // A file dropped on Templates becomes a template; anywhere else it becomes a page you can open.
      const res = opts.asTemplates
        ? await call<{ rootIds: string[] }>("import.bundle", { items: [{ key: file.name, parentKey: null, title: title ?? titleFrom(file.name), markdown }], asTemplates: true }).then((r) => ({ id: r.rootIds[0] }))
        : await call<{ id: string }>("import.markdown", { markdown, title });
      if (!opts.asTemplates) total.firstId ??= res.id;
      total.pages++;
    } else {
      progress("Restoring backup…");
      const res = await call<{ imported: number }>("import.maxExport", { data: await file.text() });
      total.pages += res.imported;
    }
  }
  return total;
}

async function htmlToMarkdown(html: string): Promise<string> {
  const { default: Turndown } = await import("turndown");
  const turndown = new Turndown({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "*" });
  turndown.remove(["script", "style", "noscript", "iframe", "object", "embed", "form"]);
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return turndown.turndown(body.slice(0, 2_000_000));
}
