"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useDuplicateShared } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { pageHref } from "@/lib/pageUrl";
import { notifyError } from "@/components/workspace/context";

/**
 * "Duplicate" on a page someone shared with you (or published): copies it, with its sub-pages,
 * into your own workspace and opens the copy. Arriving with ?duplicate=1 (from a published page)
 * starts it right away.
 */
export function DuplicateShared({ pageId, linkToken }: { pageId: string; linkToken: string | null }) {
  const duplicate = useDuplicateShared();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const started = useRef(false);
  const run = async () => {
    setBusy(true);
    try {
      const res = await duplicate(pageId, linkToken);
      toast.success(`Duplicated “${pageTitle(res.title)}” to your workspace${res.copied > 1 ? ` (${res.copied} pages)` : ""}`);
      router.push(pageHref(res.id, res.title));
    } catch (err) {
      notifyError(err, "Couldn't duplicate the page.");
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (started.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("duplicate") !== "1") return;
    started.current = true;
    params.delete("duplicate");
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
    void run();
  });
  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      title="Copy this page and the pages inside it to your workspace"
      className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg disabled:opacity-50"
    >
      <Copy className="size-3.5" />
      {busy ? "Duplicating…" : "Duplicate"}
    </button>
  );
}
