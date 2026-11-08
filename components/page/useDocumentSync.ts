"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useCall } from "@/lib/client/data";
import { OpError } from "@/lib/client/errors";
import { readLocal, writeLocal } from "@/lib/client/storage";

export type SaveState = "saved" | "unsaved" | "saving" | "retrying" | "offline" | "error" | "conflict";

interface Draft {
  baseRevision: number;
  blocks: unknown[];
  at: number;
}

const DEBOUNCE_MS = 650;
const draftKey = (pageId: string) => `draft:${pageId}`;

/**
 * Autosave with truthful status: a change is "Saved" only after the server acknowledges it.
 * Unsent edits are mirrored to this device so a refresh, crash or lost connection never loses them.
 * Revisions guard against overwriting edits made in another tab or by an assistant.
 */
export function useDocumentSync(pageId: string, serverRevision: number | undefined) {
  const call = useCall();
  const [state, setState] = useState<SaveState>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const base = useRef<number | null>(null);
  const pending = useRef<unknown[] | null>(null);
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  if (base.current === null && serverRevision !== undefined) base.current = serverRevision;

  const flush = useCallback(async (force = false): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current || !pending.current || base.current === null) return;
    if (stateRef.current === "conflict" && !force) return;
    const blocks = pending.current;
    inflight.current = true;
    setState(attempts.current ? "retrying" : "saving");
    try {
      const res = await call<{ revision: number }>("documents.save", { pageId, blocks, baseRevision: base.current, force });
      base.current = res.revision;
      attempts.current = 0;
      setError(null);
      if (pending.current === blocks) {
        pending.current = null;
        writeLocal(draftKey(pageId), null);
        setState("saved");
        setLastSavedAt(Date.now());
      } else {
        setState("unsaved");
      }
    } catch (err) {
      const e = err instanceof OpError ? err : new OpError({ code: "INTERNAL", message: String(err) });
      if (e.code === "CONFLICT") {
        setState("conflict");
        setError(e.message);
      } else if (e.code === "VALIDATION" || e.code === "LIMIT" || e.code === "READ_ONLY" || e.code === "NOT_FOUND") {
        setState("error");
        setError(e.message);
      } else {
        attempts.current++;
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setState(offline ? "offline" : "error");
        setError(e.message);
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts.current, 5));
        timer.current = setTimeout(() => void flush(), delay);
      }
    } finally {
      inflight.current = false;
      if (pending.current && stateRef.current !== "conflict" && pending.current !== null && !timer.current && attempts.current === 0) {
        timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
      }
    }
  }, [call, pageId]);

  const change = useCallback(
    (blocks: unknown[]) => {
      pending.current = blocks;
      if (base.current !== null) writeLocal(draftKey(pageId), { baseRevision: base.current, blocks, at: Date.now() } satisfies Draft);
      if (stateRef.current !== "conflict") setState((s) => (s === "saving" || s === "retrying" ? s : "unsaved"));
      if (timer.current) clearTimeout(timer.current);
      if (stateRef.current !== "conflict") timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush, pageId],
  );

  /** Remote content replaced the editor (after "Load latest"): adopt its revision, drop local edits. */
  const adopt = useCallback(
    (revision: number) => {
      base.current = revision;
      pending.current = null;
      attempts.current = 0;
      writeLocal(draftKey(pageId), null);
      setError(null);
      setState("saved");
    },
    [pageId],
  );

  const readDraft = useCallback((): Draft | null => readLocal<Draft | null>(draftKey(pageId), null), [pageId]);
  const discardDraft = useCallback(() => writeLocal(draftKey(pageId), null), [pageId]);

  // Retry right away when the connection returns; warn before closing with unsaved work.
  useEffect(() => {
    const online = () => {
      if (pending.current) {
        attempts.current = 0;
        void flush();
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inflight.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [flush]);

  // Leaving the page: send what's pending (the draft stays on this device until it's acknowledged).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current && stateRef.current !== "conflict") void flush();
    },
    [flush],
  );

  return {
    state,
    error,
    lastSavedAt,
    change,
    flush,
    adopt,
    readDraft,
    discardDraft,
    hasPending: () => !!pending.current,
    baseRevision: () => base.current,
    keepMine: () => flush(true),
  };
}
