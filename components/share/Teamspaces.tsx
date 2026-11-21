"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, LockKeyhole, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, Field, IconButton, Input, Segmented, Select, cn } from "@/components/ui";
import { ShareScope, invalidateLocal, useOp, useSharing } from "@/lib/client/data";
import { ACCESS_COPY, MemberPicker, type Access } from "@/components/org/PageAccess";
import { isOrgId } from "@/lib/client/organizations";
import { activeWorkspace } from "@/lib/client/workspace";
import { pageHref } from "@/lib/pageUrl";
import type { ShareLevel } from "@/lib/domain/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { PageTree } from "@/components/workspace/PageTree";
import { teamspaceMembers } from "@/lib/client/teamspaces";
import { SharedRow } from "./SharedSection";
import { findPerson } from "./ShareMenu";

const ICONS = ["🏡", "🚀", "🎨", "📚", "🌱", "💼", "🎓", "🧪"];

interface SharedRoot {
  _id: string;
  title: string;
  icon: string | null;
  kind: "page" | "database";
  level: ShareLevel;
  ownerName: string | null;
  teamspace?: boolean;
}

/**
 * Teamspaces: shared workspaces inside Max. A teamspace is a top-level page shared with a group;
 * everyone in it sees it here with everything inside, edits it live and adds pages to it.
 */
/** Opens the New teamspace dialog (the + on the Teamspaces section header). */
export const NEW_TEAMSPACE_EVENT = "max:new-teamspace";

/** The Teamspaces section's contents: yours, and ones you're in. The header comes from the sidebar. */
export function TeamspacesList() {
  const ws = useWorkspace();
  const inOrg = isOrgId(activeWorkspace());
  const shared = useSharing<SharedRoot[]>("withMe", {});
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const open = () => setCreating(true);
    window.addEventListener(NEW_TEAMSPACE_EVENT, open);
    return () => window.removeEventListener(NEW_TEAMSPACE_EVENT, open);
  }, []);
  const inside = ws.tree ? teamspaceMembers(ws.tree) : new Set<string>();
  const mine = ws.tree?.filter((p) => inside.has(p._id)) ?? [];
  const theirs = shared.data?.filter((p) => p.teamspace) ?? [];
  return (
    <>
      {mine.length > 0 && <PageTree pages={mine} label={inOrg ? "Teamspaces" : "Your teamspaces"} />}
      {theirs.length > 0 && (
        <ul role="tree" aria-label="Teamspaces you're in" className="mt-px">
          {theirs.map((p) => (
            <ShareScope key={p._id} value={{ pageId: p._id, linkToken: null }}>
              <SharedRow page={p} depth={0} owner={p.ownerName} />
            </ShareScope>
          ))}
        </ul>
      )}
      {!mine.length && !theirs.length && (
        <button type="button" onClick={() => setCreating(true)} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2">
          <Plus className="size-3.5" /> New teamspace
        </button>
      )}
      {inOrg && <ClosedTeamspaces />}
      {inOrg ? <NewOrgTeamspace open={creating} onOpenChange={setCreating} /> : <NewTeamspace open={creating} onOpenChange={setCreating} />}
    </>
  );
}

/** Closed teamspaces you aren't in: their name, and a way to ask to join. */
function ClosedTeamspaces() {
  const ws = useWorkspace();
  const q = useOp<{ pages: { id: string; title: string; icon: string | null }[] }>("teamspaces.locked", {});
  const [asked, setAsked] = useState<Set<string>>(new Set());
  if (!q.data?.pages.length) return null;
  return (
    <ul aria-label="Closed teamspaces" className="mt-px">
      {q.data.pages.map((p) => (
        <li key={p.id} className="group flex h-7 items-center gap-2 rounded-md ps-2 pe-1 text-[13.5px] text-fg-3">
          <LockKeyhole className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{p.icon && p.icon.length <= 4 ? `${p.icon} ` : ""}{p.title}</span>
          <button
            type="button"
            disabled={asked.has(p.id)}
            className="rounded px-1.5 text-[12px] text-accent-text opacity-0 hover:bg-hover focus-visible:opacity-100 group-hover:opacity-100 disabled:text-fg-3 disabled:opacity-100"
            onClick={async () => {
              try {
                await ws.call("teamspaces.requestJoin", { pageId: p.id });
                setAsked((s) => new Set(s).add(p.id));
                toast.success(`Asked to join “${p.title}”`);
              } catch (err) {
                notifyError(err);
              }
            }}
          >
            {asked.has(p.id) ? "Asked" : "Ask to join"}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** An organization's new teamspace: name, icon, and Open, Closed or Private with its members. */
function NewOrgTeamspace({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(ICONS[1]);
  const [mode, setMode] = useState<Access>("open");
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { page } = await ws.call<{ page: { _id: string; title: string } }>("pages.create", { title: name.trim(), icon, teamspace: true });
      if (mode !== "open") await ws.call("access.set", { pageId: page._id, memberIds: members, listed: mode === "closed" });
      toast.success(`Created “${page.title}”`);
      onOpenChange(false);
      setName("");
      setMembers([]);
      router.push(pageHref(page._id, page.title));
    } catch (err) {
      notifyError(err, "Couldn't create the teamspace.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New teamspace" description="An area of the organization for a team or topic, like Engineering or Marketing, with its own pages and members.">
      <form onSubmit={submit} className="grid gap-4 px-5 pb-5 pt-2">
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Teamspace icon">
          {ICONS.map((i) => (
            <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)} className={cn("grid size-8 place-items-center rounded-md text-[17px] hover:bg-hover", icon === i && "bg-hover shadow-[inset_0_0_0_1.5px_var(--fg)]")}>
              {i}
            </button>
          ))}
        </div>
        <Field label="Name" htmlFor="org-teamspace-name">
          <Input id="org-teamspace-name" autoFocus value={name} maxLength={80} placeholder="Engineering, Marketing, Handbook…" onChange={(e) => setName(e.target.value)} required />
        </Field>
        <div className="grid gap-1.5">
          <Segmented label="Access" value={mode} onChange={(v) => setMode(v as Access)} options={(Object.keys(ACCESS_COPY) as Access[]).map((k) => ({ value: k, label: ACCESS_COPY[k].label }))} />
          <p className="text-[12.5px] text-fg-3">{ACCESS_COPY[mode].hint}</p>
        </div>
        {mode !== "open" && (
          <Field label="Members" htmlFor="org-teamspace-members" help="You're added automatically. Admins always have access.">
            <MemberPicker value={members} onChange={setMembers} />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" pending={busy} disabled={!name.trim()}>Create teamspace</Button>
        </div>
      </form>
    </Dialog>
  );
}

function NewTeamspace({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState(ICONS[0]);
  const [emails, setEmails] = useState("");
  const [level, setLevel] = useState<ShareLevel>("edit");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      // Find everyone first, so a mistyped email doesn't leave a half-made teamspace.
      const people = [];
      for (const address of emails.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) people.push(await findPerson(address));
      const { page } = await ws.call<{ page: { _id: string; title: string } }>("pages.create", { title: name.trim(), icon, teamspace: true });
      for (const person of people) {
        await ws.call("shares.invite", { pageId: page._id, granteeId: person.id, email: person.email, name: person.name, image: person.image, level });
      }
      await invalidateLocal().catch(() => undefined);
      toast.success(people.length ? `Created “${page.title}” with ${people.length} ${people.length === 1 ? "person" : "people"}` : `Created “${page.title}”. Add people from its Share menu.`);
      onOpenChange(false);
      setName("");
      setEmails("");
      router.push(pageHref(page._id, page.title));
    } catch (err) {
      notifyError(err, "Couldn't create the teamspace.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New teamspace" description="A shared space for a group: everyone you add can open, edit and add pages to everything inside it.">
      <form onSubmit={submit} className="grid gap-4 px-5 pb-5 pt-2">
        <div className="flex items-end gap-2">
          <div className="grid gap-1.5">
            <span className="text-[13px] font-medium text-fg">Icon</span>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Teamspace icon">
              {ICONS.map((i) => (
                <button key={i} type="button" role="radio" aria-checked={icon === i} aria-label={i} onClick={() => setIcon(i)} className={cn("grid size-8 place-items-center rounded-md text-[17px] hover:bg-hover", icon === i && "bg-hover shadow-[inset_0_0_0_1.5px_var(--fg)]")}>
                  {i}
                </button>
              ))}
            </div>
          </div>
        </div>
        <Field label="Name" htmlFor="teamspace-name">
          <Input id="teamspace-name" autoFocus value={name} maxLength={80} placeholder="Family, Book club, Side project…" onChange={(e) => setName(e.target.value)} required />
        </Field>
        <Field label="Add people" htmlFor="teamspace-people" help="Their Max email addresses, separated by commas. You can add more later from Share.">
          <div className="flex items-center gap-2">
            <Input id="teamspace-people" className="flex-1" value={emails} inputMode="email" placeholder="sam@example.com, lina@example.com" onChange={(e) => setEmails(e.target.value)} />
            <Select label="Access for people you add" size="sm" variant="ghost" value={level} onChange={setLevel} options={[{ value: "full_access", label: "Full access" }, { value: "edit", label: "Can edit" }, { value: "comment", label: "Can comment" }, { value: "view", label: "Can view" }]} />
          </div>
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" pending={busy} disabled={!name.trim()}>
            Create teamspace
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
