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
  /** People who joined Max through their invite link (a count, never who). */
  invited: number;
  workspaces: number;
  organizations: number;
  /** Organizations switched on for this account (they start off). */
  orgsOn: boolean;
  status: "active" | "suspended" | "banned";
  reason: string | null;
}
export type Standing = "active" | "suspended" | "banned";
export interface AdminOverview {
  totals: {
    users: number;
    activeThisWeek: number;
    newThisWeek: number;
    organizations: number;
    activeOrganizations: number;
    orgMembers: number;
    pendingInvites: number;
    sites: number;
    suspended: number;
    suspendedOrgs: number;
    openReports: number;
    failuresThisWeek: number;
    truncated: boolean;
  };
  trends: { signups: { weekStart: number; count: number }[]; organizations: { weekStart: number; count: number }[] };
  incidents: { what: string; count: number }[];
}
export interface AdminOrgRow {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  createdAt: number;
  updatedAt: number;
  owner: { id: string; name: string | null; email: string | null } | null;
  members: number;
  admins: number;
  guests: number;
  pendingInvites: number;
  maxMembers: number | null;
  status: Standing;
  reason: string | null;
}
export interface AuditEvent {
  _id: string;
  ownerId: string;
  scopeName?: string;
  actorId: string;
  actorName: string | null;
  action: string;
  targetId: string | null;
  detail: string | null;
  at: number;
}
export interface AdminOrgDetail {
  org: { id: string; name: string; slug: string; icon: string | null; description: string; createdAt: number; updatedAt: number; createdBy: string; policies: Record<string, boolean>; maxMembers: number | null; status: Standing; reason: string | null };
  members: { accountId: string; name: string | null; email: string | null; role: "owner" | "admin" | "member" | "guest"; status: "active" | "suspended"; joinedAt: number; invitedBy: string | null; teams: string[] }[];
  teams: { id: string; name: string; members: number; archivedAt: number | null }[];
  teamspaces: { id: string; title: string; icon: string | null }[];
  invitations: { id: string; email: string; role: string; status: string; invitedByName: string | null; createdAt: number; resolvedAt: number | null }[];
  events: AuditEvent[];
  stats: { pages: number; databases: number; rows: number; trashed: number; files: number; storageBytes: number; sites: number; shares: number };
}
export interface AdminUserDetail {
  user: { id: string; name: string | null; email: string | null; joinedAt: number | null; updatedAt: number | null; workspaces: { name: string }[]; status: Standing; reason: string | null };
  organizations: { id: string; name: string; icon: string | null; role: string; status: string; joinedAt: number }[];
  invitations: { id: string; orgId: string; orgName: string | null; role: string; status: string; createdAt: number; invitedByName: string | null }[];
  events: AuditEvent[];
}
export type OrgAction =
  | { action: "moderate"; status: Standing; reason: string }
  | { action: "recover"; accountId: string; reason: string }
  | { action: "limits"; maxMembers: number | null }
  | { action: "removeMember"; accountId: string; reason: string }
  | { action: "delete"; confirmName: string; reason: string };
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
  check(): Promise<{ admin: boolean; role?: "admin" | "support" | null }>;
  overview(): Promise<AdminOverview>;
  users(q: { search?: string; offset?: number; limit?: number }): Promise<{ users: AdminUser[]; total: number; offset: number; limit: number }>;
  user(userId: string): Promise<AdminUserDetail>;
  organizations(q: { search?: string; offset?: number; limit?: number }): Promise<{ organizations: AdminOrgRow[]; total: number; offset: number; limit: number }>;
  organization(orgId: string): Promise<AdminOrgDetail>;
  audit(q: { scope?: string; action?: string; actor?: string; before?: number; limit?: number }): Promise<{ events: AuditEvent[] }>;
  orgAction(orgId: string, a: OrgAction): Promise<unknown>;
  setOrganizations(userId: string, on: boolean): Promise<unknown>;
  apps(): Promise<{ apps: (import("./apps").AppListing & { updatedAt: number })[] }>;
  reviewApp(appId: string, decision: "published" | "rejected" | "suspended", note: string): Promise<unknown>;
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
      users: (a) => q("users", a),
      user: (userId) => q("user", { userId }),
      organizations: (a) => q("organizations", { ...a, at: Math.floor(Date.now() / 60_000) * 60_000 }),
      organization: (orgId) => q("organization", { orgId, at: Math.floor(Date.now() / 60_000) * 60_000 }),
      audit: (a) => q("audit", a),
      orgAction: (orgId, a) => m("orgAction", { orgId, ...a }),
      apps: () => q("apps"),
      setOrganizations: (userId, on) => m("setOrganizations", { userId, on }),
      reviewApp: (appId, decision, note) => m("reviewApp", { appId, decision, note }),
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
      users: (a) => postAdmin({ fn: "users", ...a }),
      user: (userId) => postAdmin({ fn: "user", userId }),
      organizations: (a) => postAdmin({ fn: "organizations", ...a }),
      organization: (orgId) => postAdmin({ fn: "organization", orgId }),
      audit: (a) => postAdmin({ fn: "audit", ...a }),
      orgAction: (orgId, a) => postAdmin({ fn: "orgAction", orgId, ...a }),
      apps: () => postAdmin({ fn: "apps" }),
      setOrganizations: (userId, on) => postAdmin({ fn: "setOrganizations", userId, on }),
      reviewApp: (appId, decision, note) => postAdmin({ fn: "reviewApp", appId, decision, note }),
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
