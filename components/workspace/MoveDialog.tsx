"use client";

import { useMemo, useState } from "react";
import { CornerDownRight, Home, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, cn } from "@/components/ui";
import { isDescendant } from "@/lib/client/tree";
import { pageTitle } from "@/lib/client/format";
import { notifyError, useWorkspace } from "./context";
import { PageIcon } from "./PageIcon";

/** Keyboard- and touch-friendly alternative to dragging: choose a new parent from a searchable list. */
export function MoveDialog() {
  const ws = useWorkspace();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const id = ws.moveTarget;
  const page = id ? ws.byId.get(id) : undefined;
  const options = useMemo(() => {
    if (!id) return [];
    const q = query.trim().toLowerCase();
    return (ws.tree ?? [])
      .filter((p) => p.kind === "page" && p._id !== id && !isDescendant(ws.tree ?? [], id, p._id))
      .filter((p) => !q || pageTitle(p.title).toLowerCase().includes(q))
      .slice(0, 60);
  }, [id, query, ws.tree]);

  const move = async (parentId: string | null) => {
    if (!id) return;
    setBusy(true);
    try {
      await ws.call("pages.move", { id, parentId });
      if (parentId) ws.setExpanded(parentId, true);
      toast.success(parentId ? `Moved into “${pageTitle(ws.byId.get(parentId)?.title)}”` : "Moved to the top level");
      ws.setMoveTarget(null);
      setQuery("");
    } catch (err) {
      notifyError(err, "Couldn't move the page.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && ws.setMoveTarget(null)} title={`Move “${pageTitle(page?.title)}” to…`} description="Its subpages move with it." size="sm">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search for a page" aria-label="Search for a page" className="h-8 w-full rounded-md bg-surface-2 ps-8 pe-2 text-[13.5px] outline-none focus:shadow-[0_0_0_1px_var(--accent)]" />
      </div>
      <ul className="grid max-h-[50dvh] overflow-y-auto" aria-busy={busy}>
        {!query && page?.parentId && (
          <li>
            <button type="button" disabled={busy} onClick={() => move(null)} className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-[13.5px] hover:bg-hover">
              <Home className="size-4 text-fg-3" /> Top level
            </button>
          </li>
        )}
        {options.map((p) => (
          <li key={p._id}>
            <button
              type="button"
              disabled={busy || p._id === page?.parentId}
              onClick={() => move(p._id)}
              className={cn("flex h-8 w-full items-center gap-2 rounded-md px-2 text-start text-[13.5px] hover:bg-hover disabled:opacity-50")}
            >
              <PageIcon icon={p.icon} kind={p.kind} />
              <span className="min-w-0 flex-1 truncate">{pageTitle(p.title)}</span>
              {p._id === page?.parentId ? <span className="text-xs text-fg-3">Current</span> : <CornerDownRight className="size-3.5 text-fg-3 flip-rtl" />}
            </button>
          </li>
        ))}
        {!options.length && <li className="px-2 py-6 text-center text-[13px] text-fg-3">No pages match “{query}”.</li>}
      </ul>
    </Dialog>
  );
}
