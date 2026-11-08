"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronsRight, Menu as MenuIcon } from "lucide-react";
import { IconButton, Tooltip, cn } from "@/components/ui";
import { pageTitle } from "@/lib/client/format";
import { useWorkspace } from "./context";
import { PageIcon } from "./PageIcon";

export interface Crumb {
  _id?: string;
  href?: string;
  title: string;
  icon?: string | null;
  kind?: string;
}

export function Topbar({ crumbs, children, className }: { crumbs: Crumb[]; children?: ReactNode; className?: string }) {
  const ws = useWorkspace();
  // Long trails collapse the middle; every crumb keeps its full title in a tooltip.
  const shown: (Crumb | "gap")[] = crumbs.length > 4 ? [crumbs[0], "gap", ...crumbs.slice(-2)] : crumbs;
  return (
    <header className={cn("flex h-11 shrink-0 items-center gap-1 px-2 sm:px-3", className)}>
      <IconButton label="Open navigation" size="md" className="md:hidden" onClick={() => ws.setMobileNavOpen(true)}>
        <MenuIcon className="size-4" />
      </IconButton>
      {!ws.sidebarOpen && (
        <IconButton label="Open sidebar" shortcut="⌘\" size="md" className="max-md:hidden" onClick={() => ws.setSidebarOpen(true)}>
          <ChevronsRight className="size-4 flip-rtl" />
        </IconButton>
      )}
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center text-[13.5px] text-fg-2">
          {shown.map((c, i) => (
            <li key={c === "gap" ? "gap" : (c._id ?? c.href ?? i)} className="flex min-w-0 items-center">
              {i > 0 && <span className="px-1 text-fg-3" aria-hidden>/</span>}
              {c === "gap" ? (
                <Tooltip label={crumbs.slice(1, -2).map((x) => pageTitle(x.title)).join(" / ")}>
                  <span className="px-1 text-fg-3">…</span>
                </Tooltip>
              ) : (
                <Link
                  href={c.href ?? `/p/${c._id}`}
                  aria-current={i === shown.length - 1 ? "page" : undefined}
                  title={pageTitle(c.title)}
                  className={cn("flex min-w-0 items-center gap-1.5 rounded-[5px] px-1.5 py-0.5 hover:bg-hover", i === shown.length - 1 && "text-fg")}
                >
                  {c.kind !== undefined && <PageIcon icon={c.icon} kind={c.kind} size={14} />}
                  <span className="max-w-[24ch] truncate">{pageTitle(c.title)}</span>
                </Link>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </header>
  );
}
