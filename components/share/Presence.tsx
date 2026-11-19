"use client";

import { useEffect, useState } from "react";
import { usePresencePing, useSharing } from "@/lib/client/data";
import { Tooltip } from "@/components/ui";
import { Avatar } from "@/components/workspace/Sidebar";

interface Here {
  you: string;
  people: { accountId: string; name: string; image: string | null; at: number }[];
}

const PING_MS = 20_000;

/**
 * Faces of the other people on this page right now, like Notion's top bar. Only shared pages
 * send heartbeats, so private pages cost nothing.
 */
export function PresenceStack({ pageId, linkToken, active }: { pageId: string; linkToken: string | null; active: boolean }) {
  const ping = usePresencePing();
  const [bucket, setBucket] = useState(() => Math.floor(Date.now() / 15_000));
  useEffect(() => {
    if (!active) return;
    const beat = () => {
      if (document.visibilityState === "visible") void ping(pageId, linkToken);
      setBucket(Math.floor(Date.now() / 15_000));
    };
    beat();
    const t = setInterval(beat, PING_MS);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [active, pageId, linkToken, ping]);
  const q = useSharing<Here>("here", active ? { pageId, linkToken, at: bucket * 15_000 } : "skip");
  const others = (q.data?.people ?? []).filter((p) => p.accountId !== q.data?.you);
  if (!others.length) return null;
  const shown = others.slice(0, 4);
  const names = others.map((p) => p.name).join(", ");
  return (
    <Tooltip label={`Also here: ${names}`}>
      <div className="flex items-center -space-x-1.5 px-1" role="group" aria-label={`Also on this page: ${names}`}>
        {shown.map((p) => (
          <span key={p.accountId} className="rounded-full ring-2 ring-canvas">
            <Avatar name={p.name} url={p.image} size={24} />
          </span>
        ))}
        {others.length > shown.length && <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-[11px] font-medium text-fg-2 ring-2 ring-canvas">+{others.length - shown.length}</span>}
      </div>
    </Tooltip>
  );
}
