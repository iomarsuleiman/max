"use client";

import { useEffect, useRef, useState } from "react";
import { useCollabTransport, useRead } from "@/lib/client/data";
import type { DocumentGetResult } from "@/lib/client/types";
import type { CollabSession, LiveStatus } from "@/components/editor/collab";
import type { MaxEditorProps } from "@/components/editor/MaxEditor";

export interface LiveRoom {
  status: LiveStatus;
  message?: string;
  session: CollabSession | null;
  collab: MaxEditorProps["collab"] | null;
  lastSavedAt: number | null;
  /** Bumps when the room restarts (the page changed outside it): remount the editor. */
  generation: number;
}

/**
 * Joins a shared page's live room while `enabled`. Re-joins on its own when the page is changed
 * from outside the room (an assistant, a restore), which loads the new content for everyone.
 */
export function useLiveRoom(pageId: string, enabled: boolean, linkToken: string | null, user: { name: string; seed: string }): LiveRoom {
  const transport = useCollabTransport(linkToken);
  const read = useRead();
  const readRef = useRef(read);
  readRef.current = read;
  const [generation, setGeneration] = useState(0);
  const [room, setRoom] = useState<Omit<LiveRoom, "generation">>({ status: "connecting", session: null, collab: null, lastSavedAt: null });
  const { name, seed } = user;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let session: CollabSession | null = null;
    setRoom((r) => ({ ...r, status: "connecting", session: null, collab: null }));
    void (async () => {
      try {
        const m = await import("@/components/editor/collab");
        if (cancelled) return;
        session = new m.CollabSession(transport, pageId, {
          onReset: () => !cancelled && setGeneration((g) => g + 1),
          onStatus: (status, message) => !cancelled && setRoom((r) => ({ ...r, status, message })),
          onSaved: (at) => !cancelled && setRoom((r) => ({ ...r, lastSavedAt: at })),
        });
        await session.open(async () => {
          const d = await readRef.current<DocumentGetResult>("documents.get", { pageId });
          return { blocks: d.blocks, revision: d.revision };
        });
        if (cancelled) return;
        const collab = { fragment: session.fragment, awareness: session.awareness, user: { name, color: m.cursorColor(seed) }, withCollaboration: m.withCollaboration as never };
        setRoom((r) => ({ ...r, status: "live", session, collab }));
      } catch (err) {
        if (cancelled) return;
        const code = (err as { code?: string }).code;
        if (code === "CONFLICT") return setGeneration((g) => g + 1);
        setRoom((r) => ({ ...r, status: "error", message: err instanceof Error ? err.message : "Couldn't start live editing." }));
      }
    })();
    const flush = () => void session?.commit();
    window.addEventListener("pagehide", flush);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", flush);
      void session?.close();
    };
  }, [enabled, pageId, transport, generation, name, seed]);

  return { ...room, generation };
}
