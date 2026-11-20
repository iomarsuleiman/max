"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, Field, IconButton, Input, Select, cn } from "@/components/ui";
import { ShareScope, invalidateLocal, useSharing } from "@/lib/client/data";
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
      {mine.length > 0 && <PageTree pages={mine} label="Your teamspaces" />}
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
      <NewTeamspace open={creating} onOpenChange={setCreating} />
    </>
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
