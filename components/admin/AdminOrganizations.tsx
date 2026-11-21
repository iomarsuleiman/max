"use client";

import { useCallback, useEffect, useState } from "react";
import { Ban, Building2, Crown, Eye, PauseCircle, RotateCcw, Search, Trash2, UserMinus } from "@/components/icons";
import { toast } from "sonner";
import { Button, Dialog, EmptyState, Input, Segmented, Skeleton, cn } from "@/components/ui";
import { notifyError } from "@/components/workspace/context";
import { useAdminApi, type AdminOrgDetail, type AdminOrgRow, type AuditEvent, type OrgAction, type Standing } from "@/lib/client/admin";
import { bytes, dateTime, timeAgo } from "@/lib/client/format";
import { EventList, Pager, RoleBadge, downloadCsv, useDebounced } from "./shared";

const PAGE = 50;
const POLICY_LABEL: Record<string, string> = { membersCanInvite: "Members invite", allowGuests: "Outside sharing", allowPublicLinks: "Web links", allowSites: "Websites" };

/** Every organization: owner, size, standing; open one for its people, structure and history. */
export function AdminOrganizations({ readOnly, focus, onFocus, onChanged }: { readOnly: boolean; focus: string | null; onFocus: (id: string | null) => void; onChanged: () => void }) {
  const api = useAdminApi();
  const [q, setQ] = useState("");
  const search = useDebounced(q);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ organizations: AdminOrgRow[]; total: number } | null>(null);
  const load = useCallback(async () => {
    try {
      setPage(await api.organizations({ search, offset, limit: PAGE }));
    } catch (err) {
      notifyError(err, "Couldn't load organizations.");
    }
  }, [api, search, offset]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setOffset(0), [search]);
  const changed = () => {
    void load();
    onChanged();
  };
  return (
    <div className="mt-8">
      <div className="mb-3 flex items-center gap-2">
        <label className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-surface px-3 shadow-[0_0_0_1px_var(--line)]">
          <Search className="size-4 text-fg-3" aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, address or id" aria-label="Search organizations" className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none" />
        </label>
        <Button size="sm" variant="ghost" disabled={!page?.organizations.length} onClick={() => downloadCsv("max-organizations", (page?.organizations ?? []).map(({ owner, reason: _r, icon: _i, ...o }) => ({ ...o, ownerName: owner?.name ?? "", ownerEmail: owner?.email ?? "" })))}>Export CSV</Button>
      </div>
      {!page ? (
        <Skeleton className="h-64" />
      ) : page.organizations.length === 0 ? (
        <EmptyState icon={<Building2 className="size-5" />} title={q ? "No organization matches" : "No organizations yet"} body="Organizations people create appear here with their owner, members and standing." />
      ) : (
        <div className="overflow-x-auto rounded-xl shadow-[0_0_0_1px_var(--line)]">
          <table className="w-full min-w-[880px] border-collapse text-[13.5px]" aria-label="Organizations">
            <thead>
              <tr className="text-[12px] text-fg-3">
                {["Organization", "Owner", "Members", "Admins", "Guests", "Invites", "Created", "Status", ""].map((h) => (
                  <th key={h} className="border-b border-line px-3 py-2 text-start font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {page.organizations.map((o) => (
                <tr key={o.id} className="hover:bg-hover">
                  <td className="border-b border-line px-3 py-2">
                    <button type="button" className="text-start hover:underline" onClick={() => onFocus(o.id)}>
                      <span className="block font-medium">{o.icon && o.icon.length <= 4 ? `${o.icon} ` : ""}{o.name}</span>
                      <span className="block text-[12px] text-fg-3">{o.slug}</span>
                    </button>
                  </td>
                  <td className="border-b border-line px-3 py-2">{o.owner ? <span title={o.owner.id}>{o.owner.name || o.owner.email || o.owner.id}</span> : <span className="text-danger">No owner</span>}</td>
                  <td className="border-b border-line px-3 py-2 tabular-nums">{o.members}{o.maxMembers ? <span className="text-fg-3"> / {o.maxMembers}</span> : null}</td>
                  <td className="border-b border-line px-3 py-2 tabular-nums">{o.admins}</td>
                  <td className="border-b border-line px-3 py-2 tabular-nums">{o.guests}</td>
                  <td className="border-b border-line px-3 py-2 tabular-nums">{o.pendingInvites}</td>
                  <td className="border-b border-line px-3 py-2 text-fg-2" title={dateTime(o.createdAt)}>{timeAgo(o.createdAt)}</td>
                  <td className="border-b border-line px-3 py-2"><OrgStatus status={o.status} reason={o.reason} /></td>
                  <td className="border-b border-line px-3 py-2 text-end">
                    <Button size="xs" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => onFocus(o.id)}>Open</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {page && <Pager offset={offset} total={page.total} size={PAGE} onOffset={setOffset} noun="organizations" />}
      {focus && <OrgDetail orgId={focus} readOnly={readOnly} onClose={() => onFocus(null)} onChanged={changed} />}
    </div>
  );
}

function OrgStatus({ status, reason }: { status: Standing; reason: string | null }) {
  return (
    <span title={reason ?? undefined} className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium", status === "active" ? "bg-success-soft text-fg" : status === "suspended" ? "bg-warning-soft text-fg" : "bg-danger-soft text-danger")}>
      {status === "active" ? "Active" : status === "suspended" ? "Read-only" : "Locked"}
    </span>
  );
}

type Acting =
  | { kind: "moderate"; status: Standing }
  | { kind: "recover" }
  | { kind: "limits" }
  | { kind: "removeMember"; accountId: string; label: string }
  | { kind: "delete" };

/** One organization in full. Teamspace names are its structure; page contents are never shown. */
function OrgDetail({ orgId, readOnly, onClose, onChanged }: { orgId: string; readOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const api = useAdminApi();
  const [d, setD] = useState<AdminOrgDetail | null>(null);
  const [acting, setActing] = useState<Acting | null>(null);
  const [section, setSection] = useState<"members" | "invitations" | "structure" | "activity">("members");
  const load = useCallback(() => {
    api.organization(orgId).then(setD, (err) => (notifyError(err, "Couldn't open the organization."), onClose()));
  }, [api, orgId, onClose]);
  useEffect(load, [load]);
  const act = async (a: OrgAction, done: string) => {
    try {
      await api.orgAction(orgId, a);
      toast.success(done);
      setActing(null);
      onChanged();
      if (a.action === "delete") onClose();
      else load();
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={d ? d.org.name : "Organization"} description={d ? `${d.org.slug} · created ${timeAgo(d.org.createdAt)} · ${d.org.id}` : undefined} size="lg">
      {!d ? (
        <div className="p-5"><Skeleton className="h-48" /></div>
      ) : (
        <div className="grid max-h-[72vh] gap-5 overflow-y-auto px-5 pb-5 pt-1 text-[13.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <OrgStatus status={d.org.status} reason={d.org.reason} />
            {d.org.reason && <span className="text-fg-3">“{d.org.reason}”</span>}
            {!readOnly && (
              <div className="ms-auto flex flex-wrap gap-1">
                {d.org.status === "active" ? (
                  <>
                    <Button size="xs" variant="ghost" icon={<PauseCircle className="size-3.5" />} onClick={() => setActing({ kind: "moderate", status: "suspended" })}>Make read-only</Button>
                    <Button size="xs" variant="ghost" className="text-danger hover:bg-danger-soft" icon={<Ban className="size-3.5" />} onClick={() => setActing({ kind: "moderate", status: "banned" })}>Lock</Button>
                  </>
                ) : (
                  <Button size="xs" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setActing({ kind: "moderate", status: "active" })}>Restore</Button>
                )}
                <Button size="xs" variant="ghost" icon={<Crown className="size-3.5" />} onClick={() => setActing({ kind: "recover" })}>Recover ownership</Button>
                <Button size="xs" variant="ghost" onClick={() => setActing({ kind: "limits" })}>Limits</Button>
                <Button size="xs" variant="ghost" className="text-danger hover:bg-danger-soft" icon={<Trash2 className="size-3.5" />} onClick={() => setActing({ kind: "delete" })}>Delete</Button>
              </div>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["Members", d.members.filter((m) => m.status === "active").length + (d.org.maxMembers ? ` / ${d.org.maxMembers}` : "")],
              ["Pages", d.stats.pages],
              ["Databases", `${d.stats.databases} (${d.stats.rows} rows)`],
              ["Storage", `${bytes(d.stats.storageBytes)} · ${d.stats.files} files`],
              ["Teamspaces", d.teamspaces.length],
              ["Teams", d.teams.filter((t) => !t.archivedAt).length],
              ["Page shares", d.stats.shares],
              ["Sites", d.stats.sites],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-[12px] text-fg-3">{k}</dt>
                <dd className="font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <ul className="flex flex-wrap gap-1.5 text-[12px]" aria-label="Policies">
            {Object.entries(POLICY_LABEL).map(([k, label]) => (
              <li key={k} className={cn("rounded-full px-2 py-0.5", d.org.policies[k] ? "bg-success-soft text-fg" : "bg-surface-2 text-fg-3")}>
                {label}: {d.org.policies[k] ? "on" : "off"}
              </li>
            ))}
          </ul>
          <Segmented label="Organization section" value={section} onChange={(v) => setSection(v as typeof section)} size="sm" options={[{ value: "members", label: `Members · ${d.members.length}` }, { value: "invitations", label: `Invitations · ${d.invitations.length}` }, { value: "structure", label: "Structure" }, { value: "activity", label: "Activity" }]} />
          {section === "members" && (
            <table className="w-full border-collapse text-[13px]" aria-label="Organization members">
              <tbody>
                {d.members.map((m) => (
                  <tr key={m.accountId} className="hover:bg-hover">
                    <td className="border-b border-line py-1.5 pe-2">
                      <span className="block font-medium">{m.name || m.email || m.accountId}</span>
                      <span className="block text-[12px] text-fg-3">{m.email ?? m.accountId}{m.teams.length ? ` · ${m.teams.join(", ")}` : ""}</span>
                    </td>
                    <td className="border-b border-line py-1.5 pe-2"><RoleBadge role={m.role} /></td>
                    <td className="border-b border-line py-1.5 pe-2 text-fg-3">{m.status === "suspended" ? "Suspended · " : ""}joined {timeAgo(m.joinedAt)}</td>
                    <td className="border-b border-line py-1.5 text-end">
                      {!readOnly && m.role !== "owner" && (
                        <Button size="xs" variant="ghost" className="text-danger hover:bg-danger-soft" icon={<UserMinus className="size-3.5" />} onClick={() => setActing({ kind: "removeMember", accountId: m.accountId, label: m.name || m.email || m.accountId })}>
                          Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {section === "invitations" &&
            (d.invitations.length === 0 ? (
              <p className="text-fg-3">No invitations sent yet.</p>
            ) : (
              <ul className="grid gap-1" aria-label="Invitation history">
                {d.invitations.map((i) => (
                  <li key={i.id} className="flex items-center gap-2 text-[13px]">
                    <span className="min-w-0 flex-1 truncate">{i.email} · as {i.role}{i.invitedByName ? ` · by ${i.invitedByName}` : ""}</span>
                    <span className="text-fg-3">{i.status} · {timeAgo(i.resolvedAt ?? i.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ))}
          {section === "structure" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <section>
                <h3 className="mb-1.5 text-[12px] font-medium text-fg-3">Teamspaces</h3>
                {d.teamspaces.length === 0 ? <p className="text-fg-3">None yet.</p> : <ul className="grid gap-1">{d.teamspaces.map((t) => <li key={t.id} className="truncate">{t.icon && t.icon.length <= 4 ? `${t.icon} ` : ""}{t.title}</li>)}</ul>}
              </section>
              <section>
                <h3 className="mb-1.5 text-[12px] font-medium text-fg-3">Teams</h3>
                {d.teams.length === 0 ? <p className="text-fg-3">None yet.</p> : <ul className="grid gap-1">{d.teams.map((t) => <li key={t.id} className={cn("flex justify-between gap-2", t.archivedAt && "opacity-60")}><span className="truncate">{t.name}{t.archivedAt ? " (archived)" : ""}</span><span className="tabular-nums text-fg-3">{t.members}</span></li>)}</ul>}
              </section>
            </div>
          )}
          {section === "activity" && <EventList events={d.events} empty="No activity recorded yet." />}
        </div>
      )}
      {d && acting && <OrgActionDialog d={d} acting={acting} onClose={() => setActing(null)} onAct={act} />}
    </Dialog>
  );
}

function OrgActionDialog({ d, acting, onClose, onAct }: { d: AdminOrgDetail; acting: Acting; onClose: () => void; onAct: (a: OrgAction, done: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(d.members.find((m) => m.role === "admin" && m.status === "active")?.accountId ?? "");
  const [max, setMax] = useState(d.org.maxMembers ? String(d.org.maxMembers) : "");
  const [confirm, setConfirm] = useState("");
  const candidates = d.members.filter((m) => m.status === "active" && (m.role === "admin" || m.role === "member"));
  const copy =
    acting.kind === "moderate"
      ? acting.status === "suspended"
        ? { title: `Make ${d.org.name} read-only?`, body: "Members can still open and read everything, but nothing can be changed until you restore it.", cta: "Make read-only", danger: true }
        : acting.status === "banned"
          ? { title: `Lock ${d.org.name}?`, body: "No one can open the organization, its shared pages stop working and its sites go offline. Nothing is deleted.", cta: "Lock", danger: true }
          : { title: `Restore ${d.org.name}?`, body: "Its members get full access back.", cta: "Restore", danger: false }
      : acting.kind === "recover"
        ? { title: "Recover ownership", body: "Hand the organization to one of its active admins or members (for example, when the owner left or lost their account). The current owner becomes an admin.", cta: "Make owner", danger: false }
        : acting.kind === "limits"
          ? { title: "Member limit", body: "The most members this organization may have. Leave empty for Max's default.", cta: "Save", danger: false }
          : acting.kind === "removeMember"
            ? { title: `Remove ${acting.label}?`, body: "They lose access immediately, along with any page shares in this organization.", cta: "Remove", danger: true }
            : { title: `Delete ${d.org.name}?`, body: "This permanently deletes the organization with every page, database, file and its history. It can't be undone. The deletion stays in the audit trail.", cta: "Delete forever", danger: true };
  const needsReason = acting.kind !== "limits" && !(acting.kind === "moderate" && acting.status === "active");
  const ready = (!needsReason || reason.trim()) && (acting.kind !== "recover" || next) && (acting.kind !== "delete" || confirm === d.org.name);
  const submit = async () => {
    setBusy(true);
    if (acting.kind === "moderate") await onAct({ action: "moderate", status: acting.status, reason }, acting.status === "active" ? "Organization restored" : acting.status === "suspended" ? "Organization is read-only" : "Organization locked");
    else if (acting.kind === "recover") await onAct({ action: "recover", accountId: next, reason }, "Ownership recovered");
    else if (acting.kind === "limits") await onAct({ action: "limits", maxMembers: max.trim() ? Number(max) : null }, "Limit saved");
    else if (acting.kind === "removeMember") await onAct({ action: "removeMember", accountId: acting.accountId, reason }, "Member removed");
    else await onAct({ action: "delete", confirmName: confirm, reason }, "Organization deleted");
    setBusy(false);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={copy.title} description={copy.body}>
      <div className="grid gap-3 px-5 pb-5 pt-2 text-[13px]">
        {acting.kind === "recover" && (
          <label className="grid gap-1.5">
            New owner
            <select value={next} onChange={(e) => setNext(e.target.value)} className="h-9 rounded-md bg-surface px-2 shadow-[0_0_0_1px_var(--line)]">
              <option value="" disabled>Pick a member</option>
              {candidates.map((m) => <option key={m.accountId} value={m.accountId}>{m.name || m.email || m.accountId} ({m.role})</option>)}
            </select>
          </label>
        )}
        {acting.kind === "limits" && <Input type="number" min={1} max={100000} value={max} onChange={(e) => setMax(e.target.value)} placeholder="Default" aria-label="Member limit" />}
        {acting.kind === "delete" && (
          <label className="grid gap-1.5">
            Type <b>{d.org.name}</b> to confirm
            <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Organization name" />
          </label>
        )}
        {needsReason && (
          <label className="grid gap-1.5">
            Reason (recorded in the audit trail{acting.kind === "moderate" ? "; members see it" : ""})
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} className="rounded-md bg-surface px-3 py-2 shadow-[0_0_0_1px_var(--line)] outline-none focus:shadow-[0_0_0_1.5px_var(--accent)]" />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={copy.danger ? "danger" : "primary"} pending={busy} disabled={!ready} onClick={submit}>{copy.cta}</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Everything that changed membership, permissions, ownership and standing, across Max. */
export function AdminAudit() {
  const api = useAdminApi();
  const [scope, setScope] = useState<"all" | "platform">("all");
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const a = useDebounced(action);
  const who = useDebounced(actor);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [more, setMore] = useState(true);
  const load = useCallback(
    async (before?: number) => {
      try {
        const r = await api.audit({ scope: scope === "platform" ? "platform" : undefined, action: a || undefined, actor: who || undefined, before, limit: 100 });
        setEvents((prev) => (before && prev ? [...prev, ...r.events] : r.events));
        setMore(r.events.length === 100);
      } catch (err) {
        notifyError(err, "Couldn't load the audit trail.");
      }
    },
    [api, scope, a, who],
  );
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <div className="mt-8">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented label="Scope" value={scope} onChange={(v) => setScope(v as typeof scope)} options={[{ value: "all", label: "Everything" }, { value: "platform", label: "Admin actions" }]} />
        <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Action, e.g. member.removed" aria-label="Filter by action" className="h-9 max-w-[240px]" />
        <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Who (name or id)" aria-label="Filter by actor" className="h-9 max-w-[200px]" />
      </div>
      {!events ? <Skeleton className="h-64" /> : (
        <div className="settings-card py-3">
          <EventList events={events} empty="Nothing recorded yet." />
          {more && events.length > 0 && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => load(events[events.length - 1].at)}>Load older</Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Marketplace review: apps waiting for review, and every listed or suspended app. */
export function AdminMarketplace({ readOnly }: { readOnly: boolean }) {
  const api = useAdminApi();
  const [apps, setApps] = useState<Awaited<ReturnType<typeof api.apps>>["apps"] | null>(null);
  const load = useCallback(() => {
    api.apps().then((r) => setApps(r.apps), (err) => notifyError(err, "Couldn't load apps."));
  }, [api]);
  useEffect(load, [load]);
  const [asking, setAsking] = useState<{ appId: string; decision: "rejected" | "suspended" } | null>(null);
  const [note, setNote] = useState("");
  const decide = async (appId: string, decision: "published" | "rejected" | "suspended", why = "") => {
    if (decision !== "published" && !why) return setAsking({ appId, decision });
    try {
      await api.reviewApp(appId, decision, why);
      setAsking(null);
      setNote("");
      toast.success(decision === "published" ? "Published to the marketplace" : decision === "rejected" ? "Rejected" : "Suspended everywhere");
      load();
    } catch (err) {
      notifyError(err);
    }
  };
  if (!apps) return <Skeleton className="mt-8 h-48" />;
  if (!apps.length) return <EmptyState icon={<Building2 className="size-5" />} title="No apps to review" body="Apps developers submit for the marketplace appear here for review." className="mt-12" />;
  return (
    <>
    {asking && (
      <Dialog open onOpenChange={(o) => !o && setAsking(null)} title={asking.decision === "rejected" ? "Reject this app?" : "Suspend this app?"} description={asking.decision === "rejected" ? "The developer sees your reason and can fix it and submit again." : "It stops working in every workspace right away. The developer sees your reason."}>
        <div className="grid gap-3 px-5 pb-5 pt-2">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} aria-label="Reason" className="rounded-md bg-surface px-3 py-2 text-[13px] shadow-[0_0_0_1px_var(--line)] outline-none focus:shadow-[0_0_0_1.5px_var(--accent)]" />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAsking(null)}>Cancel</Button>
            <Button variant="danger" disabled={!note.trim()} onClick={() => decide(asking.appId, asking.decision, note.trim())}>{asking.decision === "rejected" ? "Reject" : "Suspend"}</Button>
          </div>
        </div>
      </Dialog>
    )}
    <ul className="mt-8 grid gap-3" aria-label="Apps">
      {apps.map((a) => (
        <li key={a.id} className="settings-card grid gap-2 py-4 text-[13.5px]">
          <div className="flex flex-wrap items-center gap-2">
            <b className="font-semibold">{a.name}</b>
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[12px] capitalize">{a.status}</span>
            <span className="text-[12px] text-fg-3">{a.installs} connections · updated {timeAgo(a.updatedAt)} · developer {a.developer}</span>
          </div>
          <p className="text-fg-2">{a.description || "No description."}</p>
          <p className="text-[12.5px] text-fg-3">Asks to: {a.scopes.join(", ")}{a.webhookUrl ? ` · webhooks to ${a.webhookUrl}` : ""}{a.redirectUris?.length ? ` · redirects to ${a.redirectUris.join(", ")}` : ""}</p>
          {!readOnly && (
            <div className="flex flex-wrap gap-1.5">
              {a.status !== "published" && <Button size="xs" variant="primary" onClick={() => decide(a.id, "published")}>Approve and publish</Button>}
              {a.status === "submitted" && <Button size="xs" variant="ghost" onClick={() => decide(a.id, "rejected")}>Reject</Button>}
              {a.status !== "suspended" && <Button size="xs" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => decide(a.id, "suspended")}>Suspend</Button>}
            </div>
          )}
        </li>
      ))}
    </ul>
    </>
  );
}
