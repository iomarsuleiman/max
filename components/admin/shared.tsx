"use client";

import { useEffect, useState } from "react";
import { Button, cn } from "@/components/ui";
import type { AuditEvent } from "@/lib/client/admin";
import { dateTime, timeAgo } from "@/lib/client/format";

/** Debounced server search, a page at a time. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function Pager({ offset, total, size, onOffset, noun }: { offset: number; total: number; size: number; onOffset: (n: number) => void; noun: string }) {
  if (total <= size) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-[13px] text-fg-2">
      <span className="tabular-nums">
        {offset + 1}–{Math.min(offset + size, total)} of {total.toLocaleString("en-US")} {noun}
      </span>
      <Button size="xs" variant="ghost" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - size))}>Previous</Button>
      <Button size="xs" variant="ghost" disabled={offset + size >= total} onClick={() => onOffset(offset + size)}>Next</Button>
    </div>
  );
}

export function RoleBadge({ role }: { role: string }) {
  return <span className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-medium", role === "owner" ? "bg-accent-soft text-accent-text" : role === "admin" ? "bg-warning-soft text-fg" : "bg-surface-2 text-fg-2")}>{role.charAt(0).toUpperCase() + role.slice(1)}</span>;
}

export function EventList({ events, empty }: { events: AuditEvent[]; empty: string }) {
  if (!events.length) return <p className="text-[13px] text-fg-3">{empty}</p>;
  return (
    <ul className="grid gap-0.5" aria-label="Activity">
      {events.map((e) => (
        <li key={e._id} className="flex items-start gap-3 py-1 text-[13px]">
          <span className="w-24 shrink-0 text-fg-3" title={dateTime(e.at)}>{timeAgo(e.at)}</span>
          <span className="min-w-0 flex-1">
            <span className="font-mono text-[12px]">{e.action}</span> <span className="text-fg-2">by {e.actorName || e.actorId}</span>
            {e.scopeName && <span className="text-fg-3"> · {e.scopeName}</span>}
            {e.detail && <span className="block truncate text-fg-3" title={e.detail}>{e.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

