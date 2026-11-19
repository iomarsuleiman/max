"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity as ActivityIcon, Ban, CircleCheck, Database as DbIcon, ExternalLink, FileText as FileIcon, Flag, Globe as GlobeIcon, PauseCircle, RotateCcw, Search, ShieldAlert, Sparkles as SparklesIcon, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, EmptyState, Segmented, Skeleton, cn } from "@/components/ui";
import { Topbar } from "@/components/workspace/Topbar";
import { notifyError } from "@/components/workspace/context";
import { DOODLE, Doodle } from "@/components/icons/Doodle";
import { useAdminApi, type AdminOverview, type AdminUser, type Report } from "@/lib/client/admin";
import { dateTime, timeAgo } from "@/lib/client/format";
import { pageHref } from "@/lib/pageUrl";

type Tab = "overview" | "users" | "reports";

/** Max's admin dashboard: how people use Max, account standing, and reported problems. */
export function AdminDashboard() {
  const api = useAdminApi();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<AdminOverview | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const refresh = useCallback(async () => {
    try {
      const [o, r] = await Promise.all([api.overview(), api.reports()]);
      setData(o);
      setReports(r.reports);
    } catch (err) {
      notifyError(err, "Couldn't load the dashboard.");
    }
  }, [api]);
  useEffect(() => {
    void api.check().then((r) => {
      setAllowed(r.admin);
      if (r.admin) void refresh();
    }, () => setAllowed(false));
  }, [api, refresh]);

  if (allowed === false) {
    return (
      <>
        <Topbar crumbs={[{ title: "Admin", href: "/admin" }]} />
        <EmptyState icon={<ShieldAlert className="size-5" />} title="This page is for Max's admins" body="Ask the person who runs Max to add your email to MAX_ADMIN_EMAILS." className="mt-24" />
      </>
    );
  }
  return (
    <>
      <Topbar crumbs={[{ title: "Admin", href: "/admin" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto" id="page-scroll">
        <div className="mx-auto w-full max-w-[1100px] px-4 pb-24 pt-8 sm:px-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="font-mono text-[11px] font-bold tracking-[.16em] text-fg-3">ADMIN</p>
              <h1 className="mt-1 text-[30px] font-bold tracking-tight">Dashboard</h1>
            </div>
            <Segmented label="Section" value={tab} onChange={(v) => setTab(v as Tab)} options={[{ value: "overview", label: "Overview" }, { value: "users", label: `Users${data ? ` · ${data.totals.users}` : ""}` }, { value: "reports", label: `Reports${data?.totals.openReports ? ` · ${data.totals.openReports}` : ""}` }]} />
          </div>
          {!data || !reports ? (
            <div className="mt-8 grid gap-3"><Skeleton className="h-28" /><Skeleton className="h-64" /></div>
          ) : tab === "overview" ? (
            <Overview data={data} reports={reports} onTab={setTab} />
          ) : tab === "users" ? (
            <Users users={data.users} onChanged={refresh} />
          ) : (
            <Reports reports={reports} onChanged={refresh} />
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, color, icon }: { label: string; value: number; color: string; icon: Parameters<typeof Doodle>[0]["icon"] }) {
  return (
    <div className="admin-stat">
      <Doodle icon={icon} color={color} size={18} />
      <p className="mt-3 text-[28px] font-bold tracking-tight">{value.toLocaleString("en-US")}</p>
      <p className="text-[13px] text-fg-2">{label}</p>
    </div>
  );
}

function Overview({ data, reports, onTab }: { data: AdminOverview; reports: Report[]; onTab: (t: Tab) => void }) {
  const t = data.totals;
  const top = [...data.users].sort((a, b) => b.pages - a.pages).slice(0, 5);
  const open = reports.filter((r) => r.status === "open").slice(0, 4);
  return (
    <div className="mt-8 grid gap-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="People" value={t.users} color={DOODLE.pink} icon={UsersIcon} />
        <Stat label="Active this week" value={t.activeThisWeek} color={DOODLE.mint} icon={ActivityIcon} />
        <Stat label="Pages" value={t.pages} color={DOODLE.amber} icon={FileIcon} />
        <Stat label="Open reports" value={t.openReports} color={DOODLE.red} icon={Flag} />
        <Stat label="New this week" value={t.newThisWeek} color={DOODLE.blue} icon={SparklesIcon} />
        <Stat label="Databases" value={t.databases} color={DOODLE.teal} icon={DbIcon} />
        <Stat label="Published sites" value={t.sites} color={DOODLE.violet} icon={GlobeIcon} />
        <Stat label="Suspended or banned" value={t.suspended} color={DOODLE.gray} icon={PauseCircle} />
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <section className="settings-card py-3">
          <h2 className="mb-2 text-[13px] font-medium text-fg-3">Most pages</h2>
          {top.map((u) => (
            <div key={u.id} className="flex items-center gap-3 py-1.5 text-[13.5px]">
              <span className="min-w-0 flex-1 truncate">{u.name || u.email || u.id}</span>
              <span className="tabular-nums text-fg-2">{u.pages.toLocaleString("en-US")} pages</span>
            </div>
          ))}
          <button type="button" className="mt-2 text-[13px] text-accent-text hover:underline" onClick={() => onTab("users")}>All users →</button>
        </section>
        <section className="settings-card py-3">
          <h2 className="mb-2 text-[13px] font-medium text-fg-3">Newest reports</h2>
          {open.length === 0 ? <p className="py-2 text-[13.5px] text-fg-3">Nothing open. 🎉</p> : open.map((r) => (
            <p key={r._id} className="line-clamp-1 py-1.5 text-[13.5px]"><KindBadge kind={r.kind} /> {r.message}</p>
          ))}
          <button type="button" className="mt-2 text-[13px] text-accent-text hover:underline" onClick={() => onTab("reports")}>All reports →</button>
        </section>
      </div>
    </div>
  );
}

function Users({ users, onChanged }: { users: AdminUser[]; onChanged: () => void }) {
  const api = useAdminApi();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "suspended" | "banned">("all");
  const [acting, setActing] = useState<{ user: AdminUser; status: AdminUser["status"] } | null>(null);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) => (filter === "all" || u.status === filter) && (!s || `${u.name ?? ""} ${u.email ?? ""} ${u.id}`.toLowerCase().includes(s)));
  }, [users, q, filter]);
  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-lg bg-surface px-3 shadow-[0_0_0_1px_var(--line)]">
          <Search className="size-4 text-fg-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search users" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
        </label>
        <Segmented label="Status" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "all", label: "All" }, { value: "active", label: "Active" }, { value: "suspended", label: "Suspended" }, { value: "banned", label: "Banned" }]} />
      </div>
      <div className="overflow-x-auto rounded-xl shadow-[0_0_0_1px_var(--line)]">
        <table className="w-full min-w-[860px] border-collapse text-[13.5px]" aria-label="Users">
          <thead>
            <tr className="text-start text-[12px] text-fg-3">
              {["Person", "Pages", "Databases", "Sites", "Shared", "Joined", "Last active", "Status", ""].map((h) => (
                <th key={h} className="border-b border-line px-3 py-2 text-start font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className="hover:bg-hover">
                <td className="border-b border-line px-3 py-2">
                  <p className="font-medium">{u.name || "No name"}</p>
                  <p className="text-[12px] text-fg-3">{u.email || u.id}</p>
                </td>
                <td className="border-b border-line px-3 py-2 tabular-nums">{u.pages}{u.rows ? <span className="text-fg-3"> + {u.rows} rows</span> : null}</td>
                <td className="border-b border-line px-3 py-2 tabular-nums">{u.databases}</td>
                <td className="border-b border-line px-3 py-2 tabular-nums">{u.sites}</td>
                <td className="border-b border-line px-3 py-2 tabular-nums">{u.shares}</td>
                <td className="border-b border-line px-3 py-2 text-fg-2">{u.joinedAt ? timeAgo(u.joinedAt) : "—"}</td>
                <td className="border-b border-line px-3 py-2 text-fg-2">{u.lastActive ? timeAgo(u.lastActive) : "—"}</td>
                <td className="border-b border-line px-3 py-2"><StatusBadge status={u.status} reason={u.reason} /></td>
                <td className="border-b border-line px-3 py-2 text-end">
                  {u.status === "active" ? (
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" icon={<PauseCircle className="size-3.5" />} onClick={() => setActing({ user: u, status: "suspended" })}>Suspend</Button>
                      <Button size="xs" variant="ghost" className="text-danger hover:bg-danger-soft" icon={<Ban className="size-3.5" />} onClick={() => setActing({ user: u, status: "banned" })}>Ban</Button>
                    </div>
                  ) : (
                    <Button size="xs" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setActing({ user: u, status: "active" })}>Restore</Button>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-fg-3">No one matches.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {acting && (
        <Moderate
          acting={acting}
          onClose={() => setActing(null)}
          onConfirm={async (reason) => {
            try {
              await api.setStatus(acting.user.id, acting.status, reason);
              toast.success(acting.status === "active" ? "Account restored" : acting.status === "suspended" ? "Account suspended" : "Account banned");
              setActing(null);
              onChanged();
            } catch (err) {
              notifyError(err);
            }
          }}
        />
      )}
    </div>
  );
}

function Moderate({ acting, onClose, onConfirm }: { acting: { user: AdminUser; status: AdminUser["status"] }; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const who = acting.user.name || acting.user.email || "this person";
  const copy = {
    suspended: { title: `Suspend ${who}?`, body: "They can still sign in and read their pages, but can't change anything until you restore them.", cta: "Suspend" },
    banned: { title: `Ban ${who}?`, body: "They lose access to Max entirely, their published sites go offline, and pages shared from them stop opening. Nothing is deleted; you can restore them later.", cta: "Ban" },
    active: { title: `Restore ${who}?`, body: "They get full access back.", cta: "Restore" },
  }[acting.status];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={copy.title} description={copy.body}>
      <div className="grid gap-3 px-5 pb-5 pt-2">
        {acting.status !== "active" && (
          <label className="grid gap-1.5 text-[13px]">
            Reason (they&apos;ll see this when they open Max)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} className="rounded-md bg-surface px-3 py-2 shadow-[0_0_0_1px_var(--line)] outline-none focus:shadow-[0_0_0_1.5px_var(--accent)]" />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={acting.status === "active" ? "primary" : "danger"} pending={busy} onClick={async () => { setBusy(true); await onConfirm(reason); setBusy(false); }}>{copy.cta}</Button>
        </div>
      </div>
    </Dialog>
  );
}

function Reports({ reports, onChanged }: { reports: Report[]; onChanged: () => void }) {
  const api = useAdminApi();
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const shown = reports.filter((r) => filter === "all" || r.status === filter);
  return (
    <div className="mt-8">
      <div className="mb-3 flex justify-end">
        <Segmented label="Show" value={filter} onChange={(v) => setFilter(v as typeof filter)} options={[{ value: "open", label: "Open" }, { value: "resolved", label: "Resolved" }, { value: "all", label: "All" }]} />
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<Flag className="size-5" />} title={filter === "open" ? "No open reports" : "No reports here"} body="Reports people send from Max, and from published pages and sites, land here." />
      ) : (
        <ul className="grid gap-3" aria-label="Reports">
          {shown.map((r) => (
            <li key={r._id} className={cn("settings-card py-4", r.status === "resolved" && "opacity-70")}>
              <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-3">
                <KindBadge kind={r.kind} />
                <span>{r.reporterName || r.reporterEmail || "A visitor"}{r.reporterEmail && r.reporterName ? ` · ${r.reporterEmail}` : ""}</span>
                <span title={dateTime(r.createdAt)}>· {timeAgo(r.createdAt)}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[14px]">{r.message}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {r.siteSlug && <Link href={`/site/${r.siteSlug}`} target="_blank" className="inline-flex items-center gap-1 text-[13px] text-accent-text hover:underline">Site: {r.siteSlug} <ExternalLink className="size-3.5" /></Link>}
                {r.url && <a href={r.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[360px] items-center gap-1 truncate text-[13px] text-accent-text hover:underline">{r.url} <ExternalLink className="size-3.5 shrink-0" /></a>}
                {r.pageId && !r.url && <Link href={pageHref(r.pageId)} className="text-[13px] text-accent-text hover:underline">Open page</Link>}
                <Button
                  size="xs"
                  className="ms-auto"
                  variant={r.status === "open" ? "primary" : "ghost"}
                  icon={r.status === "open" ? <CircleCheck className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                  onClick={async () => {
                    try {
                      await api.setReport(r._id, r.status === "open" ? "resolved" : "open");
                      onChanged();
                    } catch (err) {
                      notifyError(err);
                    }
                  }}
                >
                  {r.status === "open" ? "Resolve" : "Reopen"}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function KindBadge({ kind }: { kind: Report["kind"] }) {
  const label = { bug: "Problem", content: "Content", other: "Other" }[kind];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", kind === "content" ? "bg-danger-soft text-danger" : kind === "bug" ? "bg-warning-soft text-fg" : "bg-surface-2 text-fg-2")}>{label}</span>;
}

function StatusBadge({ status, reason }: { status: AdminUser["status"]; reason: string | null }) {
  return (
    <span title={reason ?? undefined} className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", status === "active" ? "bg-success-soft text-fg" : status === "suspended" ? "bg-warning-soft text-fg" : "bg-danger-soft text-danger")}>
      {status === "active" ? "Active" : status === "suspended" ? "Suspended" : "Banned"}
    </span>
  );
}

