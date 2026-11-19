"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useConvex, useQueries } from "convex/react";
import { anyApi } from "convex/server";
import { wsArgs } from "./workspace";
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
  /** A page published to the web, read by a visitor without an account. */
  anonymous?: boolean;
  /** A page on a published website (the site's address); read without an account. */
  site?: string;
}
const ShareScopeContext = createContext<ShareScopeValue | null>(null);
export function ShareScope({ value, children }: { value: ShareScopeValue | null; children: ReactNode }) {
  return <ShareScopeContext.Provider value={value}>{children}</ShareScopeContext.Provider>;
}
export const useShareScope = () => useContext(ShareScopeContext);

const keyOf = (op: string, args: Args, scope?: ShareScopeValue | null) => `${scope ? (scope.site ? `site:${scope.site}:` : `shared:${scope.anonymous ? "web:" : ""}${scope.pageId}:${scope.linkToken ?? ""}:`) : ""}${op}:${JSON.stringify(args)}`;

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
  const res = scope?.site
    ? await fetch("/api/local/sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fn: "read", slug: scope.site, op, args }) })
    : scope?.anonymous
    ? await fetch("/api/local/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fn: "public", token: scope.linkToken, scopePageId: scope.pageId, op, args }) })
    : scope
    ? await fetch("/api/local/sharing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fn: kind, scopePageId: scope.pageId, linkToken: scope.linkToken, op, args }) })
    : await fetch("/api/local/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, args, kind, ...wsArgs() }) });
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
  const scopeKey = scope ? (scope.site ? `site:${scope.site}:` : `${scope.anonymous ? "web" : "in"}:${scope.pageId}:${scope.linkToken ?? ""}`) : "";
  const queries = useMemo(() => {
    if (argKey === "skip") return {};
    const parsed = JSON.parse(argKey);
    if (!scopeKey) return { q: { query: anyApi.ops.query, args: { op, args: parsed, ...wsArgs() } } };
    const [mode, scopePageId, linkToken] = scopeKey.split(":");
    if (mode === "site") return { q: { query: anyApi.sites.read, args: { slug: scopePageId, op, args: parsed } } };
    if (mode === "web") return { q: { query: anyApi.sharing.publicQuery, args: { token: linkToken, scopePageId, op, args: parsed } } };
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
        return (await convex.mutation(anyApi.ops.mutation, { op, args, ...wsArgs() })) as T;
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
        if (scope?.site) return (await convex.query(anyApi.sites.read, { slug: scope.site, op, args })) as T;
        if (scope?.anonymous) return (await convex.query(anyApi.sharing.publicQuery, { token: scope.linkToken, scopePageId: scope.pageId, op, args })) as T;
        if (scope) return (await convex.query(anyApi.sharing.query, { scopePageId: scope.pageId, linkToken: scope.linkToken, op, args })) as T;
        return (await convex.query(anyApi.ops.query, { op, args, ...wsArgs() })) as T;
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

function useDuplicateSharedCloud() {
  const convex = useConvex();
  return useCallback(
    async (pageId: string, linkToken: string | null) => {
      try {
        return (await convex.mutation(anyApi.sharing.duplicate, { pageId, linkToken })) as { id: string; title: string; copied: number };
      } catch (err) {
        throw toOpError(err);
      }
    },
    [convex],
  );
}

function useDuplicateSharedLocal() {
  return useCallback(async (pageId: string, linkToken: string | null) => {
    const result = (await postSharing({ fn: "duplicate", pageId, linkToken })) as { id: string; title: string; copied: number };
    await invalidateLocal();
    return result;
  }, []);
}

function useJoinSharedCloud() {
  const convex = useConvex();
  return useCallback(
    async (pageId: string, linkToken: string | null) => {
      try {
        return (await convex.mutation(anyApi.sharing.join, { pageId, linkToken })) as { pageId: string; title: string; teamspace: boolean; joined: boolean };
      } catch (err) {
        throw toOpError(err);
      }
    },
    [convex],
  );
}

function useJoinSharedLocal() {
  return useCallback(async (pageId: string, linkToken: string | null) => {
    const result = (await postSharing({ fn: "join", pageId, linkToken })) as { pageId: string; title: string; teamspace: boolean; joined: boolean };
    await invalidateLocal();
    return result;
  }, []);
}

/** Accepts a link as an invitation: the page or teamspace joins your sidebar. */
export const useJoinShared: () => (pageId: string, linkToken: string | null) => Promise<{ pageId: string; title: string; teamspace: boolean; joined: boolean }> = CLOUD ? useJoinSharedCloud : useJoinSharedLocal;

function useLeaveSharedCloud() {
  const convex = useConvex();
  return useCallback(
    async (pageId: string) => {
      try {
        await convex.mutation(anyApi.sharing.leave, { pageId });
      } catch (err) {
        throw toOpError(err);
      }
    },
    [convex],
  );
}

function useLeaveSharedLocal() {
  return useCallback(async (pageId: string) => {
    await postSharing({ fn: "leave", pageId });
    await invalidateLocal();
  }, []);
}

/** Leaves a page or teamspace someone shared with you. */
export const useLeaveShared: () => (pageId: string) => Promise<void> = CLOUD ? useLeaveSharedCloud : useLeaveSharedLocal;

/** Copies a page shared with you (or published) into your own workspace. */
export const useDuplicateShared: () => (pageId: string, linkToken: string | null) => Promise<{ id: string; title: string; copied: number }> = CLOUD ? useDuplicateSharedCloud : useDuplicateSharedLocal;

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

/* ── Live co-editing transport (lib/domain/collab.ts) ───────────────────────── */

export interface CollabJoin {
  roomId: string;
  epoch: number;
  ready: boolean;
  seed: boolean;
  revision: number;
  canEdit: boolean;
}
export interface CollabPull {
  epoch: number;
  ready: boolean;
  head: number;
  updates: { seq: number; data: string }[];
  awareness: { clientId: string; data: string; at: number }[];
}
export interface CollabTransport {
  join(a: { pageId: string; clientId: string }): Promise<CollabJoin>;
  pull(a: { roomId: string; afterSeq: number }): Promise<CollabPull>;
  push(a: { roomId: string; epoch: number; clientId: string; data: string; seedRevision?: number }): Promise<{ seq: number }>;
  awareness(a: { roomId: string; epoch: number; clientId: string; data: string }): Promise<unknown>;
  commit(a: { roomId: string; epoch: number; clientId: string; blocks: unknown[]; state?: string; upTo?: number }): Promise<{ revision: number; compacted: boolean }>;
  leave(a: { roomId: string; clientId: string }): Promise<unknown>;
  /** Calls `onData` whenever the room has updates after `afterSeq()` or cursors change. */
  watch(roomId: string, afterSeq: () => number, onData: (r: CollabPull) => void, onError: (e: OpError) => void): () => void;
}

function useCollabTransportCloud(linkToken: string | null): CollabTransport {
  const convex = useConvex();
  return useMemo(() => {
    const m = <T,>(fn: string, a: Record<string, unknown>) => convex.mutation(anyApi.collab[fn], { ...a, linkToken }).catch((e) => Promise.reject(toOpError(e))) as Promise<T>;
    return {
      join: (a) => m("join", a),
      pull: (a) => convex.query(anyApi.collab.pull, { ...a, linkToken }).catch((e) => Promise.reject(toOpError(e))) as Promise<CollabPull>,
      push: (a) => m("push", a),
      awareness: (a) => m("awareness", a),
      commit: (a) => m("commit", a),
      leave: (a) => m("leave", a),
      watch(roomId, afterSeq, onData, onError) {
        // A reactive subscription from the last update we have; moved forward as updates arrive.
        let stop = () => {};
        let closed = false;
        let at = -1;
        const subscribe = () => {
          if (closed) return;
          at = afterSeq();
          const watch = convex.watchQuery(anyApi.collab.pull, { roomId, afterSeq: at, linkToken });
          const deliver = () => {
            let r: CollabPull | undefined;
            try {
              r = watch.localQueryResult() as CollabPull | undefined;
            } catch (err) {
              onError(toOpError(err));
              return;
            }
            if (!r) return;
            onData(r);
            if (afterSeq() !== at) {
              stop();
              subscribe();
            }
          };
          stop = watch.onUpdate(deliver);
          deliver();
        };
        subscribe();
        return () => {
          closed = true;
          stop();
        };
      },
    };
  }, [convex, linkToken]);
}

function useCollabTransportLocal(linkToken: string | null): CollabTransport {
  return useMemo(() => {
    const call = <T,>(c: string, args: Record<string, unknown>) => postSharing({ fn: "collab", call: c, args, linkToken }) as Promise<T>;
    return {
      join: (a) => call("join", a),
      pull: (a) => call("pull", a),
      push: (a) => call("push", a),
      awareness: (a) => call("awareness", a),
      commit: (a) => call("commit", a),
      leave: (a) => call("leave", a),
      watch(roomId, afterSeq, onData, onError) {
        // Local mode polls; it exists for trying sharing on one machine and for tests.
        let closed = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tick = async () => {
          try {
            const r = await call<CollabPull>("pull", { roomId, afterSeq: afterSeq() });
            if (!closed) onData(r);
          } catch (err) {
            if (!closed) onError(err as OpError);
          }
          if (!closed) timer = setTimeout(tick, 250);
        };
        void tick();
        return () => {
          closed = true;
          clearTimeout(timer);
        };
      },
    };
  }, [linkToken]);
}

/** Talks to a shared page's live room. */
export const useCollabTransport: (linkToken: string | null) => CollabTransport = CLOUD ? useCollabTransportCloud : useCollabTransportLocal;

/* ── Published websites (lib/domain/sites.ts) ─────────────────────────────── */

export interface SiteNav {
  site: { slug: string; name: string; icon: string | null; description: string; search: boolean; rootId: string };
  nav: { _id: string; title: string; icon: string | null; kind: "page" | "database"; parentId: string | null }[];
}

function useSiteNavCloud(slug: string): QueryState<SiteNav> {
  const queries = useMemo(() => ({ q: { query: anyApi.sites.nav, args: { slug } } }), [slug]);
  const raw = (useQueries(queries as never) as { q?: unknown }).q;
  if (raw instanceof Error) return { data: undefined, error: toOpError(raw), isLoading: false };
  if (raw === undefined) return { data: undefined, error: null, isLoading: true };
  return { data: raw as SiteNav, error: null, isLoading: false };
}

async function postSite(body: Record<string, unknown>) {
  const res = await fetch("/api/local/sites", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { result?: unknown; error?: { code: string; message: string } };
  if (!res.ok || json.error) throw new OpError((json.error ?? { code: "INTERNAL", message: "Max's server returned an unexpected response." }) as never);
  return json.result;
}

function useSiteNavLocal(slug: string): QueryState<SiteNav> {
  const [state, setState] = useState<QueryState<SiteNav>>({ data: undefined, error: null, isLoading: true });
  useEffect(() => {
    let live = true;
    postSite({ fn: "nav", slug })
      .then((data) => live && setState({ data: data as SiteNav, error: null, isLoading: false }))
      .catch((error) => live && setState({ data: undefined, error, isLoading: false }));
    return () => {
      live = false;
    };
  }, [slug]);
  return state;
}

/** A website's details and navigation, for visitors. */
export const useSiteNav: (slug: string) => QueryState<SiteNav> = CLOUD ? useSiteNavCloud : useSiteNavLocal;

function useSiteSearchCloud() {
  const convex = useConvex();
  return useCallback((slug: string, q: string) => convex.query(anyApi.sites.search, { slug, q }) as Promise<{ results: { _id: string; title: string; icon: string | null; excerpt: string }[] }>, [convex]);
}
function useSiteSearchLocal() {
  return useCallback((slug: string, q: string) => postSite({ fn: "search", slug, q }) as Promise<{ results: { _id: string; title: string; icon: string | null; excerpt: string }[] }>, []);
}
/** Searches a website's pages. */
export const useSiteSearch: () => (slug: string, q: string) => Promise<{ results: { _id: string; title: string; icon: string | null; excerpt: string }[] }> = CLOUD ? useSiteSearchCloud : useSiteSearchLocal;
