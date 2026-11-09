"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MessageSquare, MoreHorizontal, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Textarea, cn, confirmAction } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { dateTime, timeAgo } from "@/lib/client/format";
import { notifyError, useWorkspace } from "@/components/workspace/context";

export interface CommentView {
  _id: string;
  pageId: string;
  blockId: string | null;
  body: string;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
  source: "ui" | "mcp";
  blockExcerpt: string | null;
  blockMissing: boolean;
}

/** Ask the open page to show comments, optionally starting a comment on a block. */
export function requestComment(pageId: string, blockId: string | null = null) {
  document.dispatchEvent(new CustomEvent("max:comment", { detail: { pageId, blockId } }));
}

export function useCommentCount(pageId: string) {
  const q = useOp<{ openCount: number }>("comments.list", { pageId });
  return q.data?.openCount ?? 0;
}

/** Highlights blocks that have open comments, and lets a click on the marker open them. */
function BlockMarkers({ comments, onOpen }: { comments: CommentView[]; onOpen: (blockId: string) => void }) {
  const ids = [...new Set(comments.filter((c) => c.blockId && !c.resolvedAt).map((c) => c.blockId!))];
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.maxComments = "";
    style.textContent = ids
      .map((id) => `.lx-editor .bn-block-outer[data-id="${CSS.escape(id)}"] > .bn-block > .bn-block-content { background: color-mix(in oklch, var(--warning) 10%, transparent); box-shadow: inset 2px 0 0 color-mix(in oklch, var(--warning) 70%, transparent); border-radius: 3px; cursor: text; }`)
      .join("\n");
    document.head.appendChild(style);
    const onClick = (e: MouseEvent) => {
      const outer = (e.target as HTMLElement).closest?.(".bn-block-outer") as HTMLElement | null;
      const id = outer?.dataset.id;
      if (id && ids.includes(id) && e.altKey) onOpen(id);
    };
    document.addEventListener("click", onClick);
    return () => {
      style.remove();
      document.removeEventListener("click", onClick);
    };
  }, [ids.join(","), onOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function CommentsPanel({ pageId, open, onClose, focusBlock }: { pageId: string; open: boolean; onClose: () => void; focusBlock: { blockId: string | null; nonce: number } | null }) {
  const ws = useWorkspace();
  const [showResolved, setShowResolved] = useState(false);
  const q = useOp<{ comments: CommentView[]; openCount: number; resolvedCount: number }>("comments.list", { pageId, includeResolved: true });
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focusBlock) return;
    setTarget(focusBlock.blockId);
    requestAnimationFrame(() => composer.current?.focus());
  }, [focusBlock]);

  const all = q.data?.comments ?? [];
  const shown = all.filter((c) => showResolved || !c.resolvedAt);
  const targetExcerpt = target ? (all.find((c) => c.blockId === target)?.blockExcerpt ?? blockText(target)) : null;

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      await ws.call("comments.add", { pageId, blockId: target, body: draft });
      setDraft("");
      setTarget(null);
    } catch (err) {
      notifyError(err, "Couldn't add the comment. Your text is still here.");
    } finally {
      setBusy(false);
    }
  };
  const scrollToBlock = (blockId: string) => document.querySelector(`.lx-editor [data-id="${CSS.escape(blockId)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });

  return (
    <>
      <BlockMarkers comments={all} onOpen={(id) => (setTarget(id), composer.current?.focus())} />
      {open && (
        <aside aria-label="Comments" className="flex w-80 shrink-0 flex-col border-s border-line bg-surface max-lg:fixed max-lg:inset-y-0 max-lg:end-0 max-lg:z-40 max-lg:w-[min(360px,100vw)] max-lg:shadow-dialog">
          <div className="flex items-center gap-2 px-3 pb-2 pt-3">
            <MessageSquare className="size-4 text-fg-3" />
            <h2 className="text-[14px] font-semibold">Comments</h2>
            {(q.data?.resolvedCount ?? 0) > 0 && (
              <button type="button" aria-pressed={showResolved} onClick={() => setShowResolved(!showResolved)} className="ms-auto rounded px-1.5 py-0.5 text-[12px] text-fg-3 hover:bg-hover hover:text-fg-2">
                {showResolved ? "Hide resolved" : `Show resolved (${q.data!.resolvedCount})`}
              </button>
            )}
            <IconButton label="Close comments" shortcut="⌘⇧M" className={cn(!(q.data?.resolvedCount ?? 0) && "ms-auto")} onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3">
            {!q.data ? (
              <Skeleton className="h-16" />
            ) : !shown.length ? (
              <p className="px-1 py-6 text-center text-[13px] leading-relaxed text-fg-3">
                No {showResolved ? "" : "open "}comments. Add a note to the page below, or use a block&apos;s ⋮⋮ menu → Comment.
              </p>
            ) : (
              <ul className="grid gap-2 pb-3">
                {shown.map((c) => (
                  <li key={c._id} className={cn("rounded-lg bg-overlay p-2.5 shadow-[0_0_0_1px_var(--line)]", c.resolvedAt && "opacity-70")}>
                    {c.blockId && (
                      <button type="button" onClick={() => scrollToBlock(c.blockId!)} disabled={c.blockMissing} className="mb-1.5 block w-full truncate border-s-2 border-warning ps-2 text-start text-[12px] text-fg-3 hover:text-fg-2 disabled:line-through">
                        {c.blockMissing ? "Block was deleted" : c.blockExcerpt || "Block"}
                      </button>
                    )}
                    {editing === c._id ? (
                      <form
                        className="grid gap-1.5"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          try {
                            await ws.call("comments.update", { id: c._id, body: editText });
                            setEditing(null);
                          } catch (err) {
                            notifyError(err);
                          }
                        }}
                      >
                        <Textarea autoFocus rows={3} value={editText} onChange={(e) => setEditText(e.target.value)} aria-label="Edit comment" onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                        <div className="flex justify-end gap-1.5">
                          <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                          <Button size="xs" variant="primary" type="submit">Save</Button>
                        </div>
                      </form>
                    ) : (
                      <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-fg">{c.body}</p>
                    )}
                    <div className="mt-1.5 flex items-center gap-1 text-[11.5px] text-fg-3">
                      <span title={dateTime(c.createdAt)}>
                        {c.source === "mcp" ? "From an assistant · " : ""}
                        {timeAgo(c.createdAt)}
                        {c.updatedAt > c.createdAt + 1000 && !c.resolvedAt ? " · edited" : ""}
                        {c.resolvedAt ? " · resolved" : ""}
                      </span>
                      <IconButton
                        label={c.resolvedAt ? "Reopen" : "Resolve"}
                        size="xs"
                        className="ms-auto"
                        onClick={() => ws.call("comments.resolve", { id: c._id, resolved: !c.resolvedAt }).catch((e) => notifyError(e))}
                      >
                        {c.resolvedAt ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
                      </IconButton>
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton label="Comment actions" size="xs">
                            <MoreHorizontal className="size-3.5" />
                          </IconButton>
                        </MenuTrigger>
                        <MenuContent align="end">
                          <MenuItem icon={<Pencil />} onSelect={() => (setEditing(c._id), setEditText(c.body))}>Edit</MenuItem>
                          <MenuItem
                            icon={<Trash2 />}
                            danger
                            onSelect={async () => {
                              if (!(await confirmAction({ title: "Delete this comment?", body: <p>It&apos;s removed for good. Resolve it instead to keep it out of the way.</p>, confirmLabel: "Delete comment", tone: "danger" }))) return;
                              ws.call("comments.delete", { id: c._id, confirm: true }).then(() => toast.success("Comment deleted")).catch((e) => notifyError(e));
                            }}
                          >
                            Delete
                          </MenuItem>
                        </MenuContent>
                      </Menu>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <form className="grid gap-1.5 border-t border-line p-3" onSubmit={(e) => (e.preventDefault(), void send())}>
            {target && (
              <div className="flex items-center gap-1 text-[12px] text-fg-3">
                <span className="min-w-0 flex-1 truncate border-s-2 border-warning ps-2">On: {targetExcerpt || "this block"}</span>
                <IconButton label="Comment on the page instead" size="xs" onClick={() => setTarget(null)}>
                  <X className="size-3" />
                </IconButton>
              </div>
            )}
            <Textarea
              ref={composer}
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={target ? "Comment on this block…" : "Add a comment to this page…"}
              aria-label="New comment"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="flex items-center justify-between text-[11.5px] text-fg-3">
              <span>Enter to add · Shift+Enter for a new line</span>
              <Button size="xs" variant="primary" type="submit" pending={busy} disabled={!draft.trim()}>
                Comment
              </Button>
            </div>
          </form>
        </aside>
      )}
    </>
  );
}

function blockText(blockId: string): string {
  return document.querySelector(`.lx-editor [data-id="${CSS.escape(blockId)}"] .bn-inline-content`)?.textContent?.slice(0, 120) ?? "";
}
