"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { unzipSync } from "fflate";
import { FileArchive, FileJson, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, Notice, Segmented } from "@/components/ui";
import { useUploader } from "@/lib/client/upload";
import { buildNotionBundle, type BundleItem, type ImportReport, type ZipEntry } from "@/lib/import/notion";
import { notifyError, useWorkspace } from "@/components/workspace/context";

type Source = "notion" | "markdown" | "max";
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

export function ImportDialog() {
  const ws = useWorkspace();
  const router = useRouter();
  const upload = useUploader();
  const [source, setSource] = useState<Source>("notion");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<(ImportReport & { firstId?: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setResult(null);
    setError(null);
    setProgress(null);
  };

  const run = async (files: FileList) => {
    reset();
    setBusy(true);
    try {
      if (source === "notion") {
        const file = files[0];
        if (!/\.zip$/i.test(file.name)) throw new Error("Choose the .zip file Notion created (Settings → Export → Markdown & CSV).");
        setProgress("Opening the export…");
        const entries = unzipAll(new Uint8Array(await file.arrayBuffer()));
        const { items, report } = await buildNotionBundle(
          entries,
          async (e) => {
            const ext = e.path.split(".").pop()!.toLowerCase();
            if (e.data.byteLength > 20 * 1024 * 1024) return null;
            const f = new File([e.data as BlobPart], e.path.split("/").pop()!, { type: MIME[ext] ?? "application/octet-stream" });
            return upload(f, null);
          },
          setProgress,
        );
        if (!items.length) throw new Error("No pages or databases were found in that file. Make sure it's a Notion “Markdown & CSV” export.");
        const parts = chunk(items);
        const keys: Record<string, string> = {};
        let firstId: string | undefined;
        for (const [i, part] of parts.entries()) {
          setProgress(`Creating pages (${i + 1} of ${parts.length})…`);
          const res = await ws.call<{ rootIds: string[]; keys: Record<string, string> }>("import.bundle", { items: part, existing: Object.fromEntries(Object.entries(keys).filter(([k]) => part.some((p) => p.parentKey === k) || true)) });
          Object.assign(keys, res.keys);
          firstId ??= res.rootIds.find(Boolean);
        }
        setResult({ ...report, firstId });
        toast.success("Import finished");
      } else if (source === "markdown") {
        let firstId: string | undefined;
        let n = 0;
        for (const file of Array.from(files)) {
          setProgress(`Importing ${file.name}…`);
          const res = await ws.call<{ id: string }>("import.markdown", { markdown: await file.text(), title: /^#\s/m.test(await file.text()) ? undefined : file.name.replace(/\.(md|markdown|txt)$/i, "") });
          firstId ??= res.id;
          n++;
        }
        setResult({ pages: n, databases: 0, rows: 0, images: 0, skipped: [], firstId });
      } else {
        setProgress("Restoring backup…");
        const res = await ws.call<{ imported: number }>("import.maxExport", { data: await files[0].text() });
        setResult({ pages: res.imported, databases: 0, rows: 0, images: 0, skipped: [] });
      }
    } catch (err) {
      setError((err as Error).message || "The import didn't finish.");
      notifyError(err, "The import didn't finish.");
    } finally {
      setBusy(false);
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  const accept = source === "notion" ? ".zip,application/zip" : source === "markdown" ? ".md,.markdown,.txt,text/markdown,text/plain" : ".json,application/json";

  return (
    <Dialog
      open={ws.importOpen}
      onOpenChange={(o) => (ws.setImportOpen(o), !o && reset())}
      title="Import"
      description="Bring pages in from Notion, Markdown files, or a Max backup. Imported pages are added; nothing existing changes."
      footer={
        result?.firstId ? (
          <Button variant="primary" onClick={() => (ws.setImportOpen(false), router.push(`/p/${result.firstId}`), reset())}>
            Open imported pages
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => ws.setImportOpen(false)}>
            Close
          </Button>
        )
      }
    >
      <div className="grid gap-4">
        <Segmented
          label="Import from"
          value={source}
          onChange={(v) => (setSource(v), reset())}
          options={[
            { value: "notion", label: "Notion", icon: <FileArchive className="size-3.5" /> },
            { value: "markdown", label: "Markdown", icon: <FileText className="size-3.5" /> },
            { value: "max", label: "Max backup", icon: <FileJson className="size-3.5" /> },
          ]}
        />
        <div className="rounded-lg bg-surface-2 p-4 text-[13px] leading-relaxed text-fg-2">
          {source === "notion" && (
            <ol className="grid list-decimal gap-1 ps-4">
              <li>In Notion, open <strong>Settings → Export all workspace content</strong> (or a page&apos;s ⋯ → Export).</li>
              <li>Choose <strong>Markdown &amp; CSV</strong>, include subpages, and download the .zip.</li>
              <li>Choose that .zip here. Pages, nested pages, databases (with columns and rows), row content, links and images come across.</li>
            </ol>
          )}
          {source === "markdown" && <p>Choose one or more .md files. Each becomes a page; a leading “# Heading” becomes its title.</p>}
          {source === "max" && <p>Choose a JSON backup exported from Max (Settings → Data &amp; export). Pages are added as copies with new links.</p>}
        </div>
        <input ref={input} type="file" className="sr-only" accept={accept} multiple={source === "markdown"} onChange={(e) => e.target.files?.length && run(e.target.files)} />
        <Button variant="primary" icon={<Upload className="size-4" />} pending={busy} onClick={() => input.current?.click()}>
          {source === "notion" ? "Choose Notion export (.zip)" : source === "markdown" ? "Choose Markdown files" : "Choose backup (.json)"}
        </Button>
        {progress && (
          <p role="status" className="text-[13px] text-fg-2">
            {progress} Keep this window open.
          </p>
        )}
        {error && <Notice tone="danger" title="Import stopped">{error}</Notice>}
        {result && (
          <Notice tone="success" title="Import finished">
            Added {result.pages} page{result.pages === 1 ? "" : "s"}
            {result.databases ? `, ${result.databases} database${result.databases === 1 ? "" : "s"} with ${result.rows} row${result.rows === 1 ? "" : "s"}` : ""}
            {result.images ? ` and ${result.images} image${result.images === 1 ? "" : "s"}` : ""}.
            {result.skipped.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer">{result.skipped.length} file{result.skipped.length === 1 ? " wasn't" : "s weren't"} imported</summary>
                <ul className="mt-1 max-h-32 list-disc overflow-y-auto ps-4 text-xs">
                  {result.skipped.slice(0, 100).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </details>
            )}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}
