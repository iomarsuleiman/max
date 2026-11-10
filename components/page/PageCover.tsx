"use client";

import { useRef, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { coverImageUrl } from "@/lib/client/covers";
import { useAssetResolver, useUploader } from "@/lib/client/upload";
import type { PageRow } from "@/lib/client/types";
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
  const drag = useRef<{ y: number; position: number } | null>(null);
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
  const control = "h-7 rounded-md bg-overlay/95 px-2.5 text-xs font-medium text-fg shadow-pop hover:bg-overlay disabled:opacity-50";
  return (
    <div
      className={`bg-surface-2 relative h-[30vh] max-h-[280px] min-h-[120px] w-full overflow-hidden ${repositioning ? "cursor-grab touch-none active:cursor-grabbing" : ""}`}
      onPointerDown={(event) => {
        if (!repositioning || saving || event.button !== 0 || (event.target instanceof Element && event.target.closest("button, input"))) return;
        event.preventDefault();
        drag.current = { y: event.clientY, position };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        setPosition(Math.max(0, Math.min(100, drag.current.position - ((event.clientY - drag.current.y) / event.currentTarget.clientHeight) * 100)));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <div className="pointer-events-none size-full select-none">
        <CoverView cover={page.cover} className="size-full" position={repositioning ? position : (page.coverPosition ?? 50)} eager />
      </div>
      {repositioning ? (
        <div className="bg-overlay/95 shadow-pop absolute inset-x-4 bottom-3 flex flex-wrap items-center justify-center gap-2 rounded-lg p-2">
          <label className="text-fg flex items-center gap-2 text-xs">
            Drag to reposition{" "}
            <input
              type="range"
              min="0"
              max="100"
              value={position}
              disabled={saving}
              onChange={(event) => setPosition(Number(event.target.value))}
              aria-label="Cover position"
              className="accent-accent w-32"
            />
          </label>
          <button
            type="button"
            className={control}
            disabled={saving}
            onClick={async () => {
              setSaving(true);
              try {
                await ws.call("pages.update", { id: page._id, coverPosition: Math.round(position) });
                setRepositioning(false);
              } catch (error) {
                notifyError(error, "Couldn't save the cover position.");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save position"}
          </button>
          <button type="button" className={control} disabled={saving} onClick={() => setRepositioning(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="absolute end-4 bottom-3 flex gap-1 opacity-0 transition-opacity group-hover/header:opacity-100 focus-within:opacity-100 max-md:opacity-100">
          {!readOnly && (
            <>
              <CoverPicker
                trigger={
                  <button type="button" className={control}>
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
                  className={control}
                  onClick={() => {
                    setPosition(page.coverPosition ?? 50);
                    setRepositioning(true);
                  }}
                >
                  Reposition
                </button>
              )}
            </>
          )}
          {image && (
            <button type="button" className={control} disabled={downloading} onClick={() => void download()} aria-label="Download cover" title="Download cover">
              <Download className="size-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
