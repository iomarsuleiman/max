"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Building2, Crown, LogOut, Mail, MoreHorizontal, RotateCcw, Trash2, UserMinus, Users } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, EmptyState, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Skeleton, Switch, Textarea, cn, confirmAction } from "@/components/ui";
import { Topbar } from "@/components/workspace/Topbar";
import { notifyError } from "@/components/workspace/context";
import { useWorkspaces } from "@/components/workspace/Workspaces";
import { EventList } from "@/components/admin/shared";
import { ROLE_LABEL, isOrgId, useOrgApi, useOrgAudit, useOrgDetails, type OrgDetails, type OrgMember, type OrgPolicies, type OrgRole } from "@/lib/client/organizations";
import { activeWorkspace, switchWorkspace } from "@/lib/client/workspace";
import { bytes, dateTime, timeAgo } from "@/lib/client/format";

type Tab = "general" | "members" | "invitations" | "teams" | "policies" | "activity";

/**
 * The open organization's settings: its people, invitations, teams, sharing policies and audit log.
 * Members see the directory and teams; admins manage them; only the owner transfers or deletes.
 */
export function OrgSettings() {
  const orgId = activeWorkspace();
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get("tab") as Tab) || "general");
  const q = useOrgDetails(isOrgId(orgId) ? orgId : null);
  const spaces = useWorkspaces();
  const crumbs = [{ title: "Organization", href: "/org" }];

  if (!isOrgId(orgId)) {
    const orgs = spaces.list.filter((w) => w.kind === "organization");
    return (
      <>
        <Topbar crumbs={crumbs} />
        <EmptyState icon={<Building2 className="size-5" />} title="Open an organization first" body={orgs.length ? "Pick one to see its members, teams and settings." : "Create one from the workspace menu at the top of the sidebar."} className="mt-24">
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {orgs.map((o) => (
              <Button key={o.id} size="sm" onClick={() => switchWorkspace(o.id, "/org")}>
                {o.name}
              </Button>
            ))}
          </div>
        </EmptyState>
      </>
    );
  }
  if (q.error) {
    return (
      <>
        <Topbar crumbs={crumbs} />
        <EmptyState icon={<Building2 className="size-5" />} title="This organization isn't available" body={q.error.message} className="mt-24">
          <Button className="mt-3" onClick={() => switchWorkspace(null)}>Back to your workspace</Button>
        </EmptyState>
      </>
    );
  }
  const d = q.data;
  const admin = d ? d.me.role === "owner" || d.me.role === "admin" : false;
  const tabs: { value: Tab; label: string }[] = [
    { value: "general", label: "General" },
    { value: "members", label: d ? `Members · ${d.members.length}` : "Members" },
    ...(admin ? [{ value: "invitations" as Tab, label: `Invitations${d?.stats?.pendingInvites ? ` · ${d.stats.pendingInvites}` : ""}` }] : []),
    { value: "teams", label: "Teams" },
    ...(admin ? [{ value: "policies" as Tab, label: "Policies" }, { value: "activity" as Tab, label: "Activity" }] : []),
  ];
  const shown = tabs.some((t) => t.value === tab) ? tab : "general";
  return (
    <>
      <Topbar crumbs={[{ title: d?.org.name ?? "Organization", href: "/org" }]} />
      <div className="min-h-0 flex-1 overflow-y-auto" id="page-scroll">
        <div className="mx-auto w-full max-w-[920px] px-4 pb-24 pt-8 sm:px-10">
          <p className="font-mono text-[11px] font-bold tracking-[.16em] text-fg-3">ORGANIZATION{d ? ` · ${ROLE_LABEL[d.me.role].toUpperCase()}` : ""}</p>
          <h1 className="mt-1 text-[30px] font-bold tracking-tight">{d?.org.name ?? <Skeleton className="h-9 w-48" />}</h1>
          {d && d.org.standing !== "active" && (
            <p role="alert" className="mt-3 rounded-lg bg-warning-soft px-3 py-2 text-[13px]">
              {d.org.standing === "suspended" ? "Max's admins made this organization read-only. You can read everything but not change it." : "This organization is locked."}
            </p>
          )}
          <div className="mt-5 max-w-full overflow-x-auto">
            <Segmented label="Organization section" value={shown} onChange={(v) => setTab(v as Tab)} options={tabs} />
          </div>
          {!d ? (
            <div className="mt-6 grid gap-3"><Skeleton className="h-24" /><Skeleton className="h-48" /></div>
          ) : shown === "general" ? (
            <General d={d} admin={admin} />
          ) : shown === "members" ? (
            <Members d={d} admin={admin} />
          ) : shown === "invitations" ? (
            <InvitationsTab d={d} />
          ) : shown === "teams" ? (
            <Teams d={d} admin={admin} />
          ) : shown === "policies" ? (
            <Policies d={d} />
          ) : (
            <Activity orgId={d.org.id} />
          )}
        </div>
      </div>
    </>
  );
}

function General({ d, admin }: { d: OrgDetails; admin: boolean }) {
  const api = useOrgApi();
  const [name, setName] = useState(d.org.name);
  const [description, setDescription] = useState(d.org.description);
  const [busy, setBusy] = useState(false);
  const [danger, setDanger] = useState<"transfer" | "delete" | null>(null);
  const dirty = name.trim() !== d.org.name || description.trim() !== d.org.description;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.call("update", { orgId: d.org.id, name: name.trim(), description: description.trim() });
      toast.success("Saved");
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  const leave = async () => {
    if (!(await confirmAction({ title: `Leave ${d.org.name}?`, body: "You lose access to its pages right away. An admin can invite you again.", confirmLabel: "Leave", tone: "danger" }))) return;
    try {
      await api.call("leave", { orgId: d.org.id });
      toast.success(`You left ${d.org.name}`);
      switchWorkspace(null);
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <div className="mt-6 grid gap-6">
      {d.stats && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            ["Members", d.stats.members],
            ["Pending invitations", d.stats.pendingInvites],
            ["Teamspaces", d.stats.teamspaces],
            ["Pages", d.stats.pages],
            ["Databases", d.stats.databases],
            ["Storage", bytes(d.stats.storageBytes)],
          ].map(([k, v]) => (
            <div key={k} className="settings-card py-3">
              <dt className="text-[12px] text-fg-3">{k}</dt>
              <dd className="mt-0.5 text-[20px] font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      <form onSubmit={save} className="settings-card grid gap-3 py-4">
        <Field label="Name" htmlFor="org-settings-name">
          <Input id="org-settings-name" value={name} maxLength={80} disabled={!admin} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="org-settings-description">
          <Textarea id="org-settings-description" value={description} maxLength={500} rows={2} disabled={!admin} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <p className="text-[12.5px] text-fg-3">Address: {d.org.slug} · created {dateTime(d.org.createdAt)}</p>
        {admin && (
          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="sm" pending={busy} disabled={!dirty || !name.trim()}>Save</Button>
          </div>
        )}
      </form>
      <section className="settings-card grid gap-3 py-4">
        <h2 className="text-[13px] font-medium text-fg-3">Membership</h2>
        {d.me.role === "owner" ? (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Crown className="size-3.5" />} onClick={() => setDanger("transfer")}>Transfer ownership</Button>
            <Button size="sm" variant="danger" icon={<Trash2 className="size-3.5" />} onClick={() => setDanger("delete")}>Delete organization</Button>
          </div>
        ) : (
          <div>
            <Button size="sm" variant="danger" icon={<LogOut className="size-3.5" />} onClick={leave}>Leave organization</Button>
          </div>
        )}
      </section>
      {danger && <OwnerAction d={d} kind={danger} onClose={() => setDanger(null)} />}
    </div>
  );
}

function OwnerAction({ d, kind, onClose }: { d: OrgDetails; kind: "transfer" | "delete"; onClose: () => void }) {
  const api = useOrgApi();
  const candidates = d.members.filter((m) => m.status === "active" && (m.role === "admin" || m.role === "member"));
  const [next, setNext] = useState(candidates.find((m) => m.role === "admin")?.accountId ?? candidates[0]?.accountId ?? "");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      if (kind === "transfer") {
        await api.call("transfer", { orgId: d.org.id, nextOwnerId: next, confirmName: confirm });
        toast.success("Ownership transferred. You're now an admin.");
      } else {
        await api.call("remove", { orgId: d.org.id, confirmName: confirm });
        toast.success(`${d.org.name} was deleted`);
        switchWorkspace(null);
      }
      onClose();
    } catch (err) {
      notifyError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={kind === "transfer" ? "Transfer ownership" : `Delete ${d.org.name}?`}
      description={kind === "transfer" ? "The new owner gets every permission, including deleting the organization. You stay on as an admin." : "Every page, database, file and its history in this organization is permanently deleted, for everyone. This can't be undone."}
    >
      <div className="grid gap-3 px-5 pb-5 pt-2 text-[13px]">
        {kind === "transfer" &&
          (candidates.length ? (
            <label className="grid gap-1.5">
              New owner
              <select value={next} onChange={(e) => setNext(e.target.value)} className="h-9 rounded-md bg-surface px-2 shadow-[0_0_0_1px_var(--line)]">
                {candidates.map((m) => (
                  <option key={m.accountId} value={m.accountId}>{m.name || m.email || m.accountId} ({ROLE_LABEL[m.role]})</option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-fg-3">Invite someone as an admin or member first.</p>
          ))}
        <label className="grid gap-1.5">
          Type <b>{d.org.name}</b> to confirm
          <Input value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Organization name" />
        </label>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={kind === "delete" ? "danger" : "primary"} pending={busy} disabled={confirm !== d.org.name || (kind === "transfer" && !next)} onClick={submit}>
            {kind === "transfer" ? "Transfer" : "Delete forever"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function Members({ d, admin }: { d: OrgDetails; admin: boolean }) {
  const api = useOrgApi();
  const [inviting, setInviting] = useState(false);
  const [q, setQ] = useState("");
  const teams = useMemo(() => new Map(d.teams.map((t) => [t.id, t.name])), [d.teams]);
  const canInvite = admin || (d.org.policies.membersCanInvite && d.me.role === "member");
  const shown = d.members.filter((m) => !q.trim() || `${m.name ?? ""} ${m.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const act = async (m: OrgMember, args: Record<string, unknown>, done: string) => {
    try {
      await api.call("member", { orgId: d.org.id, accountId: m.accountId, ...args });
      toast.success(done);
    } catch (err) {
      notifyError(err);
    }
  };
  const manageable = (m: OrgMember) => admin && m.accountId !== d.me.accountId && m.role !== "owner" && (d.me.role === "owner" || m.role !== "admin");
  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members" aria-label="Search members" className="h-9 min-w-[200px] flex-1" />
        {canInvite && <Button variant="primary" icon={<Mail className="size-3.5" />} onClick={() => setInviting(true)}>Invite people</Button>}
      </div>
      <ul className="settings-card divide-y divide-line py-1" aria-label="Members">
        {shown.map((m) => (
          <li key={m.accountId} className="flex items-center gap-3 py-2.5">
            {m.image ? <img src={m.image} alt="" className="size-8 shrink-0 rounded-full object-cover" /> : <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold" aria-hidden>{(m.name || m.email || "?").charAt(0).toUpperCase()}</span>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-medium">{m.name || m.email || "Member"}{m.accountId === d.me.accountId ? <span className="text-fg-3"> (you)</span> : null}</p>
              <p className="truncate text-[12px] text-fg-3">
                {m.email ?? ""}{m.teams.length ? `${m.email ? " · " : ""}${m.teams.map((t) => teams.get(t)).filter(Boolean).join(", ")}` : ""}
                {m.status === "suspended" ? " · suspended" : ""}
              </p>
            </div>
            <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", m.role === "owner" ? "bg-accent-soft text-accent-text" : m.role === "admin" ? "bg-warning-soft" : "bg-surface-2 text-fg-2")}>{ROLE_LABEL[m.role]}</span>
            {manageable(m) && (
              <Menu>
                <MenuTrigger asChild>
                  <IconButton label={`Manage ${m.name || m.email || "member"}`} size="sm"><MoreHorizontal className="size-4" /></IconButton>
                </MenuTrigger>
                <MenuContent align="end">
                  {(["admin", "member", "guest"] as const)
                    .filter((r) => r !== m.role && (r !== "admin" || d.me.role === "owner"))
                    .map((r) => (
                      <MenuItem key={r} icon={<Users />} onSelect={() => act(m, { action: "role", role: r }, `${m.name || m.email} is now ${ROLE_LABEL[r].toLowerCase()}`)}>
                        Make {ROLE_LABEL[r].toLowerCase()}
                      </MenuItem>
                    ))}
                  <MenuSeparator />
                  {m.status === "active" ? (
                    <MenuItem icon={<RotateCcw />} onSelect={() => act(m, { action: "status", status: "suspended" }, "Membership suspended")}>Suspend</MenuItem>
                  ) : (
                    <MenuItem icon={<RotateCcw />} onSelect={() => act(m, { action: "status", status: "active" }, "Membership restored")}>Restore</MenuItem>
                  )}
                  <MenuItem
                    icon={<UserMinus />}
                    danger
                    onSelect={async () => {
                      if (await confirmAction({ title: `Remove ${m.name || m.email}?`, body: "They lose access to the organization immediately, including pages shared with them here.", confirmLabel: "Remove", tone: "danger" })) await act(m, { action: "remove" }, "Removed");
                    }}
                  >
                    Remove from organization
                  </MenuItem>
                </MenuContent>
              </Menu>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12.5px] text-fg-3">
        Owners and admins manage people and settings. Members read and edit the organization&apos;s pages. Guests only see the pages shared with them.
      </p>
      {inviting && <InviteDialog d={d} onClose={() => setInviting(false)} />}
    </div>
  );
}

function InviteDialog({ d, onClose }: { d: OrgDetails; onClose: () => void }) {
  const api = useOrgApi();
  const [emails, setEmails] = useState("");
  const [role, setRole] = useState<Exclude<OrgRole, "owner">>("member");
  const [busy, setBusy] = useState(false);
  const admin = d.me.role === "owner" || d.me.role === "admin";
  const roles = (["member", "guest", "admin"] as const).filter((r) => (r === "admin" ? d.me.role === "owner" : admin || r === "member"));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const list = emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      const r = await api.call<{ invited: string[]; skipped: { email: string; reason: string }[] }>("invite", { orgId: d.org.id, emails: list, role });
      toast.success(r.invited.length ? `Invited ${r.invited.length} ${r.invited.length === 1 ? "person" : "people"}. They'll see it in Max when they sign in with that email.` : "No one new to invite.");
      for (const s of r.skipped) toast.message(`${s.email}: ${s.reason}`);
      onClose();
    } catch (err) {
      notifyError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Invite to ${d.org.name}`} description="Invitations are tied to each email address. Only someone signed in to Max with that verified email can accept, within 14 days.">
      <form onSubmit={submit} className="grid gap-3 px-5 pb-5 pt-2">
        <Field label="Email addresses" htmlFor="invite-emails" help="Separate several with commas or new lines (up to 50).">
          <Textarea id="invite-emails" autoFocus rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="sam@company.com, lee@company.com" />
        </Field>
        <Segmented label="Role" value={role} onChange={(v) => setRole(v as typeof role)} options={roles.map((r) => ({ value: r, label: ROLE_LABEL[r] }))} />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" pending={busy} disabled={!emails.trim()}>Send invitations</Button>
        </div>
      </form>
    </Dialog>
  );
}

function InvitationsTab({ d }: { d: OrgDetails }) {
  const api = useOrgApi();
  const [show, setShow] = useState<"pending" | "all">("pending");
  const list = d.invitations.filter((i) => show === "all" || i.status === "pending");
  const act = async (id: string, action: "revoke" | "resend") => {
    try {
      await api.call("answerInvite", { inviteId: id, action });
      toast.success(action === "revoke" ? "Invitation revoked" : "Invitation renewed for 14 days");
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <div className="mt-6">
      <div className="mb-3 flex justify-end">
        <Segmented label="Show" value={show} onChange={(v) => setShow(v as typeof show)} options={[{ value: "pending", label: "Pending" }, { value: "all", label: "History" }]} />
      </div>
      {list.length === 0 ? (
        <EmptyState icon={<Mail className="size-5" />} title={show === "pending" ? "No pending invitations" : "No invitations yet"} body="Invite people from the Members tab." />
      ) : (
        <ul className="settings-card divide-y divide-line py-1" aria-label="Invitations">
          {list.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5 text-[13.5px]">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{i.email}</p>
                <p className="text-[12px] text-fg-3">
                  {ROLE_LABEL[i.role]} · {i.invitedByName ? `by ${i.invitedByName} · ` : ""}sent {timeAgo(i.createdAt)}
                  {i.status === "pending" ? ` · expires ${timeAgo(i.expiresAt)}` : ""}
                </p>
              </div>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] capitalize text-fg-2">{i.status}</span>
              {(i.status === "pending" || i.status === "expired") && (
                <div className="flex gap-1">
                  <Button size="xs" variant="ghost" onClick={() => act(i.id, "resend")}>{i.status === "expired" ? "Renew" : "Resend"}</Button>
                  <Button size="xs" variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => act(i.id, "revoke")}>Revoke</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Teams({ d, admin }: { d: OrgDetails; admin: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const people = new Map(d.members.map((m) => [m.accountId, m]));
  return (
    <div className="mt-6">
      {admin && (
        <div className="mb-3 flex justify-end">
          <Button variant="primary" icon={<Users className="size-3.5" />} onClick={() => setEditing("new")}>New team</Button>
        </div>
      )}
      {d.teams.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title="No teams yet" body={admin ? "Group people into departments or teams, like Design or Operations." : "Your admins haven't created any teams yet."} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" aria-label="Teams">
          {d.teams.map((t) => (
            <li key={t.id} className={cn("settings-card py-3", t.archivedAt && "opacity-60")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name}{t.archivedAt ? " (archived)" : ""}</p>
                  {t.description && <p className="text-[12.5px] text-fg-3">{t.description}</p>}
                </div>
                {admin && <Button size="xs" variant="ghost" onClick={() => setEditing(t.id)}>Edit</Button>}
              </div>
              <p className="mt-2 text-[12.5px] text-fg-2">
                {t.memberIds.length ? t.memberIds.map((id) => people.get(id)?.name || people.get(id)?.email || "Member").join(", ") : "No one yet"}
              </p>
            </li>
          ))}
        </ul>
      )}
      {editing && <TeamDialog d={d} teamId={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TeamDialog({ d, teamId, onClose }: { d: OrgDetails; teamId: string | null; onClose: () => void }) {
  const api = useOrgApi();
  const team = d.teams.find((t) => t.id === teamId) ?? null;
  const [name, setName] = useState(team?.name ?? "");
  const [description, setDescription] = useState(team?.description ?? "");
  const [members, setMembers] = useState<Set<string>>(new Set(team?.memberIds ?? []));
  const [busy, setBusy] = useState(false);
  const save = async (patch: Record<string, unknown> = {}) => {
    setBusy(true);
    try {
      await api.call("team", { orgId: d.org.id, ...(teamId ? { teamId } : {}), name: name.trim(), description: description.trim(), memberIds: [...members], ...patch });
      toast.success(teamId ? "Team saved" : "Team created");
      onClose();
    } catch (err) {
      notifyError(err);
      setBusy(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={team ? `Edit ${team.name}` : "New team"}>
      <form onSubmit={(e) => (e.preventDefault(), void save())} className="grid gap-3 px-5 pb-5 pt-2">
        <Field label="Name" htmlFor="team-name">
          <Input id="team-name" autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Design" />
        </Field>
        <Field label="Description" htmlFor="team-description">
          <Input id="team-description" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <fieldset className="grid max-h-56 gap-1 overflow-y-auto">
          <legend className="mb-1 text-[13px] font-medium">People</legend>
          {d.members.map((m) => (
            <label key={m.accountId} className="flex items-center gap-2 rounded px-1 py-1 text-[13px] hover:bg-hover">
              <input type="checkbox" checked={members.has(m.accountId)} onChange={(e) => setMembers((s) => { const n = new Set(s); if (e.target.checked) n.add(m.accountId); else n.delete(m.accountId); return n; })} />
              <span className="min-w-0 flex-1 truncate">{m.name || m.email || "Member"}</span>
              <span className="text-[12px] text-fg-3">{ROLE_LABEL[m.role]}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2">
          {team && (
            <Button variant="ghost" className="me-auto" onClick={() => save({ archived: !team.archivedAt })}>
              {team.archivedAt ? "Restore team" : "Archive team"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" pending={busy} disabled={!name.trim()}>{team ? "Save" : "Create team"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

const POLICY_COPY: Record<keyof OrgPolicies, { title: string; body: string }> = {
  membersCanInvite: { title: "Members can invite members", body: "Otherwise only admins send invitations." },
  allowGuests: { title: "Share pages outside the organization", body: "Lets people share pages with guests by email or with a Max link. Turning it off stops new outside shares; existing ones stay until removed." },
  allowPublicLinks: { title: "Publish pages to the web", body: "Lets pages get a public link that works without a Max account." },
  allowSites: { title: "Publish websites", body: "Lets admins publish pages as websites." },
};

function Policies({ d }: { d: OrgDetails }) {
  const api = useOrgApi();
  const set = async (key: keyof OrgPolicies, value: boolean) => {
    try {
      await api.call("setPolicies", { orgId: d.org.id, [key]: value });
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <div className="settings-card mt-6 divide-y divide-line py-1">
      {(Object.keys(POLICY_COPY) as (keyof OrgPolicies)[]).map((k) => (
        <div key={k} className="flex items-center gap-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">{POLICY_COPY[k].title}</p>
            <p className="text-[12.5px] text-fg-3">{POLICY_COPY[k].body}</p>
          </div>
          <Switch checked={d.org.policies[k]} onCheckedChange={(v) => set(k, v)} label={POLICY_COPY[k].title} />
        </div>
      ))}
    </div>
  );
}

function Activity({ orgId }: { orgId: string }) {
  const [action, setAction] = useState("");
  const q = useOrgAudit(orgId, action.trim() || undefined);
  return (
    <div className="mt-6">
      <Input value={action} onChange={(e) => setAction(e.target.value)} placeholder="Filter, e.g. member or invite" aria-label="Filter activity" className="mb-3 h-9 max-w-[280px]" />
      <div className="settings-card py-3">{q.data ? <EventList events={q.data.events.map((e) => ({ ...e, ownerId: orgId }))} empty="Nothing recorded yet." /> : <Skeleton className="h-40" />}</div>
    </div>
  );
}
