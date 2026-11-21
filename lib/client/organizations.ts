"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useConvex, useQueries } from "convex/react";
import { anyApi } from "convex/server";
import { CLOUD } from "@/lib/config";
import { OpError, toOpError } from "./errors";

/* Organizations (lib/domain/organizations.ts): the client side. Every call is checked on the server. */

export type OrgRole = "owner" | "admin" | "member" | "guest";
export interface OrgPolicies {
  membersCanInvite: boolean;
  allowGuests: boolean;
  allowPublicLinks: boolean;
  allowSites: boolean;
}
export interface MyOrg {
  id: string;
  name: string;
  icon: string | null;
  slug: string;
  role: OrgRole;
  status: "active" | "suspended";
  standing: "active" | "suspended" | "banned";
}
export interface OrgInvitation {
  id: string;
  orgId: string;
  orgName: string;
  orgIcon: string | null;
  role: Exclude<OrgRole, "owner">;
  invitedByName: string | null;
  createdAt: number;
  expiresAt: number;
}
export interface MyOrgs {
  enabled: boolean;
  organizations: MyOrg[];
  invitations: OrgInvitation[];
}
export interface OrgMember {
  accountId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: OrgRole;
  status: "active" | "suspended";
  joinedAt: number;
  teams: string[];
}
export interface OrgTeam {
  id: string;
  name: string;
  description: string;
  memberIds: string[];
  archivedAt: number | null;
}
export interface OrgDetails {
  org: { id: string; name: string; slug: string; icon: string | null; description: string; createdAt: number; policies: OrgPolicies; maxMembers: number | null; standing: "active" | "suspended" | "banned" };
  me: { accountId: string; role: OrgRole };
  members: OrgMember[];
  teams: OrgTeam[];
  invitations: { id: string; email: string; role: Exclude<OrgRole, "owner">; status: "pending" | "accepted" | "declined" | "revoked" | "expired"; invitedByName: string | null; createdAt: number; expiresAt: number; resolvedAt: number | null }[];
  stats: { members: number; pendingInvites: number; pages: number; databases: number; teamspaces: number; storageBytes: number } | null;
}
export interface OrgEvent {
  _id: string;
  actorId: string;
  actorName: string | null;
  action: string;
  targetId: string | null;
  detail: string | null;
  at: number;
}

const minute = () => Math.floor(Date.now() / 60_000) * 60_000;
const ORGS_CHANGED = "max:orgs-changed";

async function postLocal<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/local/organizations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { result?: T; error?: { code: string; message: string } };
  if (!res.ok || json.error) throw new OpError((json.error ?? { code: "INTERNAL", message: "Max's server returned an unexpected response." }) as never);
  return json.result as T;
}

export interface OrgApi {
  call<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
  read<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T>;
}

/** Imperative calls; writes tell every open view to reload. */
const useConvexIfCloud = CLOUD ? useConvex : () => null;

export function useOrgApi(): OrgApi {
  const convex = useConvexIfCloud();
  return useMemo(() => {
    const changed = () => window.dispatchEvent(new Event(ORGS_CHANGED));
    if (!convex) {
      return {
        read: (fn, args) => postLocal({ fn, ...args, at: minute() }),
        call: async (fn, args) => {
          const r = await postLocal(({ fn, ...args }));
          changed();
          return r as never;
        },
      };
    }
    return {
      read: (fn, args) => convex.query(anyApi.organizations[fn], args).catch((e) => Promise.reject(toOpError(e))) as never,
      call: async (fn, args) => {
        const r = await convex.mutation(anyApi.organizations[fn], args).catch((e) => Promise.reject(toOpError(e)));
        changed();
        return r as never;
      },
    };
  }, [convex]);
}

export interface Loaded<T> {
  data: T | undefined;
  error: OpError | null;
  reload: () => void;
}

function useOrgReadCloud<T>(fn: string, args: Record<string, unknown> | "skip"): Loaded<T> {
  const key = args === "skip" ? "skip" : JSON.stringify(args);
  const queries = useMemo(() => (key === "skip" ? {} : { q: { query: anyApi.organizations[fn], args: { ...JSON.parse(key), ...(fn === "audit" ? {} : { at: minute() }) } } }), [fn, key]);
  const result = useQueries(queries as never) as { q?: unknown };
  const reload = useCallback(() => undefined, []); // live: Convex pushes changes
  const raw = result.q;
  if (raw instanceof Error) return { data: undefined, error: toOpError(raw), reload };
  return { data: raw as T | undefined, error: null, reload };
}

function useOrgReadLocal<T>(fn: string, args: Record<string, unknown> | "skip"): Loaded<T> {
  const key = args === "skip" ? "skip" : JSON.stringify(args);
  const [local, setLocal] = useState<{ data?: T; error: OpError | null }>({ error: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  useEffect(() => {
    if (key === "skip") return;
    let live = true;
    postLocal<T>({ fn, ...JSON.parse(key) })
      .then((data) => live && setLocal({ data, error: null }))
      .catch((error: OpError) => live && setLocal((s) => ({ data: s.data, error })));
    return () => {
      live = false;
    };
  }, [fn, key, tick]);
  useEffect(() => {
    window.addEventListener(ORGS_CHANGED, reload);
    return () => window.removeEventListener(ORGS_CHANGED, reload);
  }, [reload]);
  return { data: local.data, error: local.error, reload };
}

/** A read that stays fresh: live in the cloud, reloaded after every organization change locally. */
const useOrgRead: <T>(fn: string, args: Record<string, unknown> | "skip") => Loaded<T> = CLOUD ? useOrgReadCloud : useOrgReadLocal;

export const useMyOrgs = () => useOrgRead<MyOrgs>("mine", {});
export const useOrgDetails = (orgId: string | null) => useOrgRead<OrgDetails>("details", orgId ? { orgId } : "skip");
export const useOrgAudit = (orgId: string | null, action?: string) => useOrgRead<{ events: OrgEvent[] }>("audit", orgId ? { orgId, ...(action ? { action } : {}) } : "skip");

export const ROLE_LABEL: Record<OrgRole, string> = { owner: "Owner", admin: "Admin", member: "Member", guest: "Guest" };
export const isOrgId = (id: string | null | undefined): id is string => !!id && /^org_[a-z0-9]{10}$/.test(id);
