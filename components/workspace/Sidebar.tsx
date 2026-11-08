"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  Clock,
  Database,
  Download,
  GripVertical,
  Home,
  LayoutTemplate,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  SquarePen,
  Star,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { IconButton, Kbd, Menu, MenuContent, MenuItem, MenuSeparator, MenuSub, MenuSubContent, MenuSubTrigger, MenuTrigger, MenuLabel, Popover, Skeleton, cn } from "@/components/ui";
import { LogoMark } from "@/components/brand/Logo";
import { useOp, prefetchOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import type { PageSummary, SettingsRow } from "@/lib/client/types";
import { CLOUD } from "@/lib/config";
import { notifyError, useWorkspace } from "./context";
import { PageIcon } from "./PageIcon";
import { PageMenu } from "./PageMenu";
import { PageTree } from "./PageTree";
import { TrashPanel } from "./TrashPanel";

type SectionId = SettingsRow["sidebarSections"][number];
const SECTION_LABEL: Record<SectionId, string> = { favorites: "Favorites", recents: "Recents", pages: "Pages", databases: "Databases" };

export function Sidebar({ mobile }: { mobile?: boolean }) {
  const ws = useWorkspace();
  const settings = ws.settings;
  const [width, setWidth] = useState(settings?.sidebarWidth ?? 248);
  useEffect(() => {
    if (settings?.sidebarWidth) setWidth(settings.sidebarWidth);
  }, [settings?.sidebarWidth]);

  const sections = (settings?.sidebarSections ?? ["favorites", "recents", "pages", "databases"]).filter((s) => s !== "recents" || settings?.showRecents !== false);
  const collapsed = new Set(settings?.collapsedSections ?? []);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const [order, setOrder] = useState<SectionId[] | null>(null);
  const shown = order ?? sections;

  const onSectionsDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id || !settings) return;
    const all = settings.sidebarSections;
    const next = arrayMove(all, all.indexOf(active.id as SectionId), all.indexOf(over.id as SectionId));
    setOrder(next.filter((s) => sections.includes(s)));
    await ws.updateSettings({ sidebarSections: next });
    setOrder(null);
    toast.success("Sidebar order saved", { duration: 1500, action: { label: "Reset", onClick: () => ws.call("settings.reset", { scope: "sidebar" }) } });
  };

  const moveSection = (id: SectionId, delta: -1 | 1) => {
    if (!settings) return;
    const all = [...settings.sidebarSections];
    const i = all.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= all.length) return;
    void ws.updateSettings({ sidebarSections: arrayMove(all, i, j) });
  };

  const toggleSection = (id: SectionId) => {
    const next = collapsed.has(id) ? [...collapsed].filter((s) => s !== id) : [...collapsed, id];
    void ws.updateSettings({ collapsedSections: next as SectionId[] });
  };

  return (
    <aside
      aria-label="Sidebar"
      className={cn("group/sidebar relative flex h-full shrink-0 flex-col bg-surface text-fg-2", mobile ? "w-[min(86vw,320px)]" : "border-e border-line")}
      style={mobile ? undefined : { width }}
    >
      <SidebarHeader mobile={mobile} />
      <nav className="grid gap-px px-2 pb-2" aria-label="Main">
        <NavButton icon={<Search />} label="Search" shortcut="⌘K" onClick={() => ws.setSearchOpen(true)} />
        <NavLink href="/home" icon={<Home />} label="Home" />
        <NavLink href="/templates" icon={<LayoutTemplate />} label="Templates" />
        <NavButton icon={<Download />} label="Import" onClick={() => ws.setImportOpen(true)} />
      </nav>
      <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-4">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSectionsDragEnd}>
          <SortableContext items={shown} strategy={verticalListSortingStrategy}>
            {shown.map((id, i) => (
              <SidebarSection
                key={id}
                id={id}
                label={SECTION_LABEL[id]}
                collapsed={collapsed.has(id)}
                onToggle={() => toggleSection(id)}
                onMove={(d) => moveSection(id, d)}
                canMoveUp={i > 0}
                canMoveDown={i < shown.length - 1}
                action={
                  id === "pages" ? (
                    <IconButton label="New page" size="xs" onClick={() => ws.createPage()}>
                      <Plus className="size-3.5" />
                    </IconButton>
                  ) : id === "databases" ? (
                    <IconButton label="New database" size="xs" onClick={() => ws.createPage({ kind: "database" })}>
                      <Plus className="size-3.5" />
                    </IconButton>
                  ) : null
                }
              >
                {id === "favorites" && <FavoritesList />}
                {id === "recents" && <RecentsList />}
                {id === "pages" && <PagesSection />}
                {id === "databases" && <DatabasesList />}
              </SidebarSection>
            ))}
          </SortableContext>
        </DndContext>
      </div>
      <div className="grid gap-px border-t border-line px-2 py-2">
        <Popover
          side="right"
          align="end"
          trigger={
            <button type="button" className="flex h-7 items-center gap-2 rounded-md px-2 text-[13.5px] text-fg-2 hover:bg-hover hover:text-fg">
              <Trash2 className="size-4 text-fg-3" strokeWidth={1.75} />
              Trash
            </button>
          }
        >
          <TrashPanel compact />
        </Popover>
        <NavButton icon={<Settings />} label="Settings" onClick={() => ws.openSettings("account")} />
        <button
          type="button"
          onClick={() => ws.createPage()}
          className="mt-1 flex h-8 items-center gap-2 rounded-md px-2 text-[13.5px] font-medium text-fg hover:bg-hover"
        >
          <SquarePen className="size-4 text-fg-2" strokeWidth={1.75} />
          New page
          <span className="ms-auto text-[11px] font-normal text-fg-3 max-md:hidden">⌘⌥N</span>
        </button>
      </div>
      {!mobile && <ResizeHandle width={width} setWidth={setWidth} onCommit={(w) => ws.updateSettings({ sidebarWidth: w })} />}
    </aside>
  );
}

function ResizeHandle({ width, setWidth, onCommit }: { width: number; setWidth: (w: number) => void; onCommit: (w: number) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const latest = useRef(width);
  latest.current = width;
  const clamp = (w: number) => Math.max(200, Math.min(480, Math.round(w)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={200}
      aria-valuemax={480}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute -end-1 top-0 z-10 h-full w-2 cursor-col-resize after:absolute after:inset-y-0 after:start-[3px] after:w-0.5 after:bg-transparent after:transition-colors hover:after:bg-line-strong focus-visible:after:bg-accent"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const dx = (e.clientX - start.current.x) * (document.documentElement.dir === "rtl" ? -1 : 1);
        setWidth(clamp(start.current.w + dx));
      }}
      onPointerUp={() => {
        if (start.current) onCommit(latest.current);
        start.current = null;
      }}
      onDoubleClick={() => {
        setWidth(248);
        onCommit(248);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          const w = clamp(width + (e.key === "ArrowRight" ? 16 : -16));
          setWidth(w);
          onCommit(w);
        }
      }}
    />
  );
}

function SidebarHeader({ mobile }: { mobile?: boolean }) {
  const ws = useWorkspace();
  const name = ws.settings?.displayName || ws.identity.name;
  const workspaceName = ws.settings?.displayName || ws.identity.name !== "You" ? `${name}'s Max` : "My Max";
  return (
    <div className="flex items-center gap-1 px-2 pb-1 pt-2">
      <Menu>
        <MenuTrigger asChild>
          <button type="button" className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-start hover:bg-hover data-[state=open]:bg-hover">
            <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-fg text-canvas">
              <LogoMark className="size-4" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-fg">{workspaceName}</span>
            <ChevronDown className="size-3.5 text-fg-3" />
          </button>
        </MenuTrigger>
        <MenuContent className="w-64">
          <div className="flex items-center gap-2.5 px-2 py-2">
            <Avatar name={name} url={ws.identity.imageUrl} />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-medium text-fg">{name === "You" ? "Private workspace" : name}</p>
              <p className="truncate text-xs text-fg-3">{ws.identity.email ?? (CLOUD ? "" : "Private workspace on this device")}</p>
            </div>
          </div>
          <MenuSeparator />
          <MenuItem icon={<Settings />} onSelect={() => ws.openSettings("account")} shortcut="⌘,">
            Settings
          </MenuItem>
          <MenuSub>
            <MenuSubTrigger icon={ws.settings?.theme === "dark" ? <Moon /> : ws.settings?.theme === "light" ? <Sun /> : <Monitor />}>Appearance</MenuSubTrigger>
            <MenuSubContent>
              <MenuLabel>Theme</MenuLabel>
              {(["system", "light", "dark"] as const).map((t) => (
                <MenuItem key={t} icon={t === "dark" ? <Moon /> : t === "light" ? <Sun /> : <Monitor />} onSelect={() => ws.updateSettings({ theme: t })} hint={ws.settings?.theme === t ? "✓" : undefined}>
                  {t === "system" ? "Use system setting" : t === "light" ? "Light" : "Dark"}
                </MenuItem>
              ))}
            </MenuSubContent>
          </MenuSub>
          <MenuItem icon={<Download />} onSelect={() => ws.setImportOpen(true)}>
            Import
          </MenuItem>
          {ws.identity.signOut && (
            <>
              <MenuSeparator />
              <MenuItem icon={<LogOut />} onSelect={() => ws.identity.signOut?.()}>
                Sign out
              </MenuItem>
            </>
          )}
        </MenuContent>
      </Menu>
      {mobile ? (
        <IconButton label="Close sidebar" size="md" onClick={() => ws.setMobileNavOpen(false)}>
          <X className="size-4" />
        </IconButton>
      ) : (
        <IconButton label="Close sidebar" shortcut="⌘\" size="md" onClick={() => ws.setSidebarOpen(false)} className="opacity-0 transition-opacity group-hover/sidebar:opacity-100 focus-visible:opacity-100">
          <ChevronsLeft className="size-4 flip-rtl" />
        </IconButton>
      )}
    </div>
  );
}

export function Avatar({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  if (url) {
    return <img src={url} alt="" width={size} height={size} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "M";
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-fg-2" style={{ width: size, height: size }} aria-hidden>
      {initials}
    </span>
  );
}

function NavLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex h-7 items-center gap-2 rounded-md px-2 text-[13.5px] hover:bg-hover hover:text-fg [&>svg]:size-4 [&>svg]:text-fg-3 [&>svg]:[stroke-width:1.75]", active && "bg-hover font-medium text-fg")}>
      {icon}
      {label}
    </Link>
  );
}

function NavButton({ icon, label, shortcut, onClick }: { icon: ReactNode; label: string; shortcut?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-7 items-center gap-2 rounded-md px-2 text-[13.5px] hover:bg-hover hover:text-fg [&>svg]:size-4 [&>svg]:text-fg-3 [&>svg]:[stroke-width:1.75]">
      {icon}
      <span>{label}</span>
      {shortcut && <Kbd className="ms-auto max-md:hidden">{shortcut}</Kbd>}
    </button>
  );
}

function SidebarSection({
  id,
  label,
  collapsed,
  onToggle,
  onMove,
  canMoveUp,
  canMoveDown,
  action,
  children,
}: {
  id: SectionId;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  onMove: (d: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  action?: ReactNode;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <section ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("relative mt-3 first:mt-1", isDragging && "z-20 rounded-md bg-surface opacity-90 shadow-pop")} aria-label={label}>
      <div className="group/section relative flex h-7 items-center gap-0.5 rounded-md ps-1 pe-1 hover:bg-hover">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${label} section`}
          title="Drag to reorder sections · Alt+Shift+↑/↓"
          onKeyDown={(e) => {
            if (e.altKey && e.shiftKey && e.key === "ArrowUp" && canMoveUp) onMove(-1);
            else if (e.altKey && e.shiftKey && e.key === "ArrowDown" && canMoveDown) onMove(1);
            else listeners?.onKeyDown?.(e);
          }}
          className="absolute -start-3 grid h-5 w-3 cursor-grab place-items-center text-fg-3 opacity-0 transition-opacity focus-visible:opacity-100 active:cursor-grabbing group-hover/section:opacity-100 max-md:hidden"
        >
          <GripVertical className="size-3.5" />
        </button>
        <button type="button" onClick={onToggle} aria-expanded={!collapsed} className="flex flex-1 items-center gap-1 text-start text-xs font-medium text-fg-3 hover:text-fg-2">
          {label}
          <ChevronRight className={cn("size-3 opacity-0 transition-[transform,opacity] flip-rtl group-hover/section:opacity-100", !collapsed && "rotate-90")} />
        </button>
        <div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/section:opacity-100 max-md:opacity-100">{action}</div>
      </div>
      {!collapsed && <div className="mt-px">{children}</div>}
    </section>
  );
}

function PagesSection() {
  const ws = useWorkspace();
  if (ws.treeError) {
    return (
      <p className="px-2 py-1 text-xs leading-snug text-danger">
        Couldn&apos;t load your pages. {ws.treeError.message}
      </p>
    );
  }
  if (!ws.tree) {
    return (
      <div className="grid gap-2 px-2 py-1.5" aria-label="Loading pages">
        <Skeleton className="h-3.5 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    );
  }
  return (
    <PageTree
      pages={ws.tree}
      emptyHint={
        <button type="button" onClick={() => ws.createPage()} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2">
          <Plus className="size-3.5" /> Add your first page
        </button>
      }
    />
  );
}

function SimpleRow({ page, trailing }: { page: PageSummary; trailing?: ReactNode }) {
  const pathname = usePathname();
  const active = pathname === `/p/${page._id}`;
  return (
    <div className={cn("group/row flex h-7 items-center gap-1 rounded-md pe-1 ps-2 text-[13.5px] hover:bg-hover", active ? "bg-hover font-medium text-fg" : "text-fg-2")}>
      <Link href={`/p/${page._id}`} className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch" onMouseEnter={() => prefetchOp("pages.get", { id: page._id })}>
        <PageIcon icon={page.icon} kind={page.kind} />
        <span className="truncate">{pageTitle(page.title)}</span>
      </Link>
      {trailing}
    </div>
  );
}

function FavoritesList() {
  const ws = useWorkspace();
  const favs = useOp<{ pages: PageSummary[] }>("pages.favorites", {});
  const [local, setLocal] = useState<PageSummary[] | null>(null);
  const list = local ?? favs.data?.pages ?? [];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const onDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = list.findIndex((p) => p._id === active.id);
    const to = list.findIndex((p) => p._id === over.id);
    setLocal(arrayMove(list, from, to));
    try {
      await ws.call("pages.moveFavorite", { id: String(active.id), index: to });
    } catch (err) {
      notifyError(err, "Couldn't reorder favorites.");
    } finally {
      setLocal(null);
    }
  };
  const keyMove = async (id: string, delta: -1 | 1) => {
    const i = list.findIndex((p) => p._id === id);
    const j = i + delta;
    if (j < 0 || j >= list.length) return;
    setLocal(arrayMove(list, i, j));
    try {
      await ws.call("pages.moveFavorite", { id, index: j });
    } finally {
      setLocal(null);
    }
  };
  if (favs.isLoading) return <Skeleton className="mx-2 my-1.5 h-3.5 w-2/3" />;
  if (!list.length) return <p className="px-2 py-1 text-xs leading-snug text-fg-3">Star a page from its ⋯ menu to keep it here.</p>;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={list.map((p) => p._id)} strategy={verticalListSortingStrategy}>
        <ul className="grid">
          {list.map((p) => (
            <SortableFavorite key={p._id} page={p} onKeyMove={keyMove} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function SortableFavorite({ page, onKeyMove }: { page: PageSummary; onKeyMove: (id: string, d: -1 | 1) => void }) {
  const ws = useWorkspace();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: page._id });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-80")}
      onKeyDown={(e) => {
        if (e.altKey && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          onKeyMove(page._id, e.key === "ArrowUp" ? -1 : 1);
        }
      }}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        tabIndex={-1}
        aria-label={`Drag to reorder ${pageTitle(page.title)}`}
        className="peer absolute -start-3 top-1/2 z-10 grid h-5 w-3 -translate-y-1/2 cursor-grab place-items-center text-fg-3 opacity-0 hover:opacity-100 focus-visible:opacity-100 max-md:hidden [li:hover>&]:opacity-100"
      >
        <GripVertical className="size-3.5" />
      </button>
      <SimpleRow
        page={page}
        trailing={
          <PageMenu
            page={page}
            trigger={
              <IconButton label="Page actions" size="xs" className="opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100 max-md:opacity-100">
                <MoreHorizontal className="size-3.5" />
              </IconButton>
            }
          />
        }
      />
      <span className="sr-only">{ws.byId.get(page._id) ? "" : "Database row"}</span>
    </li>
  );
}

function RecentsList() {
  const recents = useOp<{ pages: PageSummary[] }>("pages.recents", { limit: 6 });
  const ws = useWorkspace();
  if (recents.isLoading) return <Skeleton className="mx-2 my-1.5 h-3.5 w-1/2" />;
  const list = recents.data?.pages ?? [];
  if (!list.length) return <p className="px-2 py-1 text-xs text-fg-3">Pages you open show up here.</p>;
  return (
    <ul className="grid">
      {list.map((p) => (
        <li key={p._id}>
          <SimpleRow
            page={p}
            trailing={
              <IconButton
                label="Remove from recents"
                size="xs"
                className="opacity-0 group-hover/row:opacity-100 max-md:opacity-100"
                onClick={() => ws.call("pages.forgetRecent", { id: p._id }).catch((e) => notifyError(e))}
              >
                <X className="size-3" />
              </IconButton>
            }
          />
        </li>
      ))}
    </ul>
  );
}

function DatabasesList() {
  const ws = useWorkspace();
  const dbs = useMemo(() => (ws.tree ?? []).filter((p) => p.kind === "database").sort((a, b) => pageTitle(a.title).localeCompare(pageTitle(b.title))), [ws.tree]);
  if (!ws.tree) return null;
  if (!dbs.length)
    return (
      <button type="button" onClick={() => ws.createPage({ kind: "database" })} className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2">
        <Database className="size-3.5" /> Create a database
      </button>
    );
  return (
    <ul className="grid">
      {dbs.map((p) => (
        <li key={p._id}>
          <SimpleRow page={p} />
        </li>
      ))}
    </ul>
  );
}

export { Star, Clock };
export function useSidebarRouter() {
  const router = useRouter();
  return useCallback((href: string) => router.push(href), [router]);
}
