"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConvex } from "convex/react";
import { anyApi } from "convex/server";
import { CLOUD } from "@/lib/config";
import { OpError, toOpError } from "./errors";

/* Connectors and the marketplace (lib/domain/integrations.ts), client side. */

export interface AppListing {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  website: string | null;
  scopes: string[];
  events: string[];
  status: "private" | "submitted" | "published" | "rejected" | "suspended";
  installs: number;
  yours?: boolean;
  redirectUris?: string[];
  webhookUrl?: string | null;
  reviewNote?: string | null;
  clientId?: string;
  developer?: string;
}
export interface Installation {
  id: string;
  app: AppListing | null;
  scopes: string[];
  connected: boolean;
  installedBy: string;
  createdAt: number;
  lastUsedAt: number | null;
}

export const SCOPE_LABEL: Record<string, string> = {
  read_content: "Read pages and databases",
  write_content: "Create and edit pages and databases",
  read_comments: "Read comments",
  write_comments: "Write comments",
  read_people: "See people's names",
};
export const EVENT_LIST = ["page.created", "page.updated", "page.content_updated", "page.deleted", "record.created", "record.updated", "comment.created"];

const CHANGED = "max:apps-changed";

async function postLocal<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/local/apps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { result?: T; error?: { code: string; message: string } };
  if (!res.ok || json.error) throw new OpError((json.error ?? { code: "INTERNAL", message: "Max's server returned an unexpected response." }) as never);
  return json.result as T;
}

const useConvexIfCloud = CLOUD ? useConvex : () => null;

export function useAppsApi() {
  const convex = useConvexIfCloud();
  return useMemo(() => {
    const changed = () => window.dispatchEvent(new Event(CHANGED));
    return {
      read: <T,>(fn: string, args: Record<string, unknown> = {}): Promise<T> => (convex ? (convex.query(anyApi.integrations[fn], args).catch((e) => Promise.reject(toOpError(e))) as Promise<T>) : postLocal<T>({ fn, ...args })),
      call: async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
        const r = convex ? ((await convex.mutation(anyApi.integrations[fn], args).catch((e) => Promise.reject(toOpError(e)))) as T) : await postLocal<T>({ fn, ...args });
        changed();
        return r;
      },
    };
  }, [convex]);
}

/** A read that reloads after any app change made from this tab. */
export function useAppsRead<T>(fn: string, args: Record<string, unknown> | "skip") {
  const api = useAppsApi();
  const key = args === "skip" ? "skip" : JSON.stringify(args);
  const [state, setState] = useState<{ data?: T; error: OpError | null }>({ error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (key === "skip") return;
    let live = true;
    api.read<T>(fn, JSON.parse(key)).then((data) => live && setState({ data, error: null }), (error: OpError) => live && setState((s) => ({ data: s.data, error })));
    return () => {
      live = false;
    };
  }, [api, fn, key, tick]);
  useEffect(() => {
    window.addEventListener(CHANGED, reload);
    return () => window.removeEventListener(CHANGED, reload);
  }, [reload]);
  return { ...state, reload };
}
