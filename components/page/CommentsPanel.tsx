"use client";

import { useEffect, useRef, useState } from "react";
import { Check, MessageSquare, MoreHorizontal, Pencil, RotateCcw, SmilePlus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, IconButton, Menu, MenuContent, MenuItem, MenuTrigger, Skeleton, Textarea, cn, confirmAction } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { dateTime, timeAgo } from "@/lib/client/format";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { Avatar } from "@/components/workspace/Sidebar";
import { can, usePageAccess } from "@/components/share/access";

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
  authorId?: string | null;
  authorName?: string | null;
  authorImage?: string | null;
  parentId?: string | null;
  reactions?: Record<string, string[]>;
  mentions?: string[];
}

const QUICK_REACTIONS = ["👍", "❤️", "🎉", "👀", "✅", "😄"];
type Person = { id: string; name: string; image: string | null };

export interface CommentsData {
  comments: CommentView[];
  openCount: number;
  resolvedCount: number;
}

/** Ask the open page to show comments, optionally starting a comment on a block. */
export function requestComment(pageId: string, blockId: string | null = null) {
  document.dispatchEvent(new CustomEvent("max:comment", { detail: { pageId, blockId } }));
}

export function useCommentCount(pageId: string, skip = false) {
  const q = useOp<{ openCount: number }>("comments.list", skip ? "skip" : { pageId });
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

export function CommentsPanel({ pageId, open, onClose, focusBlock, prefetched }: { pageId: string; open: boolean; onClose: () => void; focusBlock: { blockId: string | null; nonce: number } | null; prefetched?: CommentsData }) {
  const ws = useWorkspace();
  const access = usePageAccess();
  const canComment = can(access, "comment");
  // Owner comments carry no author; on someone else's page they belong to the owner.
  const isMine = (c: CommentView) => (c.authorId ? c.authorId === access.you : !access.shared);
  const authorOf = (c: CommentView) =>
    isMine(c) ? (ws.settings?.displayName || ws.identity.name || "You") : c.authorName || (c.authorId ? "Someone" : access.ownerName || "Page owner");
  const [showResolved, setShowResolved] = useState(false);
  const q = useOp<CommentsData>("comments.list", prefetched !== undefined ? "skip" : { pageId, includeResolved: true });
  const data = prefetched ?? q.data;
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<CommentView | null>(null);
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const composer = useRef<HTMLTextAreaElement>(null);
  // People you can @mention: an organization's members, or (in your own workspace) you.
  const people = useOp<{ people: Person[] }>("people.list", access.shared || !open ? "skip" : {}).data?.people ?? [];
  const mentionQuery = /(?:^|\s)@([\p{L}\p{N}._-]{0,24})$/u.exec(draft)?.[1];
  const suggestions = mentionQuery === undefined ? [] : people.filter((p) => p.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6);
  const pickMention = (p: Person) => {
    setDraft((d) => d.replace(/@([\p{L}\p{N}._-]{0,24})$/u, `@${p.name} `));
    setMentionIds((ids) => [...new Set([...ids, p.id])]);
    composer.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!focusBlock) return;
    setTarget(focusBlock.blockId);
    requestAnimationFrame(() => composer.current?.focus());
  }, [focusBlock]);

  const all = data?.comments ?? [];
  const shown = all.filter((c) => !c.parentId && (showResolved || !c.resolvedAt));
  const repliesTo = (id: string) => all.filter((c) => c.parentId === id);
  const react = (c: CommentView, emoji: string) => ws.call("comments.react", { id: c._id, emoji }).catch((e) => notifyError(e));
  const me = access.you;
  const Reactions = ({ c }: { c: CommentView }) => (
    <div className="mt-1.5 flex flex-wrap items-center gap-1">
      {Object.entries(c.reactions ?? {}).map(([emoji, who]) => (
        <button key={emoji} type="button" disabled={!canComment} aria-pressed={!!me && who.includes(me)} onClick={() => react(c, emoji)} className={cn("inline-flex h-6 items-center gap-1 rounded-full px-1.5 text-[12px] shadow-[inset_0_0_0_1px_var(--line)] hover:bg-hover", me && who.includes(me) && "bg-accent-soft shadow-[inset_0_0_0_1px_var(--accent)]")}>
          <span aria-hidden>{emoji}</span>
          <span className="tabular-nums">{who.length}</span>
          <span className="sr-only">reacted with {emoji}</span>
        </button>
      ))}
      {canComment && (
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Add reaction" size="xs">
              <SmilePlus className="size-3.5" />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="start">
            <div className="flex gap-0.5 p-1">
              {QUICK_REACTIONS.map((e) => (
                <button key={e} type="button" aria-label={`React with ${e}`} onClick={() => react(c, e)} className="grid size-8 place-items-center rounded-md text-[16px] hover:bg-hover">
                  {e}
                </button>
              ))}
            </div>
          </MenuContent>
        </Menu>
      )}
    </div>
  );
  const targetExcerpt = target ? (all.find((c) => c.blockId === target)?.blockExcerpt ?? blockText(target)) : null;

  const send = async () => {
    if (!draft.trim()) return;
    setBusy(true);
    try {
      const mentions = mentionIds.filter((id) => draft.includes(`@${people.find((p) => p.id === id)?.name ?? "\u0000"}`));
      await ws.call("comments.add", { pageId, blockId: replyTo ? null : target, body: draft, ...(replyTo ? { parentId: replyTo._id } : {}), ...(mentions.length ? { mentions } : {}) });
      setDraft("");
      setTarget(null);
      setReplyTo(null);
      setMentionIds([]);
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
        <>
        <button type="button" aria-label="Close comments" onClick={onClose} className="fixed inset-0 z-30 bg-[var(--scrim)] lg:hidden" />
        <aside aria-label="Comments" className="flex w-80 shrink-0 flex-col border-s border-line bg-surface max-lg:fixed max-lg:inset-y-0 max-lg:end-0 max-lg:z-40 max-lg:w-[min(360px,100vw)] max-lg:shadow-dialog">
          <div className="flex items-center gap-2 px-3 pb-2 pt-3">
            <MessageSquare className="size-4 text-fg-3" />
            <h2 className="text-[14px] font-semibold">Comments</h2>
            {(data?.resolvedCount ?? 0) > 0 && (
              <button type="button" aria-pressed={showResolved} onClick={() => setShowResolved(!showResolved)} className="ms-auto rounded px-1.5 py-0.5 text-[12px] text-fg-3 hover:bg-hover hover:text-fg-2">
                {showResolved ? "Hide resolved" : `Show resolved (${data!.resolvedCount})`}
              </button>
            )}
            <IconButton label="Close comments" shortcut="⌘⇧M" className={cn(!(data?.resolvedCount ?? 0) && "ms-auto")} onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3">
            {!data ? (
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
                    <div className="mb-1 flex items-center gap-1.5">
                      <Avatar name={authorOf(c)} url={isMine(c) ? (ws.identity.imageUrl ?? null) : (c.authorImage ?? null)} size={20} />
                      <span className="truncate text-[12.5px] font-medium text-fg">{authorOf(c)}</span>
                    </div>
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
                      {canComment && (
                        <IconButton
                          label={c.resolvedAt ? "Reopen" : "Resolve"}
                          size="xs"
                          className="ms-auto"
                          onClick={() => ws.call("comments.resolve", { id: c._id, resolved: !c.resolvedAt }).catch((e) => notifyError(e))}
                        >
                          {c.resolvedAt ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
                        </IconButton>
                      )}
                      {(isMine(c) || can(access, "full_access")) && (
                      <Menu>
                        <MenuTrigger asChild>
                          <IconButton label="Comment actions" size="xs">
                            <MoreHorizontal className="size-3.5" />
                          </IconButton>
                        </MenuTrigger>
                        <MenuContent align="end">
                          {isMine(c) && <MenuItem icon={<Pencil />} onSelect={() => (setEditing(c._id), setEditText(c.body))}>Edit</MenuItem>}
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
                      )}
                    </div>
                    <Reactions c={c} />
                    {repliesTo(c._id).map((r) => (
                      <div key={r._id} className="mt-2 border-s-2 border-line ps-2.5">
                        <div className="mb-0.5 flex items-center gap-1.5">
                          <Avatar name={authorOf(r)} url={isMine(r) ? (ws.identity.imageUrl ?? null) : (r.authorImage ?? null)} size={18} />
                          <span className="truncate text-[12.5px] font-medium text-fg">{authorOf(r)}</span>
                          <span className="text-[11.5px] text-fg-3" title={dateTime(r.createdAt)}>· {timeAgo(r.createdAt)}</span>
                          {(isMine(r) || can(access, "full_access")) && (
                            <IconButton label="Delete reply" size="xs" className="ms-auto" onClick={() => ws.call("comments.delete", { id: r._id, confirm: true }).catch((e) => notifyError(e))}>
                              <Trash2 className="size-3" />
                            </IconButton>
                          )}
                        </div>
                        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-fg">{r.body}</p>
                        <Reactions c={r} />
                      </div>
                    ))}
                    {canComment && !c.resolvedAt && (
                      <button type="button" className="mt-1.5 text-[12px] text-fg-3 hover:text-fg-2 hover:underline" onClick={() => (setReplyTo(c), composer.current?.focus())}>
                        Reply{repliesTo(c._id).length ? ` · ${repliesTo(c._id).length}` : ""}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!canComment ? (
            <p className="border-t border-line p-3 text-[12.5px] text-fg-3">You can read comments here. Ask for “Can comment” access to add your own.</p>
          ) : (
          <form className="grid gap-1.5 border-t border-line p-3" onSubmit={(e) => (e.preventDefault(), void send())}>
            {replyTo && (
              <div className="flex items-center gap-1 text-[12px] text-fg-3">
                <span className="min-w-0 flex-1 truncate border-s-2 border-accent ps-2">Replying to {authorOf(replyTo)}: {replyTo.body}</span>
                <IconButton label="Cancel reply" size="xs" onClick={() => setReplyTo(null)}>
                  <X className="size-3" />
                </IconButton>
              </div>
            )}
            {suggestions.length > 0 && (
              <ul role="listbox" aria-label="Mention someone" className="rounded-md bg-overlay p-1 shadow-[0_0_0_1px_var(--line)]">
                {suggestions.map((p) => (
                  <li key={p.id}>
                    <button type="button" role="option" aria-selected={false} onMouseDown={(e) => (e.preventDefault(), pickMention(p))} className="flex w-full items-center gap-2 rounded px-2 py-1 text-start text-[13px] hover:bg-hover">
                      <Avatar name={p.name} url={p.image} size={18} />
                      {p.name}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {target && !replyTo && (
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
              placeholder={replyTo ? "Reply…" : target ? "Comment on this block… (@ to mention)" : "Add a comment… (@ to mention someone)"}
              aria-label="New comment"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (suggestions.length) pickMention(suggestions[0]);
                  else void send();
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
          )}
        </aside>
        </>
      )}
    </>
  );
}

function blockText(blockId: string): string {
  return document.querySelector(`.lx-editor [data-id="${CSS.escape(blockId)}"] .bn-inline-content`)?.textContent?.slice(0, 120) ?? "";
}
