"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { coverImageUrl } from "@/lib/client/covers";
import { useAssetResolver, useUploader } from "@/lib/client/upload";
import type { PageRow } from "@/lib/client/types";
import { cn } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { CoverPicker } from "./CoverPicker";
import { CoverView } from "./CoverView";

export function PageCover({ page, readOnly }: { page: PageRow; readOnly: boolean }) {
  const ws = useWorkspace();
  const upload = useUploader();
  const resolve = useAssetResolver();
  const [repositioning, setRepositioning] = useState(false);
  const [position, setPosition] = useState(page.coverPosition ?? 50);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const drag = useRef<{ y: number; position: number; overflow: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const image = !!page.cover && !/^(color:|gradient:)/.test(page.cover);
  const change = async (cover: string | null) => {
    try {
      await ws.call("pages.update", { id: page._id, cover, coverPosition: 50 });
    } catch (error) {
      notifyError(error);
    }
  };
  const download = async () => {
    if (!page.cover) return;
    setDownloading(true);
    try {
      const src = coverImageUrl(page.cover) ?? (await resolve(page.cover));
      if (!src) throw new Error("This cover could not be loaded.");
      let response: Response;
      try {
        response = await fetch(src);
      } catch {
        window.open(src, "_blank", "noopener,noreferrer");
        toast("Open the image's browser menu to save it.");
        return;
      }
      if (!response.ok) throw new Error("This cover could not be downloaded.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const extension =
        blob.type === "image/png"
          ? "png"
          : blob.type === "image/webp"
            ? "webp"
            : blob.type === "image/gif"
              ? "gif"
              : blob.type === "image/avif"
                ? "avif"
                : "jpg";
      link.download = `${page.title.replace(/[<>:"/\\|?*]/g, "").trim() || "Max cover"}.${extension}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      notifyError(error, "Couldn't download this cover.");
    } finally {
      setDownloading(false);
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      await ws.call("pages.update", { id: page._id, coverPosition: Math.round(position) });
      setRepositioning(false);
    } catch (error) {
      notifyError(error, "Couldn't save the cover position.");
    } finally {
      setSaving(false);
    }
  };
  const cancel = () => {
    setPosition(page.coverPosition ?? 50);
    setRepositioning(false);
  };
  /** How many pixels of image are hidden above and below; 1:1 dragging moves through exactly that. */
  const overflow = (box: HTMLElement) => {
    const img = box.querySelector("img");
    if (!img || !img.naturalWidth) return box.clientHeight;
    const scale = Math.max(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
    return Math.max(1, img.naturalHeight * scale - box.clientHeight);
  };
  // Joined pill like Notion's: segments separated by a hairline.
  const group = "flex overflow-hidden rounded-md bg-overlay/95 text-xs font-medium text-fg shadow-pop backdrop-blur-sm [&>*+*]:border-s [&>*+*]:border-line";
  const segment = "h-7 px-2.5 hover:bg-hover disabled:opacity-50 focus-visible:outline-none focus-visible:bg-hover";
  return (
    <div
      ref={boxRef}
      className={cn("bg-surface-2 relative h-[30vh] max-h-[280px] min-h-[120px] w-full overflow-hidden outline-none", repositioning && "cursor-move touch-none")}
      {...(repositioning
        ? {
            role: "slider",
            tabIndex: 0,
            "aria-label": "Cover position. Drag the image, or use the up and down arrow keys. Enter saves, Escape cancels.",
            "aria-orientation": "vertical" as const,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.round(position),
          }
        : {})}
      onKeyDown={(event) => {
        if (!repositioning) return;
        const step = event.shiftKey ? 10 : 2;
        if (event.key === "ArrowUp") setPosition((p) => Math.min(100, p + step));
        else if (event.key === "ArrowDown") setPosition((p) => Math.max(0, p - step));
        else if (event.key === "PageUp") setPosition((p) => Math.min(100, p + 10));
        else if (event.key === "PageDown") setPosition((p) => Math.max(0, p - 10));
        else if (event.key === "End") setPosition(100);
        else if (event.key === "Home") setPosition(0);
        else if (event.key === "Enter") void save();
        else if (event.key === "Escape") cancel();
        else return;
        event.preventDefault();
        event.stopPropagation();
      }}
      onPointerDown={(event) => {
        if (!repositioning || saving || event.button !== 0 || (event.target instanceof Element && event.target.closest("button"))) return;
        event.preventDefault();
        drag.current = { y: event.clientY, position, overflow: overflow(event.currentTarget) };
        event.currentTarget.setPointerCapture(event.pointerId);
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d) return;
        // Dragging down reveals more of the top of the image, so the position goes down.
        setPosition(Math.max(0, Math.min(100, d.position - ((event.clientY - d.y) / d.overflow) * 100)));
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      <div className="pointer-events-none size-full select-none">
        <CoverView cover={page.cover} className="size-full" position={repositioning ? position : (page.coverPosition ?? 50)} eager />
      </div>
      {repositioning ? (
        <>
          <span
            className={cn(
              "pointer-events-none absolute start-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md bg-black/45 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm transition-opacity rtl:translate-x-1/2",
              dragging && "opacity-0",
            )}
          >
            Drag image to reposition
          </span>
          <div className={cn(group, "absolute end-4 top-3")}>
            <button type="button" className={segment} disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save position"}
            </button>
            <button type="button" className={segment} disabled={saving} onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <div className="absolute end-4 bottom-3 flex gap-1.5 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          {!readOnly && (
            <div className={group}>
              <CoverPicker
                trigger={
                  <button type="button" className={segment}>
                    Change cover
                  </button>
                }
                onPick={(cover) => void change(cover)}
                onRemove={() => void change(null)}
                onUpload={async (file) => {
                  await change(await upload(file, page._id));
                }}
              />
              {image && (
                <button
                  type="button"
                  className={segment}
                  onClick={() => {
                    setPosition(page.coverPosition ?? 50);
                    setRepositioning(true);
                    requestAnimationFrame(() => boxRef.current?.focus());
                  }}
                >
                  Reposition
                </button>
              )}
            </div>
          )}
          {image && (
            <div className={group}>
              <button type="button" className={cn(segment, "grid place-items-center px-2")} disabled={downloading} onClick={() => void download()} aria-label="Download cover" title="Download cover">
                <Download className="size-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
