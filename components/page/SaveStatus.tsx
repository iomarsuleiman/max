"use client";

import { AlertCircle, Check, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { Tooltip, cn } from "@/components/ui";
import { dateTime, timeAgo } from "@/lib/client/format";
import type { SaveState } from "./useDocumentSync";

const copy: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  retrying: "Retrying…",
  offline: "Offline · kept on this device",
  error: "Not saved",
  conflict: "Changed elsewhere",
};

/** Always-visible, never-truncated save state. */
export function SaveStatus({ state, lastSavedAt, error, onRetry, updatedAt }: { state: SaveState; lastSavedAt: number | null; error: string | null; onRetry: () => void; updatedAt?: number }) {
  const when = lastSavedAt ?? updatedAt;
  const icon =
    state === "saved" ? <Check className="size-3.5" /> : state === "saving" || state === "retrying" ? <Loader2 className="size-3.5 animate-spin" /> : state === "offline" ? <CloudOff className="size-3.5" /> : state === "unsaved" ? <span className="size-1.5 rounded-full bg-fg-3" /> : <AlertCircle className="size-3.5" />;
  const tip = state === "saved" && when ? `Saved ${dateTime(when)}` : error ?? copy[state];
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-1">
      <Tooltip label={tip}>
        <span tabIndex={0} className={cn("inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12.5px] text-fg-3", (state === "error" || state === "conflict") && "text-danger", state === "offline" && "text-warning")}>
          {icon}
          <span className={cn(state === "saved" && "max-sm:hidden")}>{state === "saved" && when ? `Saved ${timeAgo(when)}` : copy[state]}</span>
        </span>
      </Tooltip>
      {(state === "error" || state === "offline") && (
        <button type="button" onClick={onRetry} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12.5px] font-medium text-fg hover:bg-hover">
          <RefreshCw className="size-3.5" /> Retry now
        </button>
      )}
    </div>
  );
}
