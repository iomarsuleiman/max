"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const TERMINAL_ERRORS = new Set(["VALIDATION", "LIMIT", "READ_ONLY", "NOT_FOUND", "FORBIDDEN"]);

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
  const base = useRef<number | null>(serverRevision ?? null);
  const pending = useRef<unknown[] | null>(null);
  const inflight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const terminal = useRef(false);
  const unmounted = useRef(false);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    if (base.current === null && serverRevision !== undefined) base.current = serverRevision;
  }, [serverRevision]);

  const setSaveState = useCallback((next: SaveState) => {
    stateRef.current = next;
    if (!unmounted.current) setState(next);
  }, []);

  const persistDraft = useCallback(() => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    if (pending.current && base.current !== null) {
      writeLocal(draftKey(pageId), { baseRevision: base.current, blocks: pending.current, at: Date.now() } satisfies Draft);
    }
  }, [pageId]);

  const flush = useCallback(async (force = false): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (inflight.current || !pending.current || base.current === null) return;
    if (stateRef.current === "conflict" && !force) return;
    persistDraft();
    const blocks = pending.current;
    inflight.current = true;
    terminal.current = false;
    setSaveState(attempts.current ? "retrying" : "saving");
    try {
      const res = await call<{ revision: number }>("documents.save", { pageId, blocks, baseRevision: base.current, force });
      base.current = res.revision;
      attempts.current = 0;
      if (!unmounted.current) setError(null);
      if (pending.current === blocks) {
        pending.current = null;
        writeLocal(draftKey(pageId), null);
        setSaveState("saved");
        if (!unmounted.current) setLastSavedAt(Date.now());
      } else {
        persistDraft();
        setSaveState("unsaved");
      }
    } catch (err) {
      const e = err instanceof OpError ? err : new OpError({ code: "INTERNAL", message: String(err) });
      if (e.code === "CONFLICT") {
        terminal.current = true;
        setSaveState("conflict");
        if (!unmounted.current) setError(e.message);
      } else if (TERMINAL_ERRORS.has(e.code)) {
        terminal.current = true;
        setSaveState("error");
        if (!unmounted.current) setError(e.message);
      } else {
        attempts.current++;
        const offline = typeof navigator !== "undefined" && !navigator.onLine;
        setSaveState(offline ? "offline" : "error");
        if (!unmounted.current) setError(e.message);
        if (!unmounted.current) {
          const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts.current, 5));
          timer.current = setTimeout(() => void flush(), delay);
        }
      }
    } finally {
      inflight.current = false;
      const dirtyWhileInflight = pending.current !== null && pending.current !== blocks;
      if (dirtyWhileInflight && !terminal.current && stateRef.current !== "conflict" && !timer.current && attempts.current === 0) {
        if (unmounted.current) void flush();
        else timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
      }
    }
  }, [call, pageId, persistDraft, setSaveState]);

  const change = useCallback(
    (blocks: unknown[]) => {
      pending.current = blocks;
      terminal.current = false;
      // Coalesce synchronous JSON/localStorage work while the user is typing.
      if (!draftTimer.current) draftTimer.current = setTimeout(persistDraft, 150);
      if (stateRef.current !== "conflict") {
        setState((s) => {
          const next = s === "saving" || s === "retrying" ? s : "unsaved";
          stateRef.current = next;
          return next;
        });
      }
      if (timer.current) clearTimeout(timer.current);
      if (stateRef.current !== "conflict") timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush, persistDraft],
  );

  /** Remote content replaced the editor (after "Load latest"): adopt its revision, drop local edits. */
  const adopt = useCallback(
    (revision: number) => {
      base.current = revision;
      pending.current = null;
      terminal.current = false;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftTimer.current = null;
      attempts.current = 0;
      writeLocal(draftKey(pageId), null);
      setError(null);
      setSaveState("saved");
    },
    [pageId, setSaveState],
  );

  const readDraft = useCallback((): Draft | null => readLocal<Draft | null>(draftKey(pageId), null), [pageId]);
  const discardDraft = useCallback(() => writeLocal(draftKey(pageId), null), [pageId]);
  const hasPending = useCallback(() => !!pending.current, []);
  const baseRevision = useCallback(() => base.current, []);
  const keepMine = useCallback(() => flush(true), [flush]);

  // Retry right away when the connection returns; warn before closing with unsaved work.
  useEffect(() => {
    const online = () => {
      if (pending.current && !terminal.current) {
        attempts.current = 0;
        void flush();
      }
    };
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (pending.current || inflight.current) {
        persistDraft();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") persistDraft(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [flush, persistDraft]);

  // Leaving the page: send what's pending (the draft stays on this device until it's acknowledged).
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      persistDraft();
      if (pending.current && !terminal.current && stateRef.current !== "conflict") void flush();
    };
  }, [flush, persistDraft]);

  return useMemo(
    () => ({
      state,
      error,
      lastSavedAt,
      change,
      flush,
      adopt,
      readDraft,
      discardDraft,
      hasPending,
      baseRevision,
      keepMine,
    }),
    [state, error, lastSavedAt, change, flush, adopt, readDraft, discardDraft, hasPending, baseRevision, keepMine],
  );
}
