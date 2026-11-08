"use client";

import { useRef, useState, type ReactNode } from "react";
import { Shuffle } from "lucide-react";
import { Button, Popover, PopoverClose, Input, cn } from "@/components/ui";
import { ALL_COVERS, COVER_COLLECTIONS } from "@/lib/client/covers";
import { CoverView } from "./CoverView";

export function coverClass(cover: string | null | undefined): string | null {
  if (!cover?.startsWith("gradient:")) return null;
  return `cover-gradient-${cover.split(":")[1]}`;
}

export function randomCover() {
  return ALL_COVERS[Math.floor(Math.random() * ALL_COVERS.length)];
}

/** Notion-style cover picker: gallery collections, upload, or link. */
export function CoverPicker({ trigger, onPick, onUpload, onRemove }: { trigger: ReactNode; onPick: (cover: string) => void; onUpload: (file: File) => Promise<void>; onRemove?: () => void }) {
  const [tab, setTab] = useState<"gallery" | "upload" | "link">("gallery");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <Popover trigger={trigger} align="end" className="w-[min(540px,calc(100vw-24px))]">
      <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
        {(["gallery", "upload", "link"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("h-8 border-b-2 border-transparent px-2 text-[13px] text-fg-2 hover:text-fg", tab === t && "border-fg font-medium text-fg")}>
            {t === "gallery" ? "Gallery" : t === "upload" ? "Upload" : "Link"}
          </button>
        ))}
        <PopoverClose asChild>
          <button type="button" onClick={() => onPick(randomCover())} className="ms-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover">
            <Shuffle className="size-3.5" /> Random
          </button>
        </PopoverClose>
        {onRemove && (
          <PopoverClose asChild>
            <button type="button" onClick={onRemove} className="h-7 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover">
              Remove
            </button>
          </PopoverClose>
        )}
      </div>
      <div className="max-h-[min(440px,60dvh)] overflow-y-auto p-3">
        {tab === "gallery" &&
          COVER_COLLECTIONS.map((c) => (
            <section key={c.name} className="mb-4 last:mb-0" aria-label={c.name}>
              <h4 className="mb-1.5 text-[12px] font-medium text-fg-3">{c.name}</h4>
              <div className="grid grid-cols-4 gap-2 max-sm:grid-cols-3">
                {c.items.map((item) => (
                  <PopoverClose asChild key={item.value}>
                    <button type="button" aria-label={`${c.name}: ${item.label}`} title={item.label} onClick={() => onPick(item.value)} className="overflow-hidden rounded-md ring-offset-2 ring-offset-overlay hover:ring-2 hover:ring-line-strong focus-visible:ring-2 focus-visible:ring-accent">
                      <CoverView cover={item.value} className="h-14 w-full" />
                    </button>
                  </PopoverClose>
                ))}
              </div>
            </section>
          ))}
        {tab === "upload" && (
          <div className="grid gap-2">
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
              className="sr-only"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setBusy(true);
                setError(null);
                try {
                  await onUpload(f);
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Upload failed.");
                } finally {
                  setBusy(false);
                }
              }}
            />
            <Button pending={busy} onClick={() => file.current?.click()}>
              Choose an image
            </Button>
            <p className="text-xs text-fg-3">PNG, JPEG, WebP, GIF or AVIF, up to 20 MB. Images wider than 1500 px look best.</p>
            {error && <p className="text-xs text-danger" role="alert">{error}</p>}
          </div>
        )}
        {tab === "link" && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!/^https:\/\/\S+\.\S+/.test(link.trim())) return setError("Paste an https link to an image.");
              onPick(link.trim());
            }}
          >
            <Input value={link} onChange={(e) => (setLink(e.target.value), setError(null))} placeholder="https://…" aria-label="Image link" invalid={!!error} />
            {error && <p className="text-xs text-danger" role="alert">{error}</p>}
            <Button type="submit" variant="primary">
              Use this image
            </Button>
          </form>
        )}
      </div>
    </Popover>
  );
}
