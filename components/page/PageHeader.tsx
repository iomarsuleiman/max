"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ImagePlus, MessageSquare, SmilePlus } from "@/components/icons";
import { BadgeCheck } from "@/components/icons";
import { requestComment } from "./CommentsPanel";
import { cn } from "@/components/ui";
import { useUploader } from "@/lib/client/upload";
import type { PageRow } from "@/lib/client/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { PageCover } from "./PageCover";
import { PageIcon } from "@/components/workspace/PageIcon";

// Lazy-load heavy pickers (IconPicker pulls lucide-react/dynamic; CoverPicker pulls 140+ cover thumbnails).
const IconPicker = dynamic(() => import("./IconPicker").then((m) => m.IconPicker), { ssr: false });
const CoverPicker = dynamic(() => import("./CoverPicker").then((m) => m.CoverPicker), { ssr: false });

export function PageHeader({ page, readOnly, onEnter, widthClass }: { page: PageRow; readOnly: boolean; onEnter: () => void; widthClass: string }) {
  const { call } = useWorkspace();
  const upload = useUploader();
  const [title, setTitle] = useState(page.title);
  const editing = useRef(false);
  const pendingTitle = useRef<string | null>(null);
  const savingTitle = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Follow remote renames unless the title is being edited or a local rename is still saving.
  useEffect(() => {
    if (!editing.current && pendingTitle.current === null) setTitle(page.title);
  }, [page.title]);

  const flushTitle = useCallback(
    async (value?: string) => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      const next = value ?? pendingTitle.current;
      if (next === null || savingTitle.current !== null) return;
      savingTitle.current = next;
      try {
        await call("pages.update", { id: page._id, title: next });
      } catch (err) {
        notifyError(err, "Couldn't save the title.");
      } finally {
        savingTitle.current = null;
        if (pendingTitle.current === next) pendingTitle.current = null;
        else if (pendingTitle.current !== null && !timer.current) void flushTitle();
      }
    },
    [page._id, call],
  );

  const save = (value: string) => {
    pendingTitle.current = value;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flushTitle(value), 350);
  };

  useEffect(
    () => () => {
      if (pendingTitle.current !== null) void flushTitle();
    },
    [flushTitle],
  );

  const update = (patch: Record<string, unknown>) => call("pages.update", { id: page._id, ...patch }).catch((e) => notifyError(e));
  const cover = page.cover;

  return (
    <div className="max-page-header group/header relative">
      {cover && <PageCover key={cover} page={page} readOnly={readOnly} />}
      <div className={cn("mx-auto px-4 sm:px-12", widthClass, cover ? "pt-0" : "pt-14 max-sm:pt-8")}>
        {page.icon && (
          <div className={cn("relative z-[1]", cover ? "-mt-10" : "")}>
            {readOnly ? (
              <PageIcon icon={page.icon} size={72} />
            ) : (
              <IconPicker
                trigger={
                  <button type="button" aria-label="Change icon" className="rounded-lg p-1 hover:bg-hover">
                    <PageIcon icon={page.icon} size={72} />
                  </button>
                }
                pageId={page._id}
                onPick={(e) => update({ icon: e })}
                onRemove={() => update({ icon: null })}
              />
            )}
          </div>
        )}
        {!readOnly && (
          <div className="flex h-8 max-md:h-auto max-md:flex-wrap items-center gap-1 pt-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/header:opacity-100 max-md:opacity-100">
            {!page.icon && (
              <IconPicker
                trigger={
                  <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2">
                    <SmilePlus className="size-4" /> Add icon
                  </button>
                }
                pageId={page._id}
                onPick={(e) => update({ icon: e })}
              />
            )}
            {page.kind === "page" && !page.isTemplate && (
              <button type="button" onClick={() => requestComment(page._id)} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2">
                <MessageSquare className="size-4" /> Add comment
              </button>
            )}
            {!cover && (
              <CoverPicker
                trigger={
                  <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2">
                    <ImagePlus className="size-4" /> Add cover
                  </button>
                }
                onPick={(c) => update({ cover: c })}
                onUpload={async (f) => { await update({ cover: await upload(f, page._id) }); }}
              />
            )}
          </div>
        )}
        {/* The box grows with the title through CSS (a hidden copy of the text sizes it), never by
            collapsing and re-measuring, which made iOS jump the page and fight text selection. */}
        <div className="page-title-grow" data-value={`${title || (page.kind === "database" ? "Untitled database" : "Untitled")} `}>
        <textarea
          ref={ref}
          value={title}
          readOnly={readOnly}
          rows={1}
          dir="auto"
          aria-label="Page title"
          placeholder={page.kind === "database" ? "Untitled database" : "Untitled"}
          onFocus={() => (editing.current = true)}
          onBlur={() => {
            editing.current = false;
            if (pendingTitle.current !== null) void flushTitle();
          }}
          onChange={(e) => {
            const v = e.target.value.replace(/\n/g, "");
            setTitle(v);
            save(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.blur();
              onEnter();
            }
          }}
          className="block w-full resize-none overflow-hidden bg-transparent text-fg outline-none placeholder:text-fg-3/60"
        />
        </div>
        {page.verification && <VerifiedBadge v={page.verification} />}
      </div>
    </div>
  );
}

/** Wiki verification: who vouches for this page and until when; a warning once it lapses. */
function VerifiedBadge({ v }: { v: { byName: string | null; until: number } }) {
  const [openedAt] = useState(() => Date.now());
  const expired = v.until < openedAt;
  return (
    <p className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[12.5px] ${expired ? "bg-warning-soft text-fg" : "bg-success-soft text-fg"}`}>
      <BadgeCheck className="size-3.5" aria-hidden />
      {expired ? `Verification expired ${new Date(v.until).toLocaleDateString()}: review this page` : `Verified by ${v.byName ?? "a teammate"} until ${new Date(v.until).toLocaleDateString()}`}
    </p>
  );
}
