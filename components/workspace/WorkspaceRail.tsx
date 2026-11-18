"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { useUser } from "@clerk/nextjs";
import { usePathname } from "next/navigation";
import { useQueries } from "convex/react";
import { anyApi } from "convex/server";
import { Layers3, LockKeyhole, NotebookPen } from "lucide-react";
import { cn } from "@/components/ui";
import { CLOUD } from "@/lib/config";
import { isAccidentalWorkspaceSwitchGesture, nextWorkspaceFocusIndex } from "@/lib/domain/workspaceNavigationErgonomics";
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

/** Arrow/Home/End move focus only. Enter and click retain native link behavior.
 * Vertical navigation works identically in RTL and LTR; no global shortcuts. */
function onWorkspaceNavigationKeyDown(event: KeyboardEvent<HTMLElement>) {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const target = event.target;
  if (!(target instanceof HTMLAnchorElement) || !target.hasAttribute("data-workspace-focus")) return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-workspace-focus]"));
  const next = nextWorkspaceFocusIndex(event.key, links.indexOf(target), links.length);
  if (next === null) return;
  event.preventDefault();
  links[next]?.focus();
}

/** Ignore a swipe/scroll ending over a link, but preserve accessible native
 * anchors for keyboard users and intentional short taps. */
function useWorkspaceSwitchGuard() {
  const origin = useRef<{ pointerId: number; x: number; y: number; type: string } | null>(null);
  const suppressClick = useRef(false);
  return {
    onPointerDownCapture(event: PointerEvent<HTMLElement>) {
      origin.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, type: event.pointerType };
      suppressClick.current = false;
    },
    onPointerUpCapture(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      suppressClick.current = !!start && start.pointerId === event.pointerId &&
        isAccidentalWorkspaceSwitchGesture(start.type, event.clientX - start.x, event.clientY - start.y);
      origin.current = null;
    },
    onPointerCancelCapture() { origin.current = null; suppressClick.current = false; },
    onClickCapture(event: MouseEvent<HTMLElement>) {
      const block = event.detail !== 0 && suppressClick.current &&
        event.target instanceof Element && !!event.target.closest("a[data-workspace-focus]");
      suppressClick.current = false;
      if (block) { event.preventDefault(); event.stopPropagation(); }
    },
  };
}

function previewStorage(): Storage | null {
  try { return window.sessionStorage; } catch { return null; }
}

export function WorkspaceRail() {
  const pathname = usePathname();
  const preview = pathname.startsWith("/w/");
  const { workspaces, loading, error } = useWorkspaceNavigation();
  const switchGuard = useWorkspaceSwitchGuard();
  return (
    <nav {...switchGuard} onKeyDown={onWorkspaceNavigationKeyDown}
      aria-label="Workspaces; use Up and Down arrows to move focus"
      className="scroll-quiet hidden h-full w-[64px] shrink-0 flex-col items-center gap-2 overflow-y-auto overscroll-contain border-e border-line bg-surface px-1.5 py-3 md:flex">
      <a data-workspace-focus href="/home" aria-label="Private notes" title="Private notes" aria-current={!preview ? "page" : undefined}
        className={cn("grid size-11 shrink-0 place-items-center rounded-xl text-fg-2 transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
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
          <a data-workspace-focus key={workspaceId} href={href} {...workspaceLinkProps(!intent.newTab)}
            aria-label={`Workspace ${workspaceId} (${role}, preview only${intent.newTab ? ", opens in new tab" : ""})`}
            title={`${workspaceId} · ${role} · read-only preview`}
            aria-current={active ? "page" : undefined}
            className={cn("grid size-11 shrink-0 place-items-center rounded-xl border border-transparent text-fg-2 transition-colors hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
              active && "border-line bg-hover text-fg")}>
            <Layers3 className="size-5" aria-hidden />
          </a>
        );
      })}
      {loading && <span role="status" aria-label="Loading workspaces" className="size-7 animate-pulse rounded-lg bg-hover motion-reduce:animate-none" />}
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
  const switchGuard = useWorkspaceSwitchGuard();
  return (
    <details className="mx-2 mb-2 rounded-lg border border-line p-2 md:hidden">

      <summary className="flex min-h-11 cursor-pointer items-center rounded-md px-2 text-[13px] font-medium text-fg focus-visible:outline-2 focus-visible:outline-accent">Workspaces · Preview</summary>
      <div {...switchGuard} onKeyDown={onWorkspaceNavigationKeyDown}
        className="scroll-quiet mt-2 grid max-h-[50dvh] gap-1 overflow-y-auto overscroll-contain text-[13px]">
        <a data-workspace-focus href="/home" className="flex min-h-11 items-center rounded-md px-3 text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent" aria-current={!preview ? "page" : undefined}>Private notes</a>
        {workspaces.map(({ workspaceId, role }) => {
          const intent = workspaceSwitchIntent(pathname, workspaceId, workspaces);
          return intent ? (
            <a data-workspace-focus key={workspaceId} href={intent.href} {...workspaceLinkProps(!intent.newTab)}
              aria-label={`Workspace ${workspaceId}, ${role}, preview only${intent.newTab ? ", opens in new tab" : ""}`}
              aria-current={pathname === intent.href ? "page" : undefined}
              className="flex min-h-11 items-center rounded-md px-3 text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent"><bdi dir="auto">{workspaceId}</bdi> · {role}</a>
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
  const contextsId = useId();
  const switchGuard = useWorkspaceSwitchGuard();

  useEffect(() => {
    const storage = previewStorage();
    const next = workspaceId && scopeKey && storage
      ? readPreviewNavigationState(storage, accountId, workspaceId)
      : { ...DEFAULT_PREVIEW_NAVIGATION_STATE };
    setMemory(next);
    setLoadedKey(scopeKey);
    if (scroller.current) scroller.current.scrollTop = next.scrollTop;
  }, [accountId, workspaceId, scopeKey]);

  const ready = !!scopeKey && loadedKey === scopeKey;
  // Hidden scrollers cannot reliably restore a non-zero offset; retry on expand.
  useEffect(() => {
    if (ready && !memory.collapsed && scroller.current) scroller.current.scrollTop = memory.scrollTop;
  }, [ready, memory.collapsed, memory.scrollTop, scopeKey]);
  const collapsed = ready && memory.collapsed;
  const toggle = () => {
    if (!ready || !workspaceId) return;
    const next = { ...memory, collapsed: !memory.collapsed };
    setMemory(next);
    const storage = previewStorage();
    if (storage) writePreviewNavigationState(storage, accountId, workspaceId, next);
  };

  return (
    <aside {...switchGuard} onKeyDown={onWorkspaceNavigationKeyDown} aria-label="Workspace preview navigation"
      className="flex h-full w-[min(86vw,320px)] shrink-0 flex-col border-e border-line bg-surface pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))]">
      <div className="px-4 text-[13px] font-semibold text-fg">Max workspaces</div>
      <p className="px-4 pt-1 text-xs text-fg-3">Membership preview · no shared pages</p>
      <div className="mt-4 px-3">
        <button type="button" disabled={!ready}
          aria-expanded={!collapsed} aria-controls={contextsId}
          onClick={toggle}
          className="flex min-h-11 w-full items-center justify-between rounded-md border border-line px-3 py-2 text-start text-[13px] text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60">
          <span>Workspace contexts</span><span aria-hidden>{collapsed ? "+" : "−"}</span>
        </button>
      </div>
      <div id={contextsId} ref={scroller}
        onScroll={(event) => {
          if (!ready || !workspaceId) return;
          const next = { ...memory, scrollTop: Math.min(100000, Math.max(0, Math.round(event.currentTarget.scrollTop))) };
          setMemory(next);
          const storage = previewStorage();
          if (storage) writePreviewNavigationState(storage, accountId, workspaceId, next);
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
            <a data-workspace-focus key={workspace.workspaceId} href={intent.href}
              aria-current={pathname === intent.href ? "page" : undefined}
              className={cn("mt-1 flex min-h-11 items-center gap-2 rounded-md px-3 text-[13px] text-fg-2 hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent",
                pathname === intent.href && "bg-hover font-medium text-fg")}>
              <Layers3 className="size-4 shrink-0" aria-hidden />
              <bdi dir="auto" className="min-w-0 flex-1 truncate">{workspace.workspaceId}</bdi>
              <span className="text-[11px] text-fg-3">{workspace.role}</span>
            </a>
          );
        })}
        {!loading && !error && workspaces.length === 0 &&
          <p className="px-2 py-2 text-xs text-fg-3">No active shared memberships.</p>}
      </div>
      <a data-workspace-focus href="/home" className="mx-3 mt-3 flex min-h-11 items-center rounded-md border border-line px-3 text-[13px] text-fg hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent">
        Return to private notes
      </a>
      <p className="mt-3 px-4 text-xs leading-relaxed text-fg-3">
        Shared pages, search, editing, exports and MCP remain unavailable.
      </p>
    </aside>
  );
}
