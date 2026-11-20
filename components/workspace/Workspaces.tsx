"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button, Dialog, Field, Input } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import dynamic from "next/dynamic";

// The icon picker (and its emoji list) loads only when the New workspace dialog opens.
const IconPicker = dynamic(() => import("@/components/page/IconPicker").then((m) => m.IconPicker), { ssr: false });
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

const QUICK_ICONS = ["🏠", "💼", "🚀", "🎓", "🎨", "📚", "💡", "🌱", "🎵", "✈️", "🏋️", "🧪"];

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
      const { workspace, pageId } = await ws.call<{ workspace: { id: string }; pageId?: string }>("workspaces.create", { name: name.trim(), icon });
      toast.success(`Opening ${name.trim()}`, { duration: 1500 });
      // Straight into its first, empty page.
      switchWorkspace(workspace.id, pageId ? `/p/${pageId}` : "/home");
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
            side="bottom"
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
        <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Quick icons">
          {QUICK_ICONS.map((e) => (
            <button key={e} type="button" role="radio" aria-checked={icon === e} aria-label={e} onClick={() => setIcon(icon === e ? null : e)} className={`grid size-8 place-items-center rounded-lg text-[18px] hover:bg-hover ${icon === e ? "bg-hover shadow-[inset_0_0_0_1.5px_var(--fg)]" : ""}`}>
              {e}
            </button>
          ))}
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

/**
 * Arc-style workspace switching at the foot of the sidebar: one icon per workspace (the open one
 * highlighted), a + to make another, and swiping sideways over the sidebar (two fingers on a
 * trackpad, or a finger on a phone) to move to the next or previous workspace.
 */
export function WorkspaceDock({ onCreate }: { onCreate: () => void }) {
  const spaces = useWorkspaces();
  const here = spaces.list.findIndex((w) => w.id === (spaces.current?.id ?? null));
  if (spaces.list.length < 1) return null;
  return (
    <div className="workspace-dock">
      <div role="tablist" aria-label="Workspaces" className="flex items-center gap-1">
      {spaces.list.map((w, i) => (
        <button
          key={w.id ?? "main"}
          type="button"
          role="tab"
          aria-selected={i === here}
          aria-label={w.name}
          title={w.name}
          className="workspace-dock-item"
          onClick={() => i !== here && goTo(w.id, i > here ? 1 : -1)}
        >
          <WorkspaceIcon workspace={w} size={13} />
        </button>
      ))}
      </div>
      <button type="button" className="workspace-dock-item workspace-dock-add" aria-label="New workspace" title="New workspace" onClick={onCreate}>
        <span aria-hidden>+</span>
      </button>
    </div>
  );
}

/** Opens the workspace right away; the new sidebar slides in from the side you swiped toward. */
export function goTo(id: string | null, direction: 1 | -1) {
  try {
    sessionStorage.setItem("max:swipe", String(direction));
  } catch {
    // Only the slide-in direction is lost.
  }
  switchWorkspace(id);
}

/** Two-finger (trackpad) or finger (touch) swipes across the sidebar move between workspaces. */
export function useWorkspaceSwipe() {
  const spaces = useWorkspaces();
  const list = spaces.list;
  const here = list.findIndex((w) => w.id === (spaces.current?.id ?? null));
  const step = (direction: 1 | -1) => {
    const next = list[here + direction];
    if (next) goTo(next.id, direction);
  };
  const wheel = useRef({ dx: 0, locked: false, timer: 0 as number | ReturnType<typeof setTimeout> }).current;
  const touch = useRef({ x: 0, y: 0 }).current;
  return {
    onWheel(e: React.WheelEvent) {
      if (list.length < 2 || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      clearTimeout(wheel.timer);
      wheel.timer = setTimeout(() => ((wheel.dx = 0), (wheel.locked = false)), 220);
      if (wheel.locked) return;
      wheel.dx += e.deltaX;
      if (Math.abs(wheel.dx) > 140) {
        wheel.locked = true;
        step(wheel.dx > 0 ? 1 : -1);
      }
    },
    onTouchStart(e: React.TouchEvent) {
      touch.x = e.touches[0].clientX;
      touch.y = e.touches[0].clientY;
    },
    onTouchEnd(e: React.TouchEvent) {
      const t = e.changedTouches[0];
      const dx = t.clientX - touch.x;
      if (list.length > 1 && Math.abs(dx) > 80 && Math.abs(t.clientY - touch.y) < 40) step(dx < 0 ? 1 : -1);
    },
  };
}
