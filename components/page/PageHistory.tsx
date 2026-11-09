"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Dialog as D } from "radix-ui";
import { Bot, Clock, History, RotateCcw, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, IconButton, Skeleton, cn, confirmAction } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { dateTime, pageTitle } from "@/lib/client/format";
import { requestSaveFlush } from "@/lib/client/saveFlush";
import type { PageRef } from "@/components/editor/blocks";
import { notifyError, useWorkspace } from "@/components/workspace/context";

const MaxEditor = dynamic(() => import("@/components/editor/MaxEditor"), { ssr: false, loading: () => <PreviewSkeleton /> });

interface VersionMeta {
  _id: string;
  pageId: string;
  revision: number;
  title: string;
  wordCount: number;
  at: number;
  source: "ui" | "mcp";
  reason: "edit" | "assistant" | "before-restore" | "manual";
}
interface History {
  current: { revision: number; at: number; title: string; wordCount: number };
  versions: VersionMeta[];
}

const REASON: Record<VersionMeta["reason"], string> = {
  edit: "Your edits",
  assistant: "Before an assistant change",
  "before-restore": "Before a restore",
  manual: "Saved manually",
};

function dayLabel(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const y = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}

function PreviewSkeleton() {
  return (
    <div className="grid gap-3 p-2">
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="w-11/12" />
      <Skeleton className="w-3/4" />
    </div>
  );
}

/** Notion-style page history: preview any earlier version, restore it, or save a version now. */
export function PageHistory({ pageId, open, onOpenChange }: { pageId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const ws = useWorkspace();
  const router = useRouter();
  const history = useOp<History>("versions.list", open ? { pageId } : "skip");
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const versions = useMemo(() => history.data?.versions ?? [], [history.data]);
  const active = versions.find((v) => v._id === selected) ?? versions[0];
  const preview = useOp<{ blocks: unknown[] }>("versions.get", open && active ? { id: active._id } : "skip");

  useEffect(() => {
    if (!open) setSelected(null);
  }, [open]);

  const pages = useMemo(() => {
    const m = new Map<string, PageRef>();
    for (const p of ws.tree ?? []) m.set(p._id, { title: p.title, icon: p.icon, kind: p.kind });
    return m;
  }, [ws.tree]);

  const groups = useMemo(() => {
    const out: { label: string; items: VersionMeta[] }[] = [];
    for (const v of versions) {
      const label = dayLabel(v.at);
      const last = out.at(-1);
      if (last?.label === label) last.items.push(v);
      else out.push({ label, items: [v] });
    }
    return out;
  }, [versions]);

  const restore = async () => {
    if (!active || !history.data) return;
    const titleDiffers = active.title !== history.data.current.title;
    const ok = await confirmAction({
      title: "Restore this version?",
      body: (
        <p>
          The page goes back to how it was on <strong className="text-fg">{dateTime(active.at)}</strong>. What&apos;s there now is saved to history first, so you can switch back.
          {titleDiffers && ` The title will also change back to “${pageTitle(active.title)}”.`}
        </p>
      ),
      confirmLabel: "Restore version",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await requestSaveFlush(pageId);
      await ws.call("versions.restore", { id: active._id, restoreTitle: titleDiffers });
      toast.success("Version restored. The previous content is in page history.");
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      notifyError(err, "Couldn't restore that version.");
    } finally {
      setBusy(false);
    }
  };

  const saveNow = async () => {
    try {
      await requestSaveFlush(pageId);
      const res = await ws.call<{ saved: boolean }>("versions.create", { pageId });
      toast.success(res.saved ? "Version saved" : "This version is already in history");
    } catch (err) {
      notifyError(err, "Couldn't save a version.");
    }
  };

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-[60] bg-[var(--scrim)] [animation:max-fade_150ms_ease]" />
        <D.Content
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={(e) => {
            // Keep focus in the dialog (so Esc and Tab work) without jumping to the first button.
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          className="fixed start-1/2 top-1/2 z-[61] flex h-[min(800px,calc(100dvh-48px))] w-[min(1180px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-xl bg-overlay shadow-dialog outline-none [animation:max-in_160ms_var(--ease)] rtl:translate-x-1/2 max-md:inset-0 max-md:h-dvh max-md:w-full max-md:translate-x-0 max-md:translate-y-0 max-md:flex-col-reverse max-md:rounded-none"
        >
          <D.Title className="sr-only">Page history</D.Title>
          <section className="flex min-w-0 flex-1 flex-col bg-canvas" aria-label="Preview">
            <div className="flex items-center gap-2 border-b border-line px-5 py-2.5 text-[13px] text-fg-2">
              <History className="size-4 text-fg-3" />
              {active ? (
                <span>
                  Version from <strong className="font-medium text-fg">{dateTime(active.at)}</strong> · {active.wordCount.toLocaleString("en")} words
                </span>
              ) : (
                <span>Page history</span>
              )}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8 sm:px-14">
              {!history.data ? (
                <PreviewSkeleton />
              ) : !active ? (
                <EmptyState
                  icon={<Clock className="size-5" />}
                  title="No earlier versions yet"
                  body="As you edit, Max keeps a version at most every 10 minutes, before every change an assistant makes, and whenever you save one yourself."
                  className="mt-10"
                >
                  <Button icon={<Save className="size-3.5" />} onClick={saveNow}>
                    Save version now
                  </Button>
                </EmptyState>
              ) : (
                <div className="mx-auto max-w-[720px]">
                  <h1 className="mb-4 text-[32px] font-bold leading-tight tracking-tight">{pageTitle(active.title)}</h1>
                  {!preview.data ? (
                    <PreviewSkeleton />
                  ) : (
                    <MaxEditor
                      key={active._id}
                      initialContent={preview.data.blocks}
                      editable={false}
                      onChange={() => {}}
                      uploadFile={async () => ""}
                      resolveFileUrl={async (u) => u}
                      onNotice={() => {}}
                      onEditImage={() => {}}
                      createSubpage={async () => null}
                      pages={pages}
                      navigate={() => {}}
                      font={ws.settings?.font}
                      dir={ws.settings?.textDirection}
                    />
                  )}
                </div>
              )}
            </div>
          </section>
          <aside className="flex w-80 shrink-0 flex-col border-s border-line bg-surface max-md:h-[40dvh] max-md:w-full max-md:border-s-0 max-md:border-b" aria-label="Versions">
            <div className="flex items-center justify-between px-4 pb-2 pt-3">
              <h2 className="text-[14px] font-semibold">Page history</h2>
              <D.Close asChild>
                <IconButton label="Close page history" size="md">
                  <X className="size-4" />
                </IconButton>
              </D.Close>
            </div>
            {history.data && (
              <div className="mx-3 mb-2 rounded-md bg-overlay px-3 py-2 text-[12.5px] shadow-[0_0_0_1px_var(--line)]">
                <p className="font-medium text-fg">Current version</p>
                <p className="text-fg-3">Edited {dateTime(history.data.current.at)}</p>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {history.error && <p className="p-3 text-[13px] text-danger">{history.error.message}</p>}
              {groups.map((g) => (
                <div key={g.label} className="mb-2">
                  <p className="px-2 pb-1 pt-2 text-[11.5px] font-medium text-fg-3">{g.label}</p>
                  <ul className="grid gap-0.5">
                    {g.items.map((v) => (
                      <li key={v._id}>
                        <button
                          type="button"
                          aria-current={active?._id === v._id}
                          onClick={() => setSelected(v._id)}
                          className={cn("flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-start hover:bg-hover", active?._id === v._id && "bg-hover")}
                        >
                          {v.reason === "assistant" ? <Bot className="mt-0.5 size-3.5 shrink-0 text-fg-3" /> : <Clock className="mt-0.5 size-3.5 shrink-0 text-fg-3" />}
                          <span className="min-w-0">
                            <span className="block text-[13px] text-fg">{new Date(v.at).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}</span>
                            <span className="block truncate text-[11.5px] text-fg-3">
                              {REASON[v.reason]} · {v.wordCount.toLocaleString("en")} words
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="grid gap-2 border-t border-line p-3">
              <Button variant="primary" icon={<RotateCcw className="size-3.5" />} disabled={!active} pending={busy} onClick={restore}>
                Restore this version
              </Button>
              <Button variant="ghost" size="sm" icon={<Save className="size-3.5" />} onClick={saveNow}>
                Save current version now
              </Button>
              <p className="text-[11.5px] leading-snug text-fg-3">Up to 100 versions are kept per page. Deleting a page permanently also deletes its history.</p>
            </div>
          </aside>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
