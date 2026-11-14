"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useQueries } from "convex/react";
import { anyApi } from "convex/server";
import { Layers3, LockKeyhole, NotebookPen } from "lucide-react";
import { cn } from "@/components/ui";
import { CLOUD } from "@/lib/config";
import {
  DEFAULT_PREVIEW_NAVIGATION_STATE, previewNavigationStorageKey,
  readPreviewNavigationState, verifiedNavigationSummaries,
  workspaceSwitchIntent, writePreviewNavigationState,
  type ScopedPreviewNavigationState,
} from "@/lib/domain/workspaceNavigationState";
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
  const verified = loading || result.list instanceof Error ? null : verifiedNavigationSummaries(result.list);
  const error = !loading && verified === null;
  const workspaces: WorkspaceNavigationSummary[] = verified ?? [];
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
        const intent = workspaceSwitchIntent(pathname, workspaceId, workspaces);
        if (!intent) return null;
        const href = intent.href;
        const active = pathname === href;
        return (
          <a key={workspaceId} href={href} {...workspaceLinkProps(!intent.newTab)}
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
          const intent = workspaceSwitchIntent(pathname, workspaceId, workspaces);
          return intent ? (
            <a key={workspaceId} href={intent.href} {...workspaceLinkProps(!intent.newTab)} aria-current={pathname === intent.href ? "page" : undefined}
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

/** Metadata-only workspace sidebar. Stored state is strictly per account + workspace.
 * Unlike the personal sidebar, it never invokes legacy pages.tree or search. */
export function WorkspacePreviewSidebar() {
  const pathname = usePathname();
  const { user } = useUser();
  const { workspaces, loading, error } = useWorkspaceNavigation();
  const active = workspaces.find((row) => workspacePreviewHref(row.workspaceId) === pathname);
  const accountId = user?.id ?? null;
  const workspaceId = active?.workspaceId ?? null;
  const scopeKey = workspaceId ? previewNavigationStorageKey(accountId, workspaceId) : null;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [memory, setMemory] = useState<ScopedPreviewNavigationState>({ ...DEFAULT_PREVIEW_NAVIGATION_STATE });
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = workspaceId && scopeKey
      ? readPreviewNavigationState(window.sessionStorage, accountId, workspaceId)
      : { ...DEFAULT_PREVIEW_NAVIGATION_STATE };
    setMemory(next);
    setLoadedKey(scopeKey);
    if (scroller.current) scroller.current.scrollTop = next.scrollTop;
  }, [accountId, workspaceId, scopeKey]);

  const ready = !!scopeKey && loadedKey === scopeKey;
  const collapsed = ready && memory.collapsed;
  const toggle = () => {
    if (!ready || !workspaceId) return;
    const next = { ...memory, collapsed: !memory.collapsed };
    setMemory(next);
    writePreviewNavigationState(window.sessionStorage, accountId, workspaceId, next);
  };

  return (
    <aside aria-label="Workspace preview navigation"
      className="flex h-full w-[min(86vw,280px)] shrink-0 flex-col border-e border-line bg-surface py-4">
      <div className="px-4 text-[13px] font-semibold text-fg">Max workspaces</div>
      <p className="px-4 pt-1 text-xs text-fg-3">Membership preview · no shared pages</p>
      <div className="mt-4 px-3">
        <button type="button" disabled={!ready}
          aria-expanded={!collapsed} aria-controls="workspace-preview-contexts"
          onClick={toggle}
          className="flex min-h-9 w-full items-center justify-between rounded-md border border-line px-3 py-2 text-start text-[13px] text-fg hover:bg-hover disabled:opacity-60">
          <span>Workspace contexts</span><span aria-hidden>{collapsed ? "+" : "−"}</span>
        </button>
      </div>
      <div id="workspace-preview-contexts" ref={scroller}
        onScroll={(event) => {
          if (!ready || !workspaceId) return;
          const next = { ...memory, scrollTop: Math.min(100000, Math.max(0, Math.round(event.currentTarget.scrollTop))) };
          writePreviewNavigationState(window.sessionStorage, accountId, workspaceId, next);
        }}
        className="scroll-quiet mt-2 min-h-0 flex-1 overflow-y-auto px-3"
        hidden={collapsed}>
        {loading && <p role="status" className="px-2 py-2 text-xs text-fg-3">Checking memberships…</p>}
        {error && <p role="status" className="px-2 py-2 text-xs text-fg-3">Workspaces unavailable. Access must be verified again.</p>}
        {!loading && !error && !active && <p role="status" className="px-2 py-2 text-xs text-fg-3">Workspace access unavailable.</p>}
        {!loading && !error && workspaces.map((workspace) => {
          const intent = workspaceSwitchIntent(pathname, workspace.workspaceId, workspaces);
          if (!intent) return null;
          return (
            <a key={workspace.workspaceId} href={intent.href}
              aria-current={pathname === intent.href ? "page" : undefined}
              className={cn("mt-1 flex min-h-9 items-center gap-2 rounded-md px-3 text-[13px] text-fg-2 hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
                pathname === intent.href && "bg-hover font-medium text-fg")}>
              <Layers3 className="size-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{workspace.workspaceId}</span>
              <span className="text-[11px] text-fg-3">{workspace.role}</span>
            </a>
          );
        })}
        {!loading && !error && workspaces.length === 0 &&
          <p className="px-2 py-2 text-xs text-fg-3">No active shared memberships.</p>}
      </div>
      <a href="/home" className="mx-3 mt-3 rounded-md border border-line px-3 py-2 text-[13px] text-fg hover:bg-hover">
        Return to private notes
      </a>
      <p className="mt-3 px-4 text-xs leading-relaxed text-fg-3">
        Shared pages, search, editing, exports and MCP remain unavailable.
      </p>
    </aside>
  );
}
