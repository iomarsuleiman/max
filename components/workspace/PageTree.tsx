"use client";

import { pageHref, pageIdFromPath } from "@/lib/pageUrl";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, GripVertical, MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { IconButton, cn } from "@/components/ui";
import { prefetchOp } from "@/lib/client/data";
import { applyMove, childrenMap, flatten, projectDrop, removeDescendants, type FlatItem } from "@/lib/client/tree";
import { pageTitle } from "@/lib/client/format";
import type { PageSummary } from "@/lib/client/types";
import { PageIcon } from "./PageIcon";
import { PageMenu } from "./PageMenu";
import { notifyError, useWorkspace } from "./context";

const INDENT = 14;

type Move = { id: string; parentId: string | null; index: number };

export function PageTree({ pages, emptyHint }: { pages: PageSummary[]; emptyHint?: React.ReactNode }) {
  const ws = useWorkspace();
  const [pending, setPending] = useState<Move | null>(null);
  const view = useMemo(() => applyMove(pages, pending), [pages, pending]);
  const map = useMemo(() => childrenMap(view), [view]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);
  const [renaming, setRenaming] = useState<string | null>(null);
  const dir = typeof document !== "undefined" && document.documentElement.dir === "rtl" ? "rtl" : "ltr";

  const flat = useMemo(() => {
    const all = flatten(map, ws.expanded);
    return activeId ? removeDescendants(all, activeId) : all;
  }, [map, ws.expanded, activeId]);
  const ids = useMemo(() => flat.map((i) => i.id), [flat]);
  const projection = activeId && overId ? projectDrop(flat, activeId, overId, offsetX, INDENT, dir) : null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const commitMove = useCallback(
    async (move: Move, label = "Moved") => {
      setPending(move);
      try {
        await ws.call("pages.move", move);
        if (move.parentId) ws.setExpanded(move.parentId, true);
        toast.success(label, { duration: 1600 });
      } catch (err) {
        notifyError(err, "Couldn't move the page. It's back where it was.");
      } finally {
        setPending(null);
      }
    },
    [ws],
  );

  const reset = () => {
    setActiveId(null);
    setOverId(null);
    setOffsetX(0);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const proj = over && activeId ? projectDrop(flat, String(active.id), String(over.id), offsetX, INDENT, dir) : null;
    reset();
    if (!proj) return;
    const item = flat.find((i) => i.id === active.id);
    if (!item) return;
    const siblings = (map.get(item.parentId) ?? []).map((p) => p._id);
    if (proj.parentId === item.parentId && siblings.indexOf(item.id) === proj.index) return;
    void commitMove({ id: item.id, ...proj });
  };

  // Keyboard reordering on a focused row: Alt+Shift+Arrows.
  const keyMove = useCallback(
    (item: FlatItem, dirKey: "up" | "down" | "indent" | "outdent") => {
      const siblings = (map.get(item.parentId) ?? []).filter((p) => p._id !== item.id);
      const index = (map.get(item.parentId) ?? []).findIndex((p) => p._id === item.id);
      if (dirKey === "up" && index > 0) return commitMove({ id: item.id, parentId: item.parentId, index: index - 1 }, "Moved up");
      if (dirKey === "down" && index < siblings.length) return commitMove({ id: item.id, parentId: item.parentId, index: index + 1 }, "Moved down");
      if (dirKey === "indent" && index > 0) {
        const newParent = (map.get(item.parentId) ?? [])[index - 1];
        if (newParent.kind === "database") return toast.error("Pages can't be nested inside a database.");
        return commitMove({ id: item.id, parentId: newParent._id, index: map.get(newParent._id)?.length ?? 0 }, `Nested under “${pageTitle(newParent.title)}”`);
      }
      if (dirKey === "outdent" && item.parentId) {
        const parent = view.find((p) => p._id === item.parentId);
        const grand = parent?.parentId ?? null;
        const parentIndex = (map.get(grand) ?? []).findIndex((p) => p._id === item.parentId);
        return commitMove({ id: item.id, parentId: grand, index: parentIndex + 1 }, "Moved out one level");
      }
    },
    [commitMove, map, view],
  );

  if (!pages.length) return <>{emptyHint}</>;

  const activeItem = activeId ? flat.find((i) => i.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={({ active }: DragStartEvent) => {
        setActiveId(String(active.id));
        setOverId(String(active.id));
        document.body.style.setProperty("cursor", "grabbing");
      }}
      onDragMove={({ delta }: DragMoveEvent) => setOffsetX(delta.x)}
      onDragOver={({ over }: DragOverEvent) => setOverId(over ? String(over.id) : null)}
      onDragEnd={(e) => {
        document.body.style.removeProperty("cursor");
        onDragEnd(e);
      }}
      onDragCancel={() => {
        document.body.style.removeProperty("cursor");
        reset();
      }}
      accessibility={{
        screenReaderInstructions: { draggable: "To reorder with the keyboard, focus a page and press Alt+Shift with the arrow keys." },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${pageTitle(flat.find((i) => i.id === active.id)?.page.title)}.`,
          onDragOver: () => (projection ? `Will be placed at level ${projection.depth + 1}.` : ""),
          onDragEnd: () => "Dropped.",
          onDragCancel: () => "Move cancelled.",
        },
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul role="tree" aria-label="Pages" className="grid">
          {flat.map((item) => (
            <TreeRow
              key={item.id}
              item={item}
              depth={item.id === activeId && projection ? projection.depth : item.depth}
              ghost={item.id === activeId}
              renaming={renaming === item.id}
              onRename={setRenaming}
              onKeyMove={keyMove}
            />
          ))}
        </ul>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activeItem ? (
          <div className="flex h-7 items-center gap-1.5 rounded-md bg-overlay px-2 text-[13.5px] font-medium text-fg shadow-pop">
            <PageIcon icon={activeItem.page.icon} kind={activeItem.page.kind} />
            <span className="truncate">{pageTitle(activeItem.page.title)}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

const TreeRow = memo(function TreeRow({
  item,
  depth,
  ghost,
  renaming,
  onRename,
  onKeyMove,
}: {
  item: FlatItem;
  depth: number;
  ghost: boolean;
  renaming: boolean;
  onRename: (id: string | null) => void;
  onKeyMove: (item: FlatItem, dir: "up" | "down" | "indent" | "outdent") => void;
}) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const active = pageIdFromPath(pathname) === item.id;
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition, paddingInlineStart: 4 + depth * INDENT };
  const title = pageTitle(item.page.title);
  const rowRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset.rowLink) return;
    if (e.altKey && e.shiftKey) {
      const map = { ArrowUp: "up", ArrowDown: "down", ArrowRight: "indent", ArrowLeft: "outdent" } as const;
      const d = map[e.key as keyof typeof map];
      if (d) {
        e.preventDefault();
        onKeyMove(item, document.documentElement.dir === "rtl" && (d === "indent" || d === "outdent") ? (d === "indent" ? "outdent" : "indent") : d);
        return;
      }
    }
    if (e.key === "ArrowRight" && item.hasChildren && !item.expanded) ws.setExpanded(item.id, true);
    else if (e.key === "ArrowLeft" && item.expanded) ws.setExpanded(item.id, false);
    else if (e.key === "F2" || ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "r")) {
      e.preventDefault();
      onRename(item.id);
    } else if (e.key === "Delete" && !renaming) {
      e.preventDefault();
      void ws.archivePage(item.id);
    }
  };

  return (
    <li
      ref={(el) => {
        setNodeRef(el);
        rowRef.current = el;
      }}
      style={style}
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={item.hasChildren ? item.expanded : undefined}
      aria-selected={active}
      className={cn(
        "group/row relative flex h-7 items-center gap-0.5 rounded-md pe-1 text-[13.5px] text-fg-2 transition-colors duration-75 hover:bg-hover",
        active && "bg-hover font-medium text-fg",
        (ghost || isDragging) && "z-10 bg-accent-soft opacity-80 ring-1 ring-accent/40",
      )}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to move ${title}`}
        title="Drag to move · Alt+Shift+arrows to move with the keyboard"
        className="absolute -start-3 top-1/2 grid h-5 w-3 -translate-y-1/2 cursor-grab place-items-center rounded-sm text-fg-3 opacity-0 transition-opacity hover:text-fg-2 focus-visible:opacity-100 active:cursor-grabbing group-hover/row:opacity-100 max-md:hidden"
        tabIndex={-1}
      >
        <GripVertical className="size-3.5" />
      </button>
      <button
        type="button"
        aria-label={item.expanded ? `Collapse ${title}` : `Expand ${title}`}
        onClick={() => ws.setExpanded(item.id, !item.expanded)}
        className={cn("grid size-5 shrink-0 place-items-center rounded-[4px] text-fg-3 hover:bg-hover hover:text-fg-2", !item.hasChildren && item.page.kind !== "page" && "invisible")}
        tabIndex={-1}
      >
        <ChevronRight className={cn("size-3.5 transition-transform duration-100 flip-rtl", item.expanded && "rotate-90", !item.hasChildren && "opacity-40")} />
      </button>
      {renaming ? (
        <RenameInput
          initial={item.page.title}
          onDone={async (value) => {
            onRename(null);
            if (value !== item.page.title) {
              try {
                await ws.call("pages.update", { id: item.id, title: value });
              } catch (err) {
                notifyError(err, "Couldn't rename the page.");
              }
            }
          }}
        />
      ) : (
        <Link
          href={pageHref(item.id, item.page.title)}
          data-row-link="true"
          className="flex min-w-0 flex-1 items-center gap-1.5 self-stretch rounded-[4px] outline-offset-[-2px]"
          onMouseEnter={() => {
            prefetchOp("pages.get", { id: item.id });
            router.prefetch(pageHref(item.id, item.page.title));
          }}
          onFocus={() => prefetchOp("pages.get", { id: item.id })}
          onDoubleClick={(e) => {
            e.preventDefault();
            onRename(item.id);
          }}
          onKeyDown={onKeyDown}
        >
          <PageIcon icon={item.page.icon} kind={item.page.kind} />
          <span className="truncate" title={title}>
            {title}
          </span>
        </Link>
      )}
      <div className="flex items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover/row:opacity-100 has-[[data-state=open]]:opacity-100 max-md:opacity-100">
        <PageMenu
          page={item.page}
          onRename={() => onRename(item.id)}
          onMove={(d) => onKeyMove(item, d)}
          trigger={
            <IconButton label="Page actions" size="xs">
              <MoreHorizontal className="size-3.5" />
            </IconButton>
          }
        />
        {item.page.kind === "page" && (
          <IconButton label="Add a page inside" size="xs" onClick={() => ws.createPage({ parentId: item.id })}>
            <Plus className="size-3.5" />
          </IconButton>
        )}
      </div>
    </li>
  );
});

function RenameInput({ initial, onDone }: { initial: string; onDone: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onDone(v.trim());
  };
  return (
    <input
      autoFocus
      aria-label="Page name"
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(value);
        if (e.key === "Escape") finish(initial);
      }}
      className="h-6 min-w-0 flex-1 rounded-[4px] bg-overlay px-1.5 text-[13.5px] text-fg shadow-[0_0_0_1px_var(--accent)] outline-none"
    />
  );
}
