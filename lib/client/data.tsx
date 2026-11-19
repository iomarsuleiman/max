"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
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

/**
 * Inside a page someone shared with you, every operation goes through the sharing endpoint,
 * scoped to that page (the server checks your level on each call). Outside, nothing changes.
 */
export interface ShareScopeValue {
  pageId: string;
  linkToken: string | null;
}
const ShareScopeContext = createContext<ShareScopeValue | null>(null);
export function ShareScope({ value, children }: { value: ShareScopeValue | null; children: ReactNode }) {
  return <ShareScopeContext.Provider value={value}>{children}</ShareScopeContext.Provider>;
}
export const useShareScope = () => useContext(ShareScopeContext);

const keyOf = (op: string, args: Args, scope?: ShareScopeValue | null) => `${scope ? `shared:${scope.pageId}:${scope.linkToken ?? ""}:` : ""}${op}:${JSON.stringify(args)}`;

/* ── Local mode: a small subscription cache over /api/local/ops ───────────── */

interface Entry {
  op: string;
  args: Args;
  scope: ShareScopeValue | null;
  /** Overrides the default fetch (sharing endpoints that aren't page operations). */
  fetcher?: () => Promise<unknown>;
  data: unknown;
  error: OpError | null;
  loading: boolean;
  inflight: Promise<void> | null;
  dirty: boolean;
  subs: Set<() => void>;
  snapshot: QueryState<unknown>;
}
const cache = new Map<string, Entry>();

async function post(op: string, args: Args, kind: "query" | "mutation", scope?: ShareScopeValue | null) {
  const res = scope
    ? await fetch("/api/local/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fn: kind, scopePageId: scope.pageId, linkToken: scope.linkToken, op, args }) })
    : await fetch("/api/local/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, args, kind }) });
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
  e.inflight = (e.fetcher ? e.fetcher() : post(e.op, e.args, "query", e.scope))
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

function entry(op: string, args: Args, scope: ShareScopeValue | null = null): Entry {
  const key = keyOf(op, args, scope);
  let e = cache.get(key);
  if (!e) {
    e = { op, args, scope, data: undefined, error: null, loading: false, inflight: null, dirty: false, subs: new Set(), snapshot: { data: undefined, error: null, isLoading: true } };
    cache.set(key, e);
  }
  return e;
}

const SKIPPED: QueryState<never> = { data: undefined, error: null, isLoading: false };

function useOpLocal<T>(op: string, args: Args | "skip"): QueryState<T> {
  const scope = useShareScope();
  const key = args === "skip" ? null : keyOf(op, args, scope);
  const e = useMemo(() => (args === "skip" ? null : entry(op, args, scope)), [key]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const scope = useShareScope();
  return useCallback(
    async <T,>(op: string, args: Args = {}): Promise<T> => {
      try {
        const result = (await post(op, args, "mutation", scope)) as T;
        await invalidateLocal();
        return result;
      } catch (err) {
        throw toOpError(err);
      }
    },
    [scope],
  );
}

/** Reads a query once without subscribing (used for exports and lookups). */
function useReadLocal() {
  const scope = useShareScope();
  return useCallback(
    async <T,>(op: string, args: Args = {}): Promise<T> => {
      try {
        return (await post(op, args, "query", scope)) as T;
      } catch (err) {
        throw toOpError(err);
      }
    },
    [scope],
  );
}

/* ── Cloud mode: Convex reactive queries ─────────────────────────────────── */

function useOpCloud<T>(op: string, args: Args | "skip"): QueryState<T> {
  const scope = useShareScope();
  const argKey = args === "skip" ? "skip" : JSON.stringify(args);
  const scopeKey = scope ? `${scope.pageId}:${scope.linkToken ?? ""}` : "";
  const queries = useMemo(() => {
    if (argKey === "skip") return {};
    const parsed = JSON.parse(argKey);
    if (!scopeKey) return { q: { query: anyApi.ops.query, args: { op, args: parsed } } };
    const [scopePageId, linkToken] = scopeKey.split(":");
    return { q: { query: anyApi.sharing.query, args: { scopePageId, op, args: parsed, linkToken: linkToken || null } } };
  }, [op, argKey, scopeKey]);
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
  const scope = useShareScope();
  return useCallback(
    async <T,>(op: string, args: Args = {}): Promise<T> => {
      try {
        if (scope) return (await convex.mutation(anyApi.sharing.mutation, { scopePageId: scope.pageId, linkToken: scope.linkToken, op, args })) as T;
        return (await convex.mutation(anyApi.ops.mutation, { op, args })) as T;
      } catch (err) {
        throw toOpError(err);
      }
    },
    [convex, scope],
  );
}

function useReadCloud() {
  const convex = useConvex();
  const scope = useShareScope();
  return useCallback(
    async <T,>(op: string, args: Args = {}): Promise<T> => {
      try {
        if (scope) return (await convex.query(anyApi.sharing.query, { scopePageId: scope.pageId, linkToken: scope.linkToken, op, args })) as T;
        return (await convex.query(anyApi.ops.query, { op, args })) as T;
      } catch (err) {
        throw toOpError(err);
      }
    },
    [convex, scope],
  );
}

/* ── Sharing endpoints that aren't page operations (access, shared-with-me, presence) ── */

type SharingFn = "access" | "withMe" | "here";
const sharingKey = (fn: SharingFn, args: Args) => `sharing:${fn}:${JSON.stringify(args)}`;
const sharingCache = new Map<string, Entry>();

async function postSharing(body: Record<string, unknown>) {
  const res = await fetch("/api/local/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { code: string; message: string } };
  if (!res.ok || json.error) throw new OpError((json.error ?? { code: "INTERNAL", message: "Max's server returned an unexpected response." }) as never);
  return json.result;
}

function useSharingLocal<T>(fn: SharingFn, args: Args | "skip"): QueryState<T> {
  const key = args === "skip" ? null : sharingKey(fn, args);
  const e = useMemo(() => {
    if (args === "skip" || !key) return null;
    let found = sharingCache.get(key);
    if (!found) {
      found = { op: fn, args, scope: null, fetcher: () => postSharing({ fn, ...args }), data: undefined, error: null, loading: false, inflight: null, dirty: false, subs: new Set(), snapshot: { data: undefined, error: null, isLoading: true } };
      // Reuse the ops cache's refresh machinery: register under the same map so invalidateLocal refreshes it.
      cache.set(key, found);
      sharingCache.set(key, found);
    }
    return found;
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!e) return () => {};
      e.subs.add(cb);
      if (e.data === undefined && !e.inflight) void load(e);
      return () => e.subs.delete(cb);
    },
    [e],
  );
  return useSyncExternalStore(subscribe, () => (e ? e.snapshot : SKIPPED), () => (e ? e.snapshot : SKIPPED)) as QueryState<T>;
}

function useSharingCloud<T>(fn: SharingFn, args: Args | "skip"): QueryState<T> {
  const argKey = args === "skip" ? "skip" : JSON.stringify(args);
  const queries = useMemo(() => (argKey === "skip" ? {} : { q: { query: anyApi.sharing[fn === "withMe" ? "withMe" : fn], args: JSON.parse(argKey) } }), [fn, argKey]);
  const result = useQueries(queries as never) as { q?: unknown };
  if (args === "skip") return SKIPPED;
  const raw = result.q;
  if (raw instanceof Error) return { data: undefined, error: toOpError(raw), isLoading: false };
  if (raw === undefined) return { data: undefined, error: null, isLoading: true };
  return { data: raw as T, error: null, isLoading: false };
}

/** Reads a sharing endpoint: "access" (your level on a page), "withMe" (pages shared with you), "here" (who's on a page). */
export const useSharing: <T = unknown>(fn: SharingFn, args: Args | "skip") => QueryState<T> = CLOUD ? useSharingCloud : useSharingLocal;

function usePresencePingCloud() {
  const convex = useConvex();
  return useCallback(
    async (pageId: string, linkToken: string | null) => {
      try {
        await convex.mutation(anyApi.sharing.ping, { pageId, linkToken });
      } catch {
        // Presence is best effort.
      }
    },
    [convex],
  );
}

function usePresencePingLocal() {
  return useCallback(async (pageId: string, linkToken: string | null) => {
    try {
      await postSharing({ fn: "ping", pageId, linkToken });
    } catch {
      // Presence is best effort.
    }
  }, []);
}

/** Tells everyone else on the page you're here (heartbeat). */
export const usePresencePing: () => (pageId: string, linkToken: string | null) => Promise<void> = CLOUD ? usePresencePingCloud : usePresencePingLocal;

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
