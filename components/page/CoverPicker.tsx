"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Popover, PopoverClose, Input, cn } from "@/components/ui";

export const GRADIENTS = ["gradient:1", "gradient:2", "gradient:3", "gradient:4", "gradient:5", "gradient:6"];

export function coverClass(cover: string | null | undefined): string | null {
  if (!cover?.startsWith("gradient:")) return null;
  return `cover-gradient-${cover.split(":")[1]}`;
}

export function CoverPicker({ trigger, onPick, onUpload, onRemove }: { trigger: ReactNode; onPick: (cover: string) => void; onUpload: (file: File) => Promise<void>; onRemove?: () => void }) {
  const [tab, setTab] = useState<"gallery" | "upload" | "link">("gallery");
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  return (
    <Popover trigger={trigger} align="end" className="w-[min(420px,calc(100vw-24px))]">
      <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
        {(["gallery", "upload", "link"] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cn("h-8 border-b-2 border-transparent px-2 text-[13px] text-fg-2 hover:text-fg", tab === t && "border-fg text-fg")}>
            {t === "gallery" ? "Gallery" : t === "upload" ? "Upload" : "Link"}
          </button>
        ))}
        {onRemove && (
          <PopoverClose asChild>
            <button type="button" onClick={onRemove} className="ms-auto h-7 rounded-md px-2 text-[13px] text-fg-2 hover:bg-hover">
              Remove
            </button>
          </PopoverClose>
        )}
      </div>
      <div className="p-3">
        {tab === "gallery" && (
          <div className="grid grid-cols-3 gap-2">
            {GRADIENTS.map((g) => (
              <PopoverClose asChild key={g}>
                <button type="button" aria-label={`Cover ${g.split(":")[1]}`} onClick={() => onPick(g)} className={cn("h-16 rounded-md ring-offset-2 hover:ring-2 hover:ring-line-strong", coverClass(g))} />
              </PopoverClose>
            ))}
          </div>
        )}
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
            <p className="text-xs text-fg-3">PNG, JPEG, WebP, GIF or AVIF, up to 20 MB. Wide images (1500 px or more) look best.</p>
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
