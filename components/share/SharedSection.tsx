"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import { cn } from "@/components/ui";
import { ShareScope, useOp, useSharing } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { pageHref, pageIdFromPath } from "@/lib/pageUrl";
import { PageIcon } from "@/components/workspace/PageIcon";
import type { PageSummary } from "@/lib/client/types";
import type { ShareLevel } from "@/lib/domain/types";

interface SharedRoot {
  _id: string;
  title: string;
  icon: string | null;
  kind: "page" | "database";
  level: ShareLevel;
  ownerName: string | null;
  teamspace?: boolean;
}

/** Notion's "Shared" sidebar section: pages other people shared with you, with their sub-pages. */
export function SharedSection() {
  const q = useSharing<SharedRoot[]>("withMe", {});
  const [open, setOpen] = useState(true);
  // Teamspaces shared with you are listed under Teamspaces instead.
  const pages = q.data?.filter((p) => !p.teamspace) ?? [];
  if (!pages.length) return null;
  return (
    <section className="relative mt-3" aria-label="Shared with you">
      <div className="flex h-7 items-center rounded-md ps-1 pe-1 hover:bg-hover">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex flex-1 items-center gap-1 self-stretch text-start text-xs font-medium text-fg-3 hover:text-fg-2">
          <ChevronRight className={cn("size-3.5 shrink-0 transition-transform duration-150 flip-rtl", open && "rotate-90")} />
          Shared
        </button>
      </div>
      {open && (
        <ul role="tree" aria-label="Pages shared with you" className="mt-px">
          {pages.map((p) => (
            <ShareScope key={p._id} value={{ pageId: p._id, linkToken: null }}>
              <SharedRow page={p} depth={0} owner={p.ownerName} />
            </ShareScope>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SharedRow({ page, depth, owner }: { page: Pick<SharedRoot, "_id" | "title" | "icon" | "kind">; depth: number; owner?: string | null }) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const active = pageIdFromPath(pathname) === page._id;
  return (
    <li role="treeitem" aria-level={depth + 1} aria-expanded={page.kind === "page" ? expanded : undefined} aria-selected={active}>
      <div className={cn("group/row flex h-7 items-center gap-0.5 rounded-md pe-1 text-[13.5px] text-fg-2 hover:bg-hover", active && "bg-hover font-medium text-fg")} style={{ paddingInlineStart: 4 + depth * 12 }}>
        <button
          type="button"
          aria-label={expanded ? `Collapse ${pageTitle(page.title)}` : `Expand ${pageTitle(page.title)}`}
          onClick={() => setExpanded(!expanded)}
          className={cn("grid size-5 shrink-0 place-items-center rounded-[4px] text-fg-3 hover:bg-hover hover:text-fg-2", page.kind !== "page" && "invisible")}
          tabIndex={-1}
        >
          {expanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5 flip-rtl" />}
        </button>
        <Link href={pageHref(page._id, page.title)} className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch" title={owner ? `Shared by ${owner}` : undefined}>
          <PageIcon icon={page.icon} kind={page.kind} />
          <span className="truncate">{pageTitle(page.title)}</span>
        </Link>
        {owner !== undefined && <Users className="size-3.5 shrink-0 text-fg-3 opacity-0 group-hover/row:opacity-100" aria-label={owner ? `Shared by ${owner}` : "Shared with you"} />}
      </div>
      {expanded && <SharedChildren parentId={page._id} depth={depth + 1} />}
    </li>
  );
}

function SharedChildren({ parentId, depth }: { parentId: string; depth: number }) {
  const q = useOp<{ pages: PageSummary[] }>("pages.children", { parentId });
  if (!q.data) return null;
  if (!q.data.pages.length) return <p className="py-1 text-[12.5px] text-fg-3" style={{ paddingInlineStart: 30 + depth * 12 }}>No pages inside</p>;
  return (
    <ul role="group">
      {q.data.pages.map((child) => (
        <SharedRow key={child._id} page={child} depth={depth} />
      ))}
    </ul>
  );
}
