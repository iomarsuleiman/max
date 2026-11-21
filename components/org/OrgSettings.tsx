"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Building2, Crown, KeyRound, LogOut, Mail, MoreHorizontal, RotateCcw, Trash2, UserMinus, Users } from "@/components/icons";
import { toast } from "sonner";
import { Button, Dialog, EmptyState, Field, IconButton, Input, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Segmented, Select, Skeleton, Switch, Textarea, cn, confirmAction } from "@/components/ui";
import { Topbar } from "@/components/workspace/Topbar";
import { notifyError } from "@/components/workspace/context";
import { useWorkspaces } from "@/components/workspace/Workspaces";
import { EventList } from "@/components/admin/shared";
import { OrgAccessSection } from "./PageAccess";
import { NEW_TEAMSPACE_EVENT } from "@/components/share/Teamspaces";
import { useWorkspace } from "@/components/workspace/context";
import { pageHref } from "@/lib/pageUrl";
import { useOp } from "@/lib/client/data";
import { ROLE_LABEL, isOrgId, useOrgApi, useOrgAudit, useOrgDetails, type OrgDetails, type OrgMember, type OrgPolicies, type OrgRole } from "@/lib/client/organizations";
import { activeWorkspace, switchWorkspace } from "@/lib/client/workspace";
import { bytes, dateTime, timeAgo } from "@/lib/client/format";

type Tab = "general" | "insights" | "members" | "invitations" | "teamspaces" | "teams" | "policies" | "activity";

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
    { value: "insights", label: "Insights" },
    { value: "members", label: d ? `Members · ${d.members.length}` : "Members" },
    ...(admin ? [{ value: "invitations" as Tab, label: `Invitations${d?.stats?.pendingInvites ? ` · ${d.stats.pendingInvites}` : ""}` }] : []),
    { value: "teamspaces", label: "Teamspaces" },
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
          ) : shown === "insights" ? (
            <Insights admin={admin} />
          ) : shown === "members" ? (
            <Members d={d} admin={admin} />
          ) : shown === "invitations" ? (
            <InvitationsTab d={d} />
          ) : shown === "teamspaces" ? (
            <TeamspacesTab d={d} />
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
      {d.me.role === "owner" && <SecurityPhrase d={d} />}
      {danger && <OwnerAction d={d} kind={danger} onClose={() => setDanger(null)} />}
    </div>
  );
}

type PhraseResult = { ok: boolean; message?: string };

function OwnerAction({ d, kind, onClose }: { d: OrgDetails; kind: "transfer" | "delete"; onClose: () => void }) {
  const api = useOrgApi();
  const candidates = d.members.filter((m) => m.status === "active" && (m.role === "admin" || m.role === "member"));
  const [next, setNext] = useState(candidates.find((m) => m.role === "admin")?.accountId ?? candidates[0]?.accountId ?? "");
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const phraseSet = !!d.security?.phraseSet;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.call<PhraseResult>(kind === "transfer" ? "transfer" : "remove", kind === "transfer" ? { orgId: d.org.id, nextOwnerId: next, phrase } : { orgId: d.org.id, phrase });
      if (!r.ok) {
        setError(r.message ?? "That didn't work.");
        setBusy(false);
        return;
      }
      if (kind === "transfer") toast.success("Ownership transferred. You're now an admin.");
      else {
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
      <form onSubmit={submit} className="grid gap-3 px-5 pb-5 pt-2 text-[13px]">
        {!phraseSet ? (
          <p className="rounded-lg bg-warning-soft px-3 py-2">Set the organization&apos;s security phrase first, under <b>Security</b> on this page. It protects this action, without needing a password.</p>
        ) : (
          <>
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
            <Field label="Security phrase" htmlFor="owner-phrase" error={error ?? undefined}>
              <Input id="owner-phrase" type="password" autoComplete="off" autoFocus value={phrase} onChange={(e) => setPhrase(e.target.value)} invalid={!!error} />
            </Field>
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {phraseSet && (
            <Button type="submit" variant={kind === "delete" ? "danger" : "primary"} pending={busy} disabled={!phrase || (kind === "transfer" && !next)}>
              {kind === "transfer" ? "Transfer" : "Delete forever"}
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}

/** The owner's security phrase: asked before transfer and deletion instead of a password. */
function SecurityPhrase({ d }: { d: OrgDetails }) {
  const api = useOrgApi();
  const set = !!d.security?.phraseSet;
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = !!again && next !== again;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.call<PhraseResult>("setPhrase", { orgId: d.org.id, ...(set ? { current } : {}), next });
      if (!r.ok) setError(r.message ?? "That didn't work.");
      else {
        toast.success(set ? "Security phrase changed" : "Security phrase set");
        setOpen(false);
        setCurrent("");
        setNext("");
        setAgain("");
      }
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="settings-card grid gap-2 py-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-[13.5px] font-medium">Security phrase</h2>
          <p className="text-[12.5px] text-fg-3">
            {set ? "Set. Max asks for it before transferring ownership or deleting the organization." : "Protects transferring ownership and deleting the organization. It works with Google sign-in: no password or email needed."} Only a scrambled copy is stored; if you lose it, Max&apos;s admins can reset it while recovering ownership.
          </p>
        </div>
        <Button size="sm" variant={set ? "ghost" : "primary"} onClick={() => setOpen(true)}>{set ? "Change" : "Set phrase"}</Button>
      </div>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)} title={set ? "Change security phrase" : "Set a security phrase"} description="Use a sentence only you would know, at least 12 characters. Five wrong tries lock it for 15 minutes.">
          <form onSubmit={submit} className="grid gap-3 px-5 pb-5 pt-2">
            {set && (
              <Field label="Current phrase" htmlFor="phrase-current">
                <Input id="phrase-current" type="password" autoComplete="off" value={current} onChange={(e) => setCurrent(e.target.value)} />
              </Field>
            )}
            <Field label="New phrase" htmlFor="phrase-next">
              <Input id="phrase-next" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Type it again" htmlFor="phrase-again" error={mismatch ? "The two don't match." : (error ?? undefined)}>
              <Input id="phrase-again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} invalid={mismatch || !!error} />
            </Field>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button type="submit" variant="primary" pending={busy} disabled={next.trim().length < 12 || next !== again || (set && !current)}>Save phrase</Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}

function Members({ d, admin }: { d: OrgDetails; admin: boolean }) {
  const api = useOrgApi();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<OrgMember | null>(null);
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
                    onSelect={() => setRemoving(m)}
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
      {removing && <Offboard d={d} member={removing} onClose={() => setRemoving(null)} onRemove={(reassignTo) => act(removing, { action: "remove", reassignTo }, "Removed").then(() => setRemoving(null))} />}
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

type SwitchPolicy = "membersCanInvite" | "allowGuests" | "allowPublicLinks" | "allowSites";
const POLICY_COPY: Record<SwitchPolicy, { title: string; body: string }> = {
  membersCanInvite: { title: "Members can invite members", body: "Otherwise only admins send invitations." },
  allowGuests: { title: "Share pages outside the organization", body: "Lets people share pages with guests by email or with a Max link. Turning it off stops new outside shares; existing ones stay until removed." },
  allowPublicLinks: { title: "Publish pages to the web", body: "Lets pages get a public link that works without a Max account." },
  allowSites: { title: "Publish websites", body: "Lets admins publish pages as websites." },
};

function Policies({ d }: { d: OrgDetails }) {
  const api = useOrgApi();
  const [domain, setDomain] = useState(d.org.policies.autoJoinDomain ?? "");
  const set = async (patch: Partial<OrgPolicies>) => {
    try {
      await api.call("setPolicies", { orgId: d.org.id, ...patch });
      toast.success("Saved");
    } catch (err) {
      notifyError(err);
    }
  };
  const retention = (key: "trashRetentionDays" | "versionRetentionDays") => (
    <Select
      label={key === "trashRetentionDays" ? "Trash retention" : "History retention"}
      size="sm"
      variant="filled"
      value={String(d.org.policies[key] ?? "forever")}
      onChange={(v) => set({ [key]: v === "forever" ? null : Number(v) })}
      options={[{ value: "forever", label: "Keep forever" }, ...[7, 14, 30, 60, 90, 180, 365].map((n) => ({ value: String(n), label: `${n} days` }))]}
    />
  );
  return (
    <div className="mt-6 grid gap-6">
      <div className="settings-card divide-y divide-line py-1">
        {(Object.keys(POLICY_COPY) as SwitchPolicy[]).map((k) => (
          <div key={k} className="flex items-center gap-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">{POLICY_COPY[k].title}</p>
              <p className="text-[12.5px] text-fg-3">{POLICY_COPY[k].body}</p>
            </div>
            <Switch checked={!!d.org.policies[k]} onCheckedChange={(v) => set({ [k]: v })} label={POLICY_COPY[k].title} />
          </div>
        ))}
      </div>
      <div className="settings-card divide-y divide-line py-1">
        <div className="flex flex-wrap items-center gap-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">Trash</p>
            <p className="text-[12.5px] text-fg-3">Delete trashed pages for good after this long, checked daily. Admins can always restore them before then.</p>
          </div>
          {retention("trashRetentionDays")}
        </div>
        <div className="flex flex-wrap items-center gap-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">Page history</p>
            <p className="text-[12.5px] text-fg-3">Remove older versions after this long. Each page always keeps its latest version.</p>
          </div>
          {retention("versionRetentionDays")}
        </div>
        {d.me.role === "owner" && (
          <form
            className="flex flex-wrap items-center gap-3 py-3"
            onSubmit={(e) => {
              e.preventDefault();
              void set({ autoJoinDomain: domain.trim() || null });
            }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-medium">Join with a work email</p>
              <p className="text-[12.5px] text-fg-3">Anyone signed in with a verified email at this domain can join as a member, no invitation needed. Only your own company domain.</p>
            </div>
            <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="company.com" aria-label="Email domain" className="h-8 w-40" />
            <Button size="sm" type="submit">Save</Button>
          </form>
        )}
      </div>
      <p className="text-[12.5px] text-fg-3">Single sign-on (SAML or OIDC, e.g. Okta, Microsoft Entra, Google Workspace) is set up by Max&apos;s operators in the sign-in provider; once it&apos;s on for your domain, people sign in with it here automatically.</p>
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

/** Every teamspace you can see in the organization, with who can open it. Admins see them all. */
function TeamspacesTab({ d }: { d: OrgDetails }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState<string | null>(null);
  const spaces = (ws.tree ?? []).filter((p) => p.teamspace && !p.parentId);
  const teams = d.teams.filter((t) => !t.archivedAt).map((t) => ({ id: t.id, name: t.name }));
  return (
    <div className="mt-6">
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => window.dispatchEvent(new Event(NEW_TEAMSPACE_EVENT))}>New teamspace</Button>
      </div>
      {spaces.length === 0 ? (
        <EmptyState icon={<Users className="size-5" />} title="No teamspaces yet" body="Teamspaces are areas of the organization, like Engineering or Handbook, each with its own pages and members." />
      ) : (
        <ul className="settings-card divide-y divide-line py-1" aria-label="Teamspaces">
          {spaces.map((t) => (
            <li key={t._id} className="py-1">
              <div className="flex items-center gap-3 py-1.5">
                <span className="w-5 text-center" aria-hidden>{t.icon && t.icon.length <= 4 ? t.icon : "▢"}</span>
                <a href={pageHref(t._id, t.title)} className="min-w-0 flex-1 truncate text-[13.5px] font-medium hover:underline">{t.title || "Untitled"}</a>
                <Button size="xs" variant="ghost" onClick={() => setOpen(open === t._id ? null : t._id)}>{open === t._id ? "Close" : "Access"}</Button>
              </div>
              {open === t._id && <div className="-mx-4"><OrgAccessSection pageId={t._id} teams={teams} /></div>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[12.5px] text-fg-3">Open teamspaces are for everyone. Closed ones are listed so people can ask to join. Private ones are invisible to non-members.</p>
    </div>
  );
}

type Weeks = { weekStart: number; created: number; edited: number; comments: number; activePeople: number }[];

/** What's happening: recent activity for everyone; analytics and the wiki's review queue for admins. */
function Insights({ admin }: { admin: boolean }) {
  const activity = useOp<{ items: { at: number; kind: string; pageId: string; title: string; who: string | null }[] }>("activity.list", { limit: 30 });
  const stats = useOp<{ totals: Record<string, number>; weeks: Weeks; topContributors: { id: string; name: string; pagesEdited: number }[]; workload: { id: string; name: string; open: number }[]; pendingReviews: number }>("analytics.summary", admin ? {} : "skip");
  const stale = useOp<{ pages: { _id: string; title: string; expired: boolean; verification: { until: number; byName: string | null } }[] }>("pages.stale", {});
  const max = Math.max(1, ...(stats.data?.weeks ?? []).map((w) => w.edited));
  return (
    <div className="mt-6 grid gap-6">
      {admin && stats.data && (
        <section className="settings-card grid gap-4 py-4">
          <dl className="grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[["Pages", stats.data.totals.pages], ["Databases", stats.data.totals.databases], ["Rows", stats.data.totals.rows], ["Comments", stats.data.totals.comments], ["Verified", stats.data.totals.verified], ["Needs review", stats.data.totals.staleVerified]].map(([k, v]) => (
              <div key={k as string}>
                <dt className="text-[12px] text-fg-3">{k}</dt>
                <dd className="text-[20px] font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          <div>
            <h3 className="mb-2 text-[12px] font-medium text-fg-3">Pages edited per week · active people</h3>
            <div className="flex h-24 items-end gap-2" role="img" aria-label={`Pages edited per week: ${stats.data.weeks.map((w) => w.edited).join(", ")}`}>
              {stats.data.weeks.map((w) => (
                <div key={w.weekStart} className="flex flex-1 flex-col items-center gap-1" title={`Week of ${new Date(w.weekStart).toLocaleDateString()}: ${w.edited} edited, ${w.created} created, ${w.comments} comments, ${w.activePeople} people`}>
                  <div className="w-full rounded-t-[3px] bg-accent" style={{ height: `${Math.max(4, (w.edited / max) * 72)}px`, opacity: w.edited ? 1 : 0.25 }} />
                  <span className="text-[11px] tabular-nums text-fg-3">{w.activePeople}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-1.5 text-[12px] font-medium text-fg-3">Open tasks per person</h3>
              {stats.data.workload.length === 0 ? (
                <p className="text-[12.5px] text-fg-3">No assigned open tasks. Add a Person property to a database to assign work.</p>
              ) : (
                <ul className="grid gap-1">
                  {stats.data.workload.map((w) => (
                    <li key={w.id} className="flex items-center gap-2 text-[13px]">
                      <span className="min-w-0 flex-1 truncate">{w.name}</span>
                      <span className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.max(6, (w.open / stats.data!.workload[0].open) * 96)}px` }} aria-hidden />
                      <span className="w-6 text-end tabular-nums text-fg-2">{w.open}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <h3 className="mb-1.5 text-[12px] font-medium text-fg-3">Waiting for review</h3>
              <p className="text-[20px] font-semibold tabular-nums">{stats.data.pendingReviews}</p>
              <p className="text-[12.5px] text-fg-3">Review requests and suggested edits not yet decided.</p>
            </div>
          </div>
          {stats.data.topContributors.length > 0 && (
            <p className="text-[12.5px] text-fg-3">Most active (4 weeks): {stats.data.topContributors.map((c) => `${c.name} (${c.pagesEdited})`).join(", ")}</p>
          )}
        </section>
      )}
      {!!stale.data?.pages.length && (
        <section className="settings-card py-3">
          <h3 className="mb-1.5 text-[13px] font-medium text-fg-3">Wiki pages to review</h3>
          <ul className="grid gap-1">
            {stale.data.pages.map((p) => (
              <li key={p._id} className="flex items-center gap-2 text-[13px]">
                <a href={pageHref(p._id, p.title)} className="min-w-0 flex-1 truncate hover:underline">{p.title || "Untitled"}</a>
                <span className={p.expired ? "text-warning" : "text-fg-3"}>{p.expired ? "expired" : "expires"} {timeAgo(p.verification.until)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="settings-card py-3">
        <h3 className="mb-1.5 text-[13px] font-medium text-fg-3">Recent activity</h3>
        {!activity.data ? (
          <Skeleton className="h-32" />
        ) : activity.data.items.length === 0 ? (
          <p className="text-[13px] text-fg-3">Nothing yet.</p>
        ) : (
          <ul className="grid gap-0.5" aria-label="Recent activity">
            {activity.data.items.map((i, n) => (
              <li key={n} className="flex items-baseline gap-2 text-[13px]">
                <span className="w-24 shrink-0 text-fg-3">{timeAgo(i.at)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {i.who ? <b className="font-medium">{i.who}</b> : "Someone"} {i.kind} <a href={pageHref(i.pageId, i.title)} className="hover:underline">“{i.title}”</a>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Removing someone: they lose access at once; their assigned tasks go to whoever you pick. */
function Offboard({ d, member, onClose, onRemove }: { d: OrgDetails; member: OrgMember; onClose: () => void; onRemove: (reassignTo: string | null) => Promise<unknown> }) {
  const others = d.members.filter((m) => m.accountId !== member.accountId && m.status === "active" && m.role !== "guest");
  const [to, setTo] = useState<string>(d.me.accountId);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={`Remove ${member.name || member.email || "this member"}?`} description="They lose access to the organization immediately, including pages shared with them here. Their pages stay: they belong to the organization.">
      <div className="grid gap-3 px-5 pb-5 pt-2 text-[13px]">
        <Select
          label="Their assigned tasks go to"
          variant="filled"
          value={to}
          onChange={setTo}
          options={[...others.map((m) => ({ value: m.accountId, label: `Assign their tasks to ${m.accountId === d.me.accountId ? "me" : m.name || m.email || "member"}` })), { value: "", label: "Leave their tasks unassigned" }]}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" pending={busy} onClick={async () => (setBusy(true), await onRemove(to || null), setBusy(false))}>Remove</Button>
        </div>
      </div>
    </Dialog>
  );
}
