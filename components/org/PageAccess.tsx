"use client";

import { useState } from "react";
import { Check, Globe2, Lock, LockKeyhole, Users } from "@/components/icons";
import { toast } from "sonner";
import { Button, Segmented, Select, cn } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { notifyError, useWorkspace } from "@/components/workspace/context";

export type Access = "open" | "closed" | "private";
export interface AccessInfo {
  restricted: boolean;
  pageId: string;
  inheritedFrom: { id: string; title: string } | null;
  memberIds: string[];
  teamIds: string[];
  othersLevel: "none" | "view" | "comment";
  listed: boolean;
  canManage: boolean;
}
type Person = { id: string; name: string; email: string | null; image: string | null };

export const ACCESS_COPY: Record<Access, { label: string; hint: string; icon: typeof Globe2 }> = {
  open: { label: "Open", hint: "Everyone in the organization can open it.", icon: Globe2 },
  closed: { label: "Closed", hint: "Everyone sees it exists and can ask to join; only members open it.", icon: LockKeyhole },
  private: { label: "Private", hint: "Only its members know it exists.", icon: Lock },
};

export const accessOf = (a: Pick<AccessInfo, "restricted" | "listed" | "othersLevel"> | undefined): Access => (!a?.restricted ? "open" : a.listed ? "closed" : "private");

/** Picks members and teams (organization teams come from its settings). */
export function MemberPicker({ value, onChange, teams, teamIds, onTeams }: { value: string[]; onChange: (ids: string[]) => void; teams?: { id: string; name: string }[]; teamIds?: string[]; onTeams?: (ids: string[]) => void }) {
  const people = useOp<{ people: Person[] }>("people.list", {}).data?.people ?? [];
  const [q, setQ] = useState("");
  const shown = people.filter((p) => !q.trim() || `${p.name} ${p.email ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="grid gap-1.5">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" aria-label="Search people" className="h-8 rounded-md bg-surface-2 px-2 text-[13px] outline-none focus:shadow-[0_0_0_1px_var(--accent)]" />
      <div role="listbox" aria-multiselectable aria-label="Members" className="max-h-44 overflow-y-auto rounded-md shadow-[0_0_0_1px_var(--line)]">
        {teams?.map((t) => (
          <button key={t.id} type="button" role="option" aria-selected={!!teamIds?.includes(t.id)} onClick={() => onTeams?.(toggle(teamIds ?? [], t.id))} className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-[13px] hover:bg-hover">
            <Users className="size-4 text-fg-3" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{t.name} <span className="text-fg-3">· team</span></span>
            {teamIds?.includes(t.id) && <Check className="size-3.5 text-accent-text" aria-hidden />}
          </button>
        ))}
        {shown.map((p) => (
          <button key={p.id} type="button" role="option" aria-selected={value.includes(p.id)} onClick={() => onChange(toggle(value, p.id))} className="flex w-full items-center gap-2 px-2 py-1.5 text-start text-[13px] hover:bg-hover">
            {p.image ? <img src={p.image} alt="" className="size-5 rounded-full object-cover" /> : <span className="grid size-5 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold" aria-hidden>{p.name.charAt(0).toUpperCase()}</span>}
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {value.includes(p.id) && <Check className="size-3.5 text-accent-text" aria-hidden />}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * "Who in the organization can see this": Open, Closed or Private, the members and teams who
 * can, and what everyone else gets. Shown in the Share menu of organization pages.
 */
export function OrgAccessSection({ pageId, teams }: { pageId: string; teams?: { id: string; name: string }[] }) {
  const ws = useWorkspace();
  const q = useOp<AccessInfo>("access.get", { pageId });
  const [editing, setEditing] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [mode, setMode] = useState<Access>("open");
  const [others, setOthers] = useState<"none" | "view" | "comment">("none");
  const [busy, setBusy] = useState(false);
  const a = q.data;
  if (!a) return null;
  const current = accessOf(a);
  const Icon = ACCESS_COPY[current].icon;
  const start = () => {
    setMembers(a.memberIds);
    setTeamIds(a.teamIds);
    setMode(current === "open" ? "private" : current);
    setOthers(a.othersLevel);
    setEditing(true);
  };
  const save = async () => {
    setBusy(true);
    try {
      await ws.call("access.set", mode === "open" ? { pageId, open: true } : { pageId, memberIds: members, teamIds, othersLevel: mode === "private" ? others : "none", listed: mode === "closed" });
      toast.success(mode === "open" ? "Everyone in the organization can open it" : "Access updated");
      setEditing(false);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="border-b border-line px-4 py-3" aria-label="Organization access">
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-fg-3" aria-hidden />
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="font-medium">
            {ACCESS_COPY[current].label} in the organization{a.inheritedFrom ? <span className="font-normal text-fg-3"> · from “{a.inheritedFrom.title || "Untitled"}”</span> : null}
          </p>
          <p className="text-[12.5px] text-fg-3">
            {current === "open" ? ACCESS_COPY.open.hint : `${a.memberIds.length} ${a.memberIds.length === 1 ? "person" : "people"}${a.teamIds.length ? ` and ${a.teamIds.length} team${a.teamIds.length === 1 ? "" : "s"}` : ""}. ${a.othersLevel === "none" ? ACCESS_COPY[current].hint : `Everyone else can ${a.othersLevel}.`}`}
          </p>
        </div>
        {a.canManage && !a.inheritedFrom && !editing && <Button size="xs" variant="ghost" onClick={start}>Change</Button>}
      </div>
      {editing && (
        <div className="mt-3 grid gap-2.5">
          <Segmented label="Access" size="sm" value={mode} onChange={(v) => setMode(v as Access)} options={(Object.keys(ACCESS_COPY) as Access[]).map((k) => ({ value: k, label: ACCESS_COPY[k].label }))} />
          <p className="text-[12.5px] text-fg-3">{ACCESS_COPY[mode].hint} Admins always keep access.</p>
          {mode !== "open" && (
            <>
              <MemberPicker value={members} onChange={setMembers} teams={teams} teamIds={teamIds} onTeams={setTeamIds} />
              {mode === "private" && (
                <Select label="Everyone else" size="sm" variant="filled" value={others} onChange={(v) => setOthers(v as typeof others)} options={[{ value: "none", label: "Everyone else: no access" }, { value: "view", label: "Everyone else: can view" }, { value: "comment", label: "Everyone else: can comment" }]} />
              )}
            </>
          )}
          <div className={cn("flex justify-end gap-2")}>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button size="sm" variant="primary" pending={busy} onClick={save}>Save</Button>
          </div>
        </div>
      )}
    </section>
  );
}
