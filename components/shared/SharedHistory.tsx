"use client";

import { useState } from "react";
import { useMutation, useQueries } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button, Spinner } from "@/components/ui";
import { documentText, parseContent } from "@/lib/domain/blocks";
import { serializeError } from "@/lib/domain/errors";
import { sharedHistoricalDocument, sharedHistory, type SharedPageView } from "@/lib/domain/collaboration/sharedContract";

export function SharedHistory({ view }: { view: SharedPageView }) {
  const [open, setOpen] = useState(false);
  return <section className="mt-6 border-t border-line pt-4">
    <Button aria-expanded={open} onClick={() => setOpen(value => !value)}>Page history</Button>
    {open && <HistorySession key={JSON.stringify([view.actorId, view.workspaceId, view.page.id])} view={view} />}
  </section>;
}

function HistorySession({ view }: { view: SharedPageView }) {
  const [selected, setSelected] = useState<Id<"versions"> | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const restore = useMutation(api.sharedPages.restoreVersion);
  const args = { workspaceId: view.workspaceId, pageId: view.page.id as Id<"pages"> };
  const results = useQueries({
    history: { query: api.sharedPages.history, args: { ...args, cursor } },
    ...(selected ? { preview: { query: api.sharedPages.historicalDocument, args: { ...args, versionId: selected } } } : {}),
  });
  const history = sharedHistory.safeParse(results.history);
  const preview = sharedHistoricalDocument.safeParse(results.preview);
  if (results.history instanceof Error || (selected && results.preview instanceof Error)) return <p role="alert" className="mt-3">History is unavailable. Your access may have changed.</p>;
  if (!history.success || history.data.actorId !== view.actorId) return <Spinner label="Loading history" />;
  let text: string | null = null;
  if (preview.success && preview.data.actorId === view.actorId) {
    try { text = documentText(parseContent(JSON.parse(preview.data.content))); }
    catch { text = null; }
  }
  async function restoreSelected() {
    if (!selected || pending || !window.confirm("Restore this document version? The current version will be kept in history. Any unsaved editor draft will require review.")) return;
    setPending(true); setNotice("");
    try {
      await restore({ ...args, versionId: selected, baseRevision: view.document.revision });
      setSelected(null); setNotice("Version restored. The previous document is available in history.");
    } catch (error) { setNotice(serializeError(error).message); }
    finally { setPending(false); }
  }
  return <div className="mt-3 space-y-3">
    <p className="text-sm text-fg-2">Earlier document versions, newest first. Restoring changes the content and keeps the current title.</p>
    {!history.data.versions.length && <p className="text-sm text-fg-2">Earlier versions will appear after your first edit.</p>}
    <ul className="max-h-64 overflow-y-auto divide-y divide-line" aria-label="Document versions">
      {history.data.versions.map(version => <li key={version.id} className="flex items-center justify-between gap-3 py-2">
        <span className="text-sm">Revision {version.revision} · {new Date(version.at).toLocaleString()} · {version.wordCount} words{version.reason === "before-restore" ? " · Before restore" : ""}</span>
        <Button size="sm" aria-pressed={selected === version.id} onClick={() => setSelected(version.id as Id<"versions">)}>Preview revision {version.revision}</Button>
      </li>)}
    </ul>
    <div className="flex gap-2">
      {cursor && <Button size="sm" onClick={() => { setSelected(null); setCursor(null); }}>Newest versions</Button>}
      {history.data.nextCursor && <Button size="sm" onClick={() => { setSelected(null); setCursor(history.data.nextCursor); }}>Older versions</Button>}
    </div>
    {selected && <div className="rounded-lg border border-line p-3">
      {!preview.success || preview.data.actorId !== view.actorId ? <Spinner label="Loading revision" /> : text === null ? <p role="alert">This revision could not be previewed.</p> : <>
        <h3 className="font-semibold">Revision {preview.data.revision} text preview</h3>
        <p className="my-3 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm">{text || "No text in this revision."}</p>
        <p className="mb-3 text-xs text-fg-2">The preview shows text. Restore preserves the saved blocks and formatting.</p>
        {history.data.canRestore && <Button pending={pending} onClick={() => void restoreSelected()}>Restore revision {preview.data.revision}</Button>}
      </>}
    </div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
  </div>;
}
