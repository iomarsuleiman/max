"use client";

import { useCallback, useMemo } from "react";
import { useConvex } from "convex/react";
import { anyApi } from "convex/server";
import { CLOUD } from "@/lib/config";
import { OpError, toOpError } from "./errors";

export interface AdminUser {
  id: string;
  name: string | null;
  email: string | null;
  joinedAt: number | null;
  lastActive: number | null;
  pages: number;
  databases: number;
  rows: number;
  trashed: number;
  sites: number;
  shares: number;
  status: "active" | "suspended" | "banned";
  reason: string | null;
}
export interface AdminOverview {
  totals: { users: number; activeThisWeek: number; newThisWeek: number; pages: number; databases: number; sites: number; suspended: number; openReports: number };
  users: AdminUser[];
}
export interface Report {
  _id: string;
  reporterName: string | null;
  reporterEmail: string | null;
  kind: "bug" | "content" | "other";
  message: string;
  url: string | null;
  pageId: string | null;
  siteSlug: string | null;
  status: "open" | "resolved";
  createdAt: number;
}
export type ReportInput = { kind: Report["kind"]; message: string; url?: string | null; pageId?: string | null; siteSlug?: string | null };

export interface AdminApi {
  check(): Promise<{ admin: boolean }>;
  overview(): Promise<AdminOverview>;
  reports(): Promise<{ reports: Report[] }>;
  setStatus(userId: string, status: AdminUser["status"], reason: string): Promise<unknown>;
  setReport(id: string, status: Report["status"]): Promise<unknown>;
  report(input: ReportInput): Promise<unknown>;
}

function useAdminCloud(): AdminApi {
  const convex = useConvex();
  return useMemo(() => {
    const q = <T,>(fn: string, a: Record<string, unknown> = {}) => convex.query(anyApi.admin[fn], a).catch((e) => Promise.reject(toOpError(e))) as Promise<T>;
    const m = <T,>(fn: string, a: Record<string, unknown>) => convex.mutation(anyApi.admin[fn], a).catch((e) => Promise.reject(toOpError(e))) as Promise<T>;
    return {
      check: () => q("check"),
      overview: () => q("overview", { at: Math.floor(Date.now() / 60_000) * 60_000 }),
      reports: () => q("reports"),
      setStatus: (userId, status, reason) => m("setStatus", { userId, status, reason }),
      setReport: (id, status) => m("setReport", { id, status }),
      report: (input) => m("report", input),
    };
  }, [convex]);
}

async function postAdmin<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/local/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { result?: T; error?: { code: string; message: string } };
  if (!res.ok || json.error) throw new OpError((json.error ?? { code: "INTERNAL", message: "Max's server returned an unexpected response." }) as never);
  return json.result as T;
}

function useAdminLocal(): AdminApi {
  return useMemo(
    () => ({
      check: () => postAdmin({ fn: "check" }),
      overview: () => postAdmin({ fn: "overview" }),
      reports: () => postAdmin({ fn: "reports" }),
      setStatus: (userId, status, reason) => postAdmin({ fn: "setStatus", userId, status, reason }),
      setReport: (id, status) => postAdmin({ fn: "setReport", id, status }),
      report: (input) => postAdmin({ fn: "report", ...input }),
    }),
    [],
  );
}

/** The admin dashboard's server calls (each checks you're an admin) and the report form's. */
export const useAdminApi: () => AdminApi = CLOUD ? useAdminCloud : useAdminLocal;

/** Sends a report from anywhere: in the app, or on a published page or site. */
export function useReport() {
  const api = useAdminApi();
  return useCallback((input: ReportInput) => api.report(input), [api]);
}
