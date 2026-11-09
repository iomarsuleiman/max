"use client";

import { useEffect, useRef, useState } from "react";
import { ImagePlus, MessageSquare, SmilePlus } from "lucide-react";
import { requestComment } from "./CommentsPanel";
import { cn } from "@/components/ui";
import { useUploader } from "@/lib/client/upload";
import type { PageRow } from "@/lib/client/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { IconPicker } from "./IconPicker";
import { CoverPicker } from "./CoverPicker";
import { CoverView } from "./CoverView";
import { PageIcon } from "@/components/workspace/PageIcon";

export function PageHeader({ page, readOnly, onEnter, widthClass }: { page: PageRow; readOnly: boolean; onEnter: () => void; widthClass: string }) {
  const ws = useWorkspace();
  const upload = useUploader();
  const [title, setTitle] = useState(page.title);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Follow remote renames unless the title is being edited here.
  useEffect(() => {
    if (!editing.current) setTitle(page.title);
  }, [page.title]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const save = (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await ws.call("pages.update", { id: page._id, title: value });
      } catch (err) {
        notifyError(err, "Couldn't save the title.");
      }
    }, 350);
  };

  const update = (patch: Record<string, unknown>) => ws.call("pages.update", { id: page._id, ...patch }).catch((e) => notifyError(e));
  const cover = page.cover;

  return (
    <div className="group/header relative">
      {cover && (
        <div className="relative h-[30vh] max-h-[280px] min-h-[120px] w-full overflow-hidden bg-surface-2">
          <CoverView cover={cover} className="size-full" />
          {!readOnly && (
            <div className="absolute bottom-3 end-4 flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover/header:opacity-100 max-md:opacity-100">
              <CoverPicker
                trigger={<button type="button" className="h-7 rounded-md bg-overlay/90 px-2.5 text-xs font-medium text-fg shadow-pop hover:bg-overlay">Change cover</button>}
                onPick={(c) => update({ cover: c })}
                onRemove={() => update({ cover: null })}
                onUpload={async (f) => { await update({ cover: await upload(f, page._id) }); }}
              />
            </div>
          )}
        </div>
      )}
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
                onPick={(e) => update({ icon: e })}
                onRemove={() => update({ icon: null })}
              />
            )}
          </div>
        )}
        {!readOnly && (
          <div className="flex h-8 items-center gap-1 pt-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/header:opacity-100 max-md:opacity-100">
            {!page.icon && (
              <IconPicker
                trigger={
                  <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2">
                    <SmilePlus className="size-4" /> Add icon
                  </button>
                }
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
        <textarea
          ref={ref}
          value={title}
          readOnly={readOnly}
          rows={1}
          dir="auto"
          aria-label="Page title"
          placeholder={page.kind === "database" ? "Untitled database" : "Untitled"}
          onFocus={() => (editing.current = true)}
          onBlur={() => (editing.current = false)}
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
          className="mt-1 block w-full resize-none overflow-hidden bg-transparent text-[40px] font-bold leading-[1.2] tracking-[-0.01em] text-fg outline-none placeholder:text-fg-3/60 max-sm:text-[32px]"
        />
      </div>
    </div>
  );
}
