"use client";

import dynamic from "next/dynamic";
import { useMutation } from "convex/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { SharedPageList, SharedPageView } from "@/lib/domain/collaboration/sharedContract";
import { serializeError } from "@/lib/domain/errors";
import type { PageRef } from "@/components/editor/blocks";

const MaxEditor = dynamic(() => import("@/components/editor/MaxEditor"), { ssr: false });
type Draft = { baseRevision: number; blocks: unknown[] };
type Status = "saved" | "unsaved" | "saving" | "conflict" | "error";
const keyFor = (actorId: string, workspaceId: string, pageId: string) =>
  `shared-draft:v1:${JSON.stringify([actorId, workspaceId, pageId])}`;

/** Remove a draft from recovery after the current actor loses access. */
export function quarantineSharedDraft(actorId: string, workspaceId: string, pageId: string) {
  try {
    const key = keyFor(actorId, workspaceId, pageId);
    const draft = localStorage.getItem(key);
    if (draft !== null) {
      // Keep the recoverable copy until quarantine succeeds (storage can be full).
      localStorage.setItem(`quarantine:${key}`, draft);
      localStorage.removeItem(key);
    }
  } catch { /* Storage may be disabled. */ }
}

function parseBlocks(content: string): unknown[] | null {
  try {
    const value: unknown = JSON.parse(content);
    return Array.isArray(value) ? value : null;
  } catch { return null; }
}
function readDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "baseRevision" in value && typeof value.baseRevision === "number" && "blocks" in value && Array.isArray(value.blocks)) return { baseRevision: value.baseRevision, blocks: value.blocks };
  } catch { /* Unavailable or malformed storage. */ }
  return null;
}

export function SharedDocument({ view, pages, onNavigate, onCreateSubpage, onAccessLost }: {
  view: SharedPageView;
  pages: SharedPageList["pages"];
  onNavigate: (id: string) => void;
  onCreateSubpage: () => Promise<{ id: string; title: string } | null>;
  onAccessLost: () => void;
}) {
  // Scope all state to the authenticated actor and page even if the parent reuses this component.
  return <SharedDocumentSession key={JSON.stringify([view.actorId, view.workspaceId, view.page.id])} {...{ view, pages, onNavigate, onCreateSubpage, onAccessLost }} />;
}

function SharedDocumentSession({ view, pages, onNavigate, onCreateSubpage, onAccessLost }: {
  view: SharedPageView; pages: SharedPageList["pages"]; onNavigate: (id: string) => void;
  onCreateSubpage: () => Promise<{ id: string; title: string } | null>; onAccessLost: () => void;
}) {
  const save = useMutation(api.sharedPages.save);
  const storageKey = keyFor(view.actorId, view.workspaceId, view.page.id);
  const [initial, setInitial] = useState(() => parseBlocks(view.document.content));
  const [serverContentValid, setServerContentValid] = useState(() => parseBlocks(view.document.content) !== null);
  const [editorKey, setEditorKey] = useState(0);
  const [status, setStatus] = useState<Status>("saved");
  const [notice, setNotice] = useState("");
  const [draftStored, setDraftStored] = useState(true);
  const [lost, setLost] = useState(false);
  const [settled, setSettled] = useState(0);
  const base = useRef(view.document.revision);
  const pending = useRef<unknown[] | null>(null);
  const inflight = useRef(false);
  const conflict = useRef(false);
  const accessLost = useRef(false);
  const [wasEditable, setWasEditable] = useState(view.canEdit);
  const latest = useRef(view);
  useEffect(() => { latest.current = view; if (view.canEdit) setWasEditable(true); }, [view]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const pageMap = useMemo(() => new Map<string, PageRef>(pages.map(p => [p.id, { title: p.title, icon: null, kind: "page" }])), [pages]);

  const persist = useCallback((blocks: unknown[], revision: number) => {
    try { localStorage.setItem(storageKey, JSON.stringify({ baseRevision: revision, blocks } satisfies Draft)); setDraftStored(true); }
    catch { setDraftStored(false); }
  }, [storageKey]);
  const loseAccess = useCallback(() => {
    if (accessLost.current) return;
    accessLost.current = true;
    if (timer.current) clearTimeout(timer.current);
    quarantineSharedDraft(view.actorId, view.workspaceId, view.page.id);
    pending.current = null;
    setLost(true);
    onAccessLost();
  }, [onAccessLost, view.actorId, view.workspaceId, view.page.id]);

  // A revoked write grant hides the document immediately, before the effect runs.
  const revoked = wasEditable && !view.canEdit;
  useEffect(() => { if (revoked) loseAccess(); }, [revoked, loseAccess]);
  useEffect(() => {
    const draft = readDraft(storageKey);
    if (!draft || !view.canEdit) return;
    if (JSON.stringify(draft.blocks) === view.document.content) { try { localStorage.removeItem(storageKey); } catch {} return; }
    pending.current = draft.blocks;
    conflict.current = true;
    setInitial(draft.blocks);
    setEditorKey(k => k + 1);
    setStatus("conflict");
    setNotice("An unsaved draft was found on this device. Review it before choosing what to do.");
  // Recovery is checked once per actor/page session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (timer.current) clearTimeout(timer.current); }; }, []);

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (inflight.current || !pending.current || conflict.current || accessLost.current || !latest.current.canEdit) return;
    const blocks = pending.current;
    const revision = base.current;
    persist(blocks, revision);
    inflight.current = true;
    setStatus("saving");
    try {
      const result = await save({ workspaceId: view.workspaceId, pageId: view.page.id as Id<"pages">, blocks, baseRevision: revision });
      if (!mounted.current || accessLost.current) return;
      base.current = result.revision;
      if (pending.current === blocks) {
        pending.current = null;
        try { localStorage.removeItem(storageKey); } catch {}
        setStatus("saved");
      } else if (pending.current) {
        persist(pending.current, result.revision);
        setStatus("unsaved");
      }
    } catch (error) {
      if (!mounted.current || accessLost.current) return;
      const e = serializeError(error);
      if (e.code === "NOT_FOUND" || e.code === "UNAUTHENTICATED" || e.code === "READ_ONLY") { loseAccess(); return; }
      if (e.code === "CONFLICT") { conflict.current = true; setStatus("conflict"); setNotice("This page changed elsewhere. Review your draft and the latest version before continuing."); }
      else { setStatus("error"); setNotice(e.message); }
    } finally {
      inflight.current = false;
      if (mounted.current && !accessLost.current) setSettled(n => n + 1);
    }
  }, [loseAccess, persist, save, storageKey, view.page.id, view.workspaceId]);

  useEffect(() => {
    if (accessLost.current || revoked || inflight.current) return;
    const remote = view.document;
    if (remote.revision > base.current) {
      if (pending.current) {
        conflict.current = true; setStatus("conflict");
        setNotice("This page changed elsewhere. Review your draft and the latest version before continuing.");
      } else {
        base.current = remote.revision;
        const parsed = parseBlocks(remote.content);
        setServerContentValid(parsed !== null); setInitial(parsed); setEditorKey(k => k + 1); setStatus("saved");
      }
    }
    if (pending.current && !conflict.current && status === "unsaved") timer.current = setTimeout(() => void flush(), 650);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [view.document.revision, view.document.content, settled, status, flush, revoked]);

  const change = (blocks: unknown[]) => {
    if (accessLost.current || revoked || !view.canEdit || !serverContentValid) return;
    pending.current = blocks;
    persist(blocks, base.current);
    if (!conflict.current) setStatus(inflight.current ? "saving" : "unsaved");
  };
  const loadLatest = () => {
    if (accessLost.current || revoked) return;
    // Preserve the draft separately; loading the latest does not silently delete it.
    if (pending.current) persist(pending.current, base.current);
    pending.current = null; conflict.current = false; base.current = latest.current.document.revision;
    const parsed = parseBlocks(latest.current.document.content);
    setServerContentValid(parsed !== null); setInitial(parsed); setEditorKey(k => k + 1); setStatus("saved");
    setNotice(draftStored ? "Latest version loaded. Your draft remains on this device for review on your next visit." : "Latest version loaded. The draft could not be stored on this device.");
  };
  const download = () => {
    if (accessLost.current || revoked || !pending.current) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(pending.current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "shared-page-draft.json"; link.click(); URL.revokeObjectURL(url);
  };
  if (lost || revoked) return <p role="status" className="text-fg-2">Access to this page has changed.</p>;
  return <div className="space-y-3">
    <div role="status" aria-live="polite" className="text-sm text-fg-2">
      {status === "saved" ? "Saved" : status === "saving" ? "Saving…" : status === "unsaved" ? "Unsaved changes" : status === "conflict" ? "Review needed" : "Could not save"}
      {!draftStored && status !== "saved" ? " Your draft could not be stored on this device." : ""}
      {notice && <p>{notice}</p>}
    </div>
    {!serverContentValid && <p role="alert" className="rounded-lg bg-surface-2 p-3 text-sm">This shared page could not be opened because its saved content is malformed. No editor was loaded, so the content was not replaced with a blank page. Ask the owner to restore the page from a valid copy.</p>}
    {status === "conflict" && <div className="rounded-lg bg-surface-2 p-3 text-sm space-x-2">
      <button type="button" className="rounded bg-overlay px-3 py-1" onClick={loadLatest}>Load latest and keep draft</button>
      <button type="button" className="rounded bg-overlay px-3 py-1" onClick={download}>Download draft</button>
    </div>}
    {status === "error" && <button type="button" className="rounded bg-overlay px-3 py-1 text-sm" onClick={() => { setNotice(""); void flush(); }}>Retry save</button>}
    {serverContentValid && initial !== null && <MaxEditor key={editorKey} initialContent={initial} editable={view.canEdit} onChange={change} pages={pageMap} navigate={onNavigate}
      uploadFile={async () => { setNotice("File uploads are not available in shared pages yet."); throw new Error("File uploads are not available in shared pages yet."); }}
      resolveFileUrl={async url => { try { const parsed = new URL(url); if (parsed.protocol === "https:") return url; } catch {} throw new Error("This shared file is unavailable."); }}
      onNotice={message => setNotice(message)} onEditImage={() => setNotice("Image editing is not available in shared pages yet.")}
      createSubpage={onCreateSubpage} createDatabase={async () => { setNotice("Databases are not available in shared pages yet."); return null; }}
      renderDatabase={() => <p className="text-sm text-fg-2">Databases are not available in shared pages yet.</p>} />}
  </div>;
}
