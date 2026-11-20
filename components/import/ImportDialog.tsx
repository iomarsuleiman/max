"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileArchive, FileJson, FileText, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, Notice, Segmented } from "@/components/ui";
import { useUploader } from "@/lib/client/upload";
import type { ImportReport } from "@/lib/import/notion";
import { importFiles } from "@/lib/client/importFiles";
import { notifyError, useWorkspace } from "@/components/workspace/context";

type Source = "notion" | "markdown" | "max";

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
      const res = await importFiles(ws.call, upload, Array.from(files), { source, asTemplates: source === "notion" && ws.importAsTemplates, onProgress: setProgress });
      setResult(res);
      if (source === "notion") toast.success(ws.importAsTemplates ? "Imported as templates" : "Import finished");
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
        result && ws.importAsTemplates ? (
          <Button variant="primary" onClick={() => (ws.setImportOpen(false), router.push("/templates"), reset())}>
            Open Templates
          </Button>
        ) : result?.firstId ? (
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
        {source === "notion" && (
          <label className="flex items-start gap-2.5 text-[13px]">
            <input type="checkbox" checked={ws.importAsTemplates} onChange={(e) => ws.setImportAsTemplates(e.target.checked)} className="mt-0.5 accent-[var(--accent)]" />
            <span>
              <span className="font-medium text-fg">Import as templates</span>
              <span className="block text-fg-3">For Notion templates you duplicated: top-level pages and databases go to Templates, ready to use again and again. (Notion doesn&apos;t export a database&apos;s own row templates, so recreate those from its New ▾ menu.)</span>
            </span>
          </label>
        )}
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
