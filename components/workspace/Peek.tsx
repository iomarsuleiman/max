"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog as D } from "radix-ui";
import { ChevronDown, ChevronUp, ChevronsRight, Maximize2, PanelRight, RectangleHorizontal } from "lucide-react";
import { IconButton, Tooltip, cn } from "@/components/ui";
import { readLocal, writeLocal } from "@/lib/client/storage";
import { pageTitle } from "@/lib/client/format";
import { PageView, PageTopbarActions } from "@/components/page/PageView";
import { useWorkspace } from "./context";
import { PageIcon } from "./PageIcon";

/**
 * Side peek and center peek, like Notion: a database row (or any page) opens beside or over the
 * current page. Esc closes, ⌘/Ctrl+Enter opens it as a full page, ⌥↑/⌥↓ moves through the rows.
 */
export function PeekHost() {
  const ws = useWorkspace();
  const peek = ws.peek;
  const [width, setWidth] = useState(() => readLocal("peek-width", 640));
  const start = useRef<{ x: number; w: number } | null>(null);
  const list = ws.peekList;
  const index = peek ? list.indexOf(peek.id) : -1;
  const go = (delta: number) => {
    if (!peek || index < 0) return;
    const next = list[index + delta];
    if (next) ws.openPage(next, { mode: peek.mode, list });
  };

  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "Enter") {
        e.preventDefault();
        ws.openPage(peek.id, { mode: "full" });
      } else if (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        go(e.key === "ArrowDown" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!peek) return null;
  const center = peek.mode === "center";

  const header = (data: Parameters<NonNullable<Parameters<typeof PageView>[0]["renderHeader"]>>[0]) => (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-2">
      <Tooltip label="Close" shortcut="Esc">
        <D.Close asChild>
          <IconButton label="Close peek" size="md" tooltip={false}>
            <ChevronsRight className={cn("size-4 flip-rtl", center && "rotate-90")} />
          </IconButton>
        </D.Close>
      </Tooltip>
      <IconButton label="Open as full page" shortcut="⌘↵" size="md" onClick={() => ws.openPage(peek.id, { mode: "full" })}>
        <Maximize2 className="size-3.5" />
      </IconButton>
      <IconButton label={center ? "Switch to side peek" : "Switch to center peek"} size="md" onClick={() => ws.openPage(peek.id, { mode: center ? "side" : "center", list })}>
        {center ? <PanelRight className="size-4" /> : <RectangleHorizontal className="size-4" />}
      </IconButton>
      {list.length > 1 && index >= 0 && (
        <>
          <IconButton label="Previous" shortcut="⌥↑" size="md" disabled={index <= 0} onClick={() => go(-1)}>
            <ChevronUp className="size-4" />
          </IconButton>
          <IconButton label="Next" shortcut="⌥↓" size="md" disabled={index >= list.length - 1} onClick={() => go(1)}>
            <ChevronDown className="size-4" />
          </IconButton>
        </>
      )}
      <span className="ms-1 flex min-w-0 items-center gap-1.5 truncate text-[13px] text-fg-2">
        <PageIcon icon={data.page.icon} kind={data.page.kind} size={14} />
        <span className="truncate">{pageTitle(data.page.title)}</span>
      </span>
      <div className="ms-auto flex shrink-0 items-center gap-1">
        <PageTopbarActions page={data.page} saveSlotId={`save-${data.page._id}`} />
      </div>
    </header>
  );

  return (
    <D.Root open onOpenChange={(o) => !o && ws.closePeek()} modal={center}>
      <D.Portal>
        {center && <D.Overlay className="fixed inset-0 z-[50] bg-[var(--scrim)] [animation:max-fade_150ms_ease]" />}
        <D.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          onInteractOutside={(e) => {
            // In side peek, clicks on menus/toasts opened from the peek shouldn't close it.
            const t = e.target as HTMLElement;
            if (t.closest("[data-radix-popper-content-wrapper], [data-sonner-toaster], [role=dialog]")) e.preventDefault();
          }}
          tabIndex={-1}
          className={cn(
            "fixed z-[51] flex flex-col overflow-hidden bg-canvas outline-none",
            center
              ? "start-1/2 top-1/2 h-[min(92dvh,1000px)] w-[min(980px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl shadow-dialog [animation:max-in_160ms_var(--ease)] rtl:translate-x-1/2"
              : "inset-y-0 end-0 max-w-[100vw] border-s border-line shadow-dialog [animation:max-fade_120ms_ease] max-md:!w-full",
          )}
          style={center ? undefined : { width }}
        >
          <D.Title className="sr-only">{center ? "Center peek" : "Side peek"}</D.Title>
          {!center && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize side peek"
              aria-valuemin={420}
              aria-valuemax={1600}
              aria-valuenow={Math.round(width)}
              tabIndex={0}
              className="absolute inset-y-0 -start-1 z-10 w-2 cursor-col-resize hover:bg-accent/20 max-md:hidden"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                start.current = { x: e.clientX, w: width };
              }}
              onPointerMove={(e) => {
                if (!start.current) return;
                const dx = (start.current.x - e.clientX) * (document.documentElement.dir === "rtl" ? -1 : 1);
                setWidth(Math.max(420, Math.min(window.innerWidth - 120, start.current.w + dx)));
              }}
              onPointerUp={() => {
                start.current = null;
                writeLocal("peek-width", width);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  const w = Math.max(420, Math.min(window.innerWidth - 120, width + (e.key === "ArrowLeft" ? 40 : -40)));
                  setWidth(w);
                  writeLocal("peek-width", w);
                }
              }}
            />
          )}
          <div className="flex min-h-0 flex-1 flex-col">
            <PageView key={peek.id} pageId={peek.id} renderHeader={header} />
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
