"use client";

import dynamic from "next/dynamic";
import { Dialog } from "@/components/ui";

const GraphView = dynamic(() => import("./GraphView").then((m) => m.GraphView), { ssr: false });

/** A page's local graph: the page, what it links to, what links to it, and its sub-pages. */
export function LocalGraphDialog({ pageId, open, onOpenChange }: { pageId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Local graph" description="Pages linked to and from this one. Raise the depth in graph settings to see further." size="xl" className="h-[min(80dvh,720px)] [&>div:nth-child(2)]:flex [&>div:nth-child(2)]:p-0">
      {open && <GraphView pageId={pageId} compact className="h-full rounded-b-xl" />}
    </Dialog>
  );
}
