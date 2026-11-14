"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useQueries } from "convex/react";
import { anyApi } from "convex/server";
import { Layers3, LockKeyhole, NotebookPen } from "lucide-react";
import { cn } from "@/components/ui";
import { CLOUD } from "@/lib/config";
import {
  workspacePreviewHref, type WorkspaceNavigationSummary,
} from "@/lib/domain/workspaceNavigation";

export const WORKSPACE_NAVIGATION_PREVIEW =
  CLOUD && process.env.NEXT_PUBLIC_MAX_V2_NAVIGATION_PREVIEW_ENABLED === "true";

/** Convex errors and malformed values are never represented as memberships.
 * The server authenticates and authorizes this query independently. */
export function useWorkspaceNavigation(): {
  workspaces: WorkspaceNavigationSummary[];
  loading: boolean;
  error: boolean;
} {
  const queries = useMemo(() => ({
    list: { query: anyApi.workspaceNavigation.list, args: {} },
  }), []);
  const result = useQueries(queries as never) as { list?: unknown };
  const loading = result.list === undefined;
  const error = result.list instanceof Error ||
    (result.list !== undefined && !Array.isArray(result.list));
  const workspaces = !error && Array.isArray(result.list)
    ? (result.list as unknown[]).filter((row): row is WorkspaceNavigationSummary => {
      if (!row || typeof row !== "object") return false;
      const item = row as Record<string, unknown>;
      return typeof item.workspaceId === "string" &&
        workspacePreviewHref(item.workspaceId) !== null &&
        ["owner", "admin", "member", "guest"].includes(String(item.role));
    })
    : [];
  return { workspaces, loading, error };
}

/** The personal editor is deliberately kept alive when opening a preview.
 * Returning from a preview is safe because previews contain no writable editor. */
function workspaceLinkProps(fromPreview: boolean) {
  return fromPreview ? {} : { target: "_blank", rel: "noopener noreferrer" };
}

export function WorkspaceRail() {
  const pathname = usePathname();
  const preview = pathname.startsWith("/w/");
  const { workspaces, loading, error } = useWorkspaceNavigation();
  return (
    <nav aria-label="Workspaces" className="hidden h-full w-[60px] shrink-0 flex-col items-center gap-2 border-e border-line bg-surface px-1.5 py-3 md:flex">
      <a href="/home" aria-label="Private notes" title="Private notes" aria-current={!preview ? "page" : undefined}
        className={cn("grid size-10 place-items-center rounded-xl text-fg-2 transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          !preview && "bg-hover text-fg ring-1 ring-line")}>
        <NotebookPen className="size-5" aria-hidden />
      </a>
      <span aria-hidden className="my-1 w-6 border-t border-line" />
      {workspaces.map(({ workspaceId, role }) => {
        const href = workspacePreviewHref(workspaceId);
        if (!href) return null;
        const active = pathname === href;
        return (
          <a key={workspaceId} href={href} {...workspaceLinkProps(preview)}
            aria-label={`Workspace ${workspaceId} (${role}, preview only)`}
            title={`${workspaceId} · ${role} · read-only preview`}
            aria-current={active ? "page" : undefined}
            className={cn("grid size-10 shrink-0 place-items-center rounded-xl border border-transparent text-fg-2 transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active && "border-line bg-hover text-fg")}>
            <Layers3 className="size-5" aria-hidden />
          </a>
        );
      })}
      {loading && <span role="status" aria-label="Loading workspaces" className="size-7 animate-pulse rounded-lg bg-hover" />}
      {error && <span title="Workspaces unavailable" aria-label="Workspaces unavailable" role="status"><LockKeyhole className="size-4 text-fg-3" /></span>}
      <span className="mt-auto text-[10px] text-fg-3" title="Max 2.0 navigation preview">2.0</span>
    </nav>
  );
}

/** Keyboard/touch-accessible mobile chooser. Links to previews from a personal
 * editor open in a separate tab so unfinished notes are never discarded. */
export function MobileWorkspacePicker() {
  const pathname = usePathname();
  const preview = pathname.startsWith("/w/");
  const { workspaces, loading, error } = useWorkspaceNavigation();
  return (
    <details className="mx-2 mb-2 rounded-lg border border-line p-2 md:hidden">
      <summary className="cursor-pointer text-[13px] font-medium text-fg">Workspaces · Preview</summary>
      <div className="mt-2 grid gap-1 text-[13px]">
        <a href="/home" className="rounded-md px-2 py-2 text-fg hover:bg-hover" aria-current={!preview ? "page" : undefined}>Private notes</a>
        {workspaces.map(({ workspaceId, role }) => {
          const href = workspacePreviewHref(workspaceId);
          return href ? (
            <a key={workspaceId} href={href} {...workspaceLinkProps(preview)} aria-current={pathname === href ? "page" : undefined}
              className="rounded-md px-2 py-2 text-fg hover:bg-hover">{workspaceId} · {role}</a>
          ) : null;
        })}
        {loading && <span role="status" className="px-2 text-fg-3">Loading workspaces…</span>}
        {error && <span role="status" className="px-2 text-fg-3">Workspaces unavailable</span>}
        {!loading && !error && workspaces.length === 0 && <span className="px-2 text-fg-3">No active shared memberships</span>}
        <p className="px-2 text-xs text-fg-3">Shared pages are not available in this preview.</p>
      </div>
    </details>
  );
}

export function WorkspacePreviewSidebar() {
  return (
    <aside aria-label="Workspace preview navigation" className="flex h-full w-[min(82vw,260px)] shrink-0 flex-col border-e border-line bg-surface py-4">
      <div className="px-4 text-[13px] font-semibold text-fg">Max workspaces</div>
      <p className="px-4 pt-1 text-xs text-fg-3">Navigation foundation · read-only</p>
      <div className="mt-4"><MobileWorkspacePicker /></div>
      <a href="/home" className="mx-3 mt-2 rounded-md px-3 py-2 text-[13px] text-fg hover:bg-hover">Private notes</a>
      <p className="mt-auto px-4 text-xs leading-relaxed text-fg-3">
        Shared pages, search, editors, exports and MCP remain disabled until their own security reviews.
      </p>
    </aside>
  );
}
