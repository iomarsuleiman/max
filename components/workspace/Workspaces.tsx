"use client";

import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import { IconPicker } from "@/components/page/IconPicker";
import { PageIcon } from "./PageIcon";
import { useOp } from "@/lib/client/data";
import { switchWorkspace } from "@/lib/client/workspace";
import { notifyError, useWorkspace } from "./context";

export interface WorkspaceItem {
  id: string | null;
  name: string;
  icon: string | null;
}

/** Your personal workspaces, and the one open in this browser. */
export function useWorkspaces() {
  const q = useOp<{ current: string | null; workspaces: WorkspaceItem[] }>("workspaces.list", {});
  // The workspace this browser remembered was deleted (maybe on another device): go back to the main one.
  const missing = (q.error as { details?: { workspace?: string } } | null)?.details?.workspace === "missing";
  useEffect(() => {
    if (missing) switchWorkspace(null);
  }, [missing]);
  const list = q.data?.workspaces ?? [];
  const current = list.find((w) => w.id === (q.data?.current ?? null)) ?? null;
  return { list, current, loading: !q.data };
}

/** A workspace's icon: its emoji or image, else Max's butterfly for the main one, else its initial. */
export function WorkspaceIcon({ workspace, size = 22 }: { workspace: WorkspaceItem | null; size?: number }) {
  if (workspace?.icon) return <PageIcon icon={workspace.icon} size={size} />;
  if (!workspace || workspace.id === null) return <LogoMark className="shrink-0" style={{ width: size, height: size }} />;
  return (
    <span className="workspace-initial" style={{ width: size, height: size, fontSize: size * 0.55 }} aria-hidden>
      {Array.from(workspace.name.trim())[0]?.toUpperCase() ?? "W"}
    </span>
  );
}

/** Name and icon for a new personal workspace; opens it once made. */
export function NewWorkspaceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { workspace } = await ws.call<{ workspace: { id: string } }>("workspaces.create", { name: name.trim(), icon });
      toast.success(`Opening ${name.trim()}`, { duration: 1500 });
      switchWorkspace(workspace.id);
    } catch (err) {
      notifyError(err, "Couldn't create the workspace.");
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="New workspace" description="A separate, private space with its own pages, databases, sidebar and colors.">
      <form onSubmit={submit} className="grid gap-4 px-5 pb-5 pt-2">
        <div className="flex items-end gap-3">
          <IconPicker
            pageId={null}
            onPick={setIcon}
            onRemove={() => setIcon(null)}
            trigger={
              <button type="button" aria-label="Choose an icon" className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover">
                <WorkspaceIcon workspace={{ id: "new", name: name || "W", icon }} size={22} />
              </button>
            }
          />
          <div className="min-w-0 flex-1">
            <Field label="Name" htmlFor="workspace-name">
              <Input id="workspace-name" autoFocus value={name} maxLength={60} required placeholder="Side project" onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" pending={busy} disabled={!name.trim()}>
            Create workspace
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
