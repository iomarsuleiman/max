"use client";

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useConvex, useQueries } from "convex/react";
import { anyApi } from "convex/server";
import { CLOUD } from "@/lib/config";
import { OpError, toOpError } from "./errors";

export interface QueryState<T> {
  data: T | undefined;
  error: OpError | null;
  isLoading: boolean;
}

type Args = Record<string, unknown>;
const keyOf = (op: string, args: Args) => `${op}:${JSON.stringify(args)}`;

/* ── Local mode: a small subscription cache over /api/local/ops ───────────── */

interface Entry {
  op: string;
  args: Args;
  data: unknown;
  error: OpError | null;
  loading: boolean;
  inflight: Promise<void> | null;
  dirty: boolean;
  subs: Set<() => void>;
  snapshot: QueryState<unknown>;
}
const cache = new Map<string, Entry>();

async function post(op: string, args: Args, kind: "query" | "mutation") {
  const res = await fetch("/api/local/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, args, kind }) });
  let body: { result?: unknown; error?: { code: string; message: string } };
  try {
    body = await res.json();
  } catch {
    throw new OpError({ code: "INTERNAL", message: "Max's server returned an unexpected response. Try again." });
  }
  if (!res.ok || body.error) throw new OpError(body.error as never);
  return body.result;
}

function publish(e: Entry) {
  e.snapshot = { data: e.data, error: e.error, isLoading: e.loading && e.data === undefined };
  e.subs.forEach((fn) => fn());
}

function load(e: Entry) {
  if (e.inflight) {
    e.dirty = true;
    return e.inflight;
  }
  e.loading = true;
  e.dirty = false;
  e.inflight = post(e.op, e.args, "query")
    .then((data) => {
      e.data = data;
      e.error = null;
    })
    .catch((err) => {
      e.error = toOpError(err);
    })
    .finally(() => {
      e.loading = false;
      e.inflight = null;
      publish(e);
      if (e.dirty && e.subs.size) void load(e);
    });
  return e.inflight;
}

let invalidatePromise: Promise<void> | null = null;
/** Refetches every watched query. Resolves once fresh data is in (like Convex's mutation guarantee). */
export function invalidateLocal(): Promise<void> {
  if (invalidatePromise) return invalidatePromise;
  invalidatePromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      invalidatePromise = null;
      const loads: Promise<void>[] = [];
      for (const [key, e] of cache) {
        if (e.subs.size) loads.push(load(e));
        else cache.delete(key);
      }
      void Promise.all(loads).then(() => resolve());
    }, 15);
  });
  return invalidatePromise;
}

function entry(op: string, args: Args): Entry {
  const key = keyOf(op, args);
  let e = cache.get(key);
  if (!e) {
    e = { op, args, data: undefined, error: null, loading: false, inflight: null, dirty: false, subs: new Set(), snapshot: { data: undefined, error: null, isLoading: true } };
    cache.set(key, e);
  }
  return e;
}

const SKIPPED: QueryState<never> = { data: undefined, error: null, isLoading: false };

function useOpLocal<T>(op: string, args: Args | "skip"): QueryState<T> {
  const key = args === "skip" ? null : keyOf(op, args);
  const e = useMemo(() => (args === "skip" ? null : entry(op, args)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const subscribe = useCallback(
    (fn: () => void) => {
      if (!e) return () => {};
      e.subs.add(fn);
      if (e.data === undefined && !e.inflight) void load(e);
      return () => e.subs.delete(fn);
    },
    [e],
  );
  return useSyncExternalStore(subscribe, () => (e ? e.snapshot : SKIPPED), () => (e ? e.snapshot : SKIPPED)) as QueryState<T>;
}

/** Warms a query (e.g. on hover) so navigation shows content immediately. */
export function prefetchOp(op: string, args: Args) {
  if (CLOUD) return;
  const e = entry(op, args);
  if (e.data === undefined && !e.inflight) void load(e);
}

function useCallLocal() {
  return useCallback(async <T,>(op: string, args: Args = {}): Promise<T> => {
    try {
      const result = (await post(op, args, "mutation")) as T;
      await invalidateLocal();
      return result;
    } catch (err) {
      throw toOpError(err);
    }
  }, []);
}

/** Reads a query once without subscribing (used for exports and lookups). */
function useReadLocal() {
  return useCallback(async <T,>(op: string, args: Args = {}): Promise<T> => {
    try {
      return (await post(op, args, "query")) as T;
    } catch (err) {
      throw toOpError(err);
    }
  }, []);
}

/* ── Cloud mode: Convex reactive queries ─────────────────────────────────── */

function useOpCloud<T>(op: string, args: Args | "skip"): QueryState<T> {
  const argKey = args === "skip" ? "skip" : JSON.stringify(args);
  const queries = useMemo(() => (argKey === "skip" ? {} : { q: { query: anyApi.ops.query, args: { op, args: JSON.parse(argKey) } } }), [op, argKey]);
  const result = useQueries(queries as never) as { q?: unknown };
  const last = useRef<{ data: unknown; key: string } | null>(null);
  if (args === "skip") return SKIPPED;
  const raw = result.q;
  if (raw instanceof Error) return { data: last.current?.data as T | undefined, error: toOpError(raw), isLoading: false };
  if (raw === undefined) return { data: undefined, error: null, isLoading: true };
  last.current = { data: raw, key: op };
  return { data: raw as T, error: null, isLoading: false };
}

function useCallCloud() {
  const convex = useConvex();
  return useCallback(
    async <T,>(op: string, args: Args = {}): Promise<T> => {
      try {
        return (await convex.mutation(anyApi.ops.mutation, { op, args })) as T;
      } catch (err) {
        throw toOpError(err);
      }
    },
    [convex],
  );
}

function useReadCloud() {
  const convex = useConvex();
  return useCallback(
    async <T,>(op: string, args: Args = {}): Promise<T> => {
      try {
        return (await convex.query(anyApi.ops.query, { op, args })) as T;
      } catch (err) {
        throw toOpError(err);
      }
    },
    [convex],
  );
}

/* ── Public hooks (mode is fixed per build, so hook order is stable) ───────── */

export const useOp: <T = unknown>(op: string, args: Args | "skip") => QueryState<T> = CLOUD ? useOpCloud : useOpLocal;
export const useCall: () => <T = unknown>(op: string, args?: Args) => Promise<T> = CLOUD ? useCallCloud : useCallLocal;
export const useRead: () => <T = unknown>(op: string, args?: Args) => Promise<T> = CLOUD ? useReadCloud : useReadLocal;

/** Local mode: refresh when another tab or a connected assistant changes something. */
export function useLocalLiveUpdates() {
  useEffect(() => {
    if (CLOUD) return;
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      source = new EventSource("/api/local/events");
      source.onmessage = (ev) => {
        try {
          if (JSON.parse(ev.data).op !== "hello") void invalidateLocal();
        } catch {}
      };
      source.onerror = () => {
        source?.close();
        retry = setTimeout(connect, 3000);
      };
    };
    connect();
    const onFocus = () => void invalidateLocal();
    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onFocus);
    return () => {
      source?.close();
      clearTimeout(retry);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onFocus);
    };
  }, []);
}
