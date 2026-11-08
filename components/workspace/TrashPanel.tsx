"use client";

import { useState } from "react";
import Link from "next/link";
import { RotateCcw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, IconButton, Skeleton, Tooltip, cn, confirmAction } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageTitle, timeAgo } from "@/lib/client/format";
import { confirmPermanentDelete, notifyError, useWorkspace } from "./context";
import { PageIcon } from "./PageIcon";

interface TrashItem {
  _id: string;
  title: string;
  icon: string | null;
  kind: string;
  archivedAt: number;
  contains: number;
  parentTitle: string | null;
}

export function TrashPanel({ compact }: { compact?: boolean }) {
  const ws = useWorkspace();
  const [query, setQuery] = useState("");
  const q = useOp<{ pages: TrashItem[] }>("trash.list", { query });
  const all = useOp<{ pages: TrashItem[] }>("trash.list", {});
  const total = all.data?.pages.length ?? 0;

  const restore = async (item: TrashItem) => {
    try {
      const res = await ws.call<{ parentId: string | null }>("pages.restore", { id: item._id });
      toast.success(res.parentId ? `Restored “${pageTitle(item.title)}”` : `Restored “${pageTitle(item.title)}” to the top level`, {
        action: { label: "Open", onClick: () => (window.location.href = `/p/${item._id}`) },
      });
    } catch (err) {
      notifyError(err, "Couldn't restore the page.");
    }
  };
  const destroy = async (item: TrashItem) => {
    if (!(await confirmPermanentDelete(pageTitle(item.title), item.contains ? `and ${item.contains} page${item.contains > 1 ? "s" : ""} inside it` : undefined))) return;
    try {
      await ws.call("pages.deletePermanently", { id: item._id, confirm: true });
      toast.success("Deleted permanently");
    } catch (err) {
      notifyError(err, "Couldn't delete the page.");
    }
  };
  const empty = async () => {
    const ok = await confirmAction({
      title: "Empty trash?",
      body: <p>All {total} page{total === 1 ? "" : "s"} in the trash, their subpages and uploaded images will be deleted for good. This can't be undone.</p>,
      confirmLabel: "Empty trash",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const res = await ws.call<{ deleted: number }>("trash.empty", { confirm: true });
      toast.success(`Deleted ${res.deleted} page${res.deleted === 1 ? "" : "s"} permanently`);
    } catch (err) {
      notifyError(err, "Couldn't empty the trash.");
    }
  };

  return (
    <div className={cn("flex flex-col", compact ? "max-h-[min(520px,70dvh)] w-[min(420px,calc(100vw-24px))]" : "")}>
      <div className="flex items-center gap-2 p-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages in trash"
            aria-label="Search pages in trash"
            className="h-7 w-full rounded-md bg-surface-2 ps-7 pe-2 text-[13px] outline-none placeholder:text-fg-3 focus:shadow-[0_0_0_1px_var(--accent)]"
          />
        </div>
        {query && (
          <Button size="xs" variant="ghost" onClick={() => setQuery("")}>
            Clear
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {q.isLoading ? (
          <div className="grid gap-2 p-2">
            <Skeleton className="w-3/4" />
            <Skeleton className="w-1/2" />
          </div>
        ) : q.error ? (
          <p className="p-3 text-[13px] text-danger">{q.error.message}</p>
        ) : !q.data?.pages.length ? (
          query ? (
            <EmptyState title="No matching pages" body={`Nothing in the trash matches “${query}”.`} className="py-6">
              <Button size="sm" onClick={() => setQuery("")}>
                Clear search
              </Button>
            </EmptyState>
          ) : (
            <EmptyState icon={<Trash2 className="size-5" />} title="Trash is empty" body="Pages you delete stay here until you empty the trash, so you can restore them." className="py-6" />
          )
        ) : (
          <ul className="grid">
            {q.data.pages.map((item) => (
              <li key={item._id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                <PageIcon icon={item.icon} kind={item.kind} />
                <Link href={`/p/${item._id}`} className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-fg">{pageTitle(item.title)}</span>
                  <span className="block truncate text-[11.5px] text-fg-3">
                    Deleted {timeAgo(item.archivedAt)}
                    {item.parentTitle ? ` · from ${pageTitle(item.parentTitle)}` : ""}
                    {item.contains ? ` · ${item.contains} inside` : ""}
                  </span>
                </Link>
                <Tooltip label="Restore">
                  <IconButton label={`Restore ${pageTitle(item.title)}`} tooltip={false} onClick={() => restore(item)}>
                    <RotateCcw className="size-3.5" />
                  </IconButton>
                </Tooltip>
                <Tooltip label="Delete permanently">
                  <IconButton label={`Delete ${pageTitle(item.title)} permanently`} tooltip={false} onClick={() => destroy(item)} className="hover:text-danger">
                    <Trash2 className="size-3.5" />
                  </IconButton>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </div>
      {total > 0 && (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-fg-3">
          <span>
            {total} page{total === 1 ? "" : "s"} in trash
          </span>
          <Button size="xs" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={empty}>
            Empty trash
          </Button>
        </div>
      )}
    </div>
  );
}
