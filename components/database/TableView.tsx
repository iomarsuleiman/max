"use client";

import { useMemo, useRef, useState } from "react";
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, horizontalListSortingStrategy, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowUpRight, Check, GripVertical, Maximize2, Plus, Trash2, Copy } from "lucide-react";
import { IconButton, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, cn } from "@/components/ui";
import type { DatabaseView, PageRow, PropertyDef } from "@/lib/domain/types";
import type { RecordView } from "@/lib/client/types";
import { useWorkspace } from "@/components/workspace/context";
import { EditableValue } from "./cells";
import { PageIcon } from "@/components/workspace/PageIcon";
import { PropIcon } from "./meta";
import { AddProperty, PropertyMenu } from "./PropertyMenu";

/** dnd-kit's screen-reader helpers live in <body>, so tables keep a valid row/cell structure. */
const dndA11y = typeof document !== "undefined" ? { container: document.body } : undefined;

const DEFAULT_WIDTH: Partial<Record<PropertyDef["type"], number>> = { title: 280, checkbox: 100, number: 120, date: 160, created_time: 180, updated_time: 180 };

export function TableView({ database, view, properties, records, readOnly, onUpdate, onCreate, onDelete, onUpdateView, canReorder, onOpenRecord }: {
  onOpenRecord: (id: string, event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => void;
  database: PageRow;
  view: DatabaseView;
  properties: PropertyDef[];
  records: RecordView[];
  readOnly: boolean;
  onUpdate: (id: string, values: Record<string, unknown>) => void;
  onCreate: (values?: Record<string, unknown>, opts?: { index?: number }) => Promise<string | null>;
  onDelete: (ids: string[]) => void;
  onUpdateView: (patch: Partial<DatabaseView>) => void;
  canReorder: boolean;
}) {
  const ws = useWorkspace();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const rows = useMemo(() => {
    if (!localOrder) return records;
    const byId = new Map(records.map((r) => [r._id, r]));
    return localOrder.map((id) => byId.get(id)).filter((r): r is RecordView => !!r);
  }, [records, localOrder]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const widthOf = (p: PropertyDef) => widths[p.id] ?? view.columnWidths[p.id] ?? DEFAULT_WIDTH[p.type] ?? 180;
  const total = properties.reduce((t, p) => t + widthOf(p), 0) + 48 + 36;

  const onRowDragEnd = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = rows.map((r) => r._id);
    const to = ids.indexOf(String(over.id));
    setLocalOrder(arrayMove(ids, ids.indexOf(String(active.id)), to));
    try {
      await ws.call("records.move", { id: String(active.id), index: to });
    } finally {
      setLocalOrder(null);
    }
  };
  const onColDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = properties.map((p) => p.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    const hidden = (view.propertyOrder ?? []).filter((id) => !next.includes(id));
    onUpdateView({ propertyOrder: [...next, ...hidden] });
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r._id));

  return (
    <div className="relative">
      {selected.size > 0 && !readOnly && (
        <div className="sticky top-0 z-20 mb-1 flex items-center gap-2 rounded-md bg-overlay px-3 py-1.5 text-[13px] shadow-pop">
          <span className="font-medium text-accent-text">{selected.size} selected</span>
          <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded px-2 hover:bg-hover" onClick={() => (onDelete([...selected]), setSelected(new Set()))}>
            <Trash2 className="size-3.5" /> Delete
          </button>
          <button type="button" className="ms-auto h-7 rounded px-2 text-fg-2 hover:bg-hover" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      <div className="scroll-quiet overflow-x-auto px-4 sm:px-12">
        <div role="table" aria-label={`${database.title || "Database"} table`} aria-rowcount={rows.length + 1} style={{ minWidth: total }} className="text-[13.5px]">
          <div role="row" className="flex h-8 border-y border-line text-fg-2">
            <div role="columnheader" className="w-12 shrink-0"><span className="sr-only">Select and reorder</span></div>
            <DndContext accessibility={dndA11y} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onColDragEnd}>
              <SortableContext items={properties.map((p) => p.id)} strategy={horizontalListSortingStrategy}>
                {properties.map((p) => (
                  <HeaderCell
                    key={p.id}
                    prop={p}
                    width={widthOf(p)}
                    database={database}
                    view={view}
                    properties={properties}
                    readOnly={readOnly}
                    onResize={(w) => setWidths((s) => ({ ...s, [p.id]: w }))}
                    onResizeEnd={(w) => onUpdateView({ columnWidths: { ...view.columnWidths, [p.id]: w } })}
                    onSort={(direction) => onUpdateView({ sorts: [{ propertyId: p.id, direction }] })}
                    onHide={() => onUpdateView({ hiddenPropertyIds: [...view.hiddenPropertyIds, p.id] })}
                  />
                ))}
              </SortableContext>
            </DndContext>
            {!readOnly && (
              <div role="columnheader" className="flex w-9 shrink-0 border-s border-line">
                <AddProperty
                  databaseId={database._id}
                  trigger={
                    <button type="button" aria-label="Add a property" className="grid w-full place-items-center text-fg-3 hover:bg-hover">
                      <Plus className="size-4" />
                    </button>
                  }
                />
              </div>
            )}
          </div>
          <DndContext accessibility={dndA11y} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onRowDragEnd}>
            <SortableContext items={rows.map((r) => r._id)} strategy={verticalListSortingStrategy}>
              {rows.map((r) => (
                <TableRow
                  key={r._id}
                  record={r}
                  properties={properties}
                  widthOf={widthOf}
                  databaseId={database._id}
                  readOnly={readOnly}
                  canReorder={canReorder && !readOnly}
                  selected={selected.has(r._id)}
                  onSelect={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(r._id); else n.delete(r._id); return n; })}
                  onUpdate={onUpdate}
                  onOpen={(e) => onOpenRecord(r._id, e)}
                  onDelete={() => onDelete([r._id])}
                  onDuplicate={() => ws.duplicatePage(r._id)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
        <div style={{ minWidth: total }}>
          {!readOnly && (
            <button
              type="button"
              onClick={() => onCreate()}
              className="flex h-8 w-full items-center gap-2 border-b border-line ps-14 text-start text-[13.5px] text-fg-3 hover:bg-hover hover:text-fg-2"
            >
              <Plus className="size-3.5" /> New row
            </button>
          )}
          <div className="flex h-8 items-center ps-14 text-[12px] text-fg-3">
            {rows.length > 0 && !readOnly && (
              <label className="me-3 inline-flex items-center gap-1.5">
                <input type="checkbox" checked={allSelected} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r._id)) : new Set())} className="accent-[var(--accent)]" aria-label="Select all rows" />
                Select all
              </label>
            )}
            Count <span className="ms-1 tabular-nums text-fg-2">{rows.length}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeaderCell({ prop, width, database, view, properties, readOnly, onResize, onResizeEnd, onSort, onHide }: {
  prop: PropertyDef;
  width: number;
  database: PageRow;
  view: DatabaseView;
  properties: PropertyDef[];
  readOnly: boolean;
  onResize: (w: number) => void;
  onResizeEnd: (w: number) => void;
  onSort: (d: "asc" | "desc") => void;
  onHide: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: prop.id, disabled: readOnly || prop.type === "title" });
  const start = useRef<{ x: number; w: number } | null>(null);
  const last = useRef(width);
  const label = (
    <button type="button" className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-start hover:bg-hover" {...(readOnly ? {} : { ...attributes, ...listeners })} aria-label={`${prop.name} column options`}>
      <PropIcon type={prop.type} className="size-3.5 shrink-0 text-fg-3" />
      <span className="truncate">{prop.name}</span>
    </button>
  );
  return (
    <div ref={setNodeRef} role="columnheader" style={{ width, transform: CSS.Translate.toString(transform), transition }} className={cn("relative flex shrink-0 border-s border-line first-of-type:border-s-0", isDragging && "z-10 bg-overlay opacity-80 shadow-pop")}>
      {readOnly ? label : (
        <PropertyMenu databaseId={database._id} prop={prop} properties={properties} view={view} trigger={label} onSort={onSort} onHide={onHide} />
      )}
      {!readOnly && (
        <div
          role="separator"
          aria-label={`Resize ${prop.name}`}
          className="absolute -end-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/30"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            start.current = { x: e.clientX, w: width };
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const w = Math.max(80, Math.min(800, start.current.w + (e.clientX - start.current.x) * (document.documentElement.dir === "rtl" ? -1 : 1)));
            last.current = w;
            onResize(w);
          }}
          onPointerUp={() => {
            if (start.current) onResizeEnd(Math.round(last.current));
            start.current = null;
          }}
        />
      )}
    </div>
  );
}

function TableRow({ record, properties, widthOf, databaseId, readOnly, canReorder, selected, onSelect, onUpdate, onOpen, onDelete, onDuplicate }: {
  record: RecordView;
  properties: PropertyDef[];
  widthOf: (p: PropertyDef) => number;
  databaseId: string;
  readOnly: boolean;
  canReorder: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onUpdate: (id: string, values: Record<string, unknown>) => void;
  onOpen: (e?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: record._id, disabled: !canReorder });
  return (
    <div ref={setNodeRef} role="row" style={{ transform: CSS.Translate.toString(transform), transition }} className={cn("group/row relative flex min-h-8 border-b border-line", selected && "bg-accent-soft", isDragging && "z-10 bg-overlay shadow-pop")}>
      <div role="cell" className="flex w-12 shrink-0 items-center justify-end gap-2 pe-1 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 has-[:checked]:opacity-100 max-md:opacity-100">
        {!readOnly && (
          <label className="relative grid size-6 shrink-0 cursor-pointer place-items-center">
            <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)} aria-label={`Select ${record.title || "row"}`} className="peer absolute inset-0 size-6 cursor-pointer opacity-0" />
            <span aria-hidden className="grid size-3.5 place-items-center rounded-[3px] shadow-[inset_0_0_0_1.5px_var(--line-strong)] peer-checked:bg-accent peer-checked:shadow-none peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-[var(--focus)]">
              {selected && <Check className="size-2.5 text-accent-fg" strokeWidth={3.5} />}
            </span>
          </label>
        )}
        {canReorder && (
          <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label="Drag to reorder row" className="grid h-6 w-4 cursor-grab place-items-center text-fg-3 active:cursor-grabbing max-md:hidden">
            <GripVertical className="size-3.5" />
          </button>
        )}
      </div>
      {properties.map((p) => (
        <div key={p.id} role="cell" style={{ width: widthOf(p) }} className="relative flex shrink-0 items-stretch border-s border-line first-of-type:border-s-0 [&:nth-child(2)]:border-s-0">
          {p.type === "title" ? (
            <div className="group/title flex min-w-0 flex-1 items-center">
              {record.icon && <PageIcon icon={record.icon} className="ms-2" />}
              <EditableValue prop={p} value={record.title} record={record} databaseId={databaseId} readOnly={readOnly} onSave={(v) => onUpdate(record._id, { [p.id]: v })} placeholder="Untitled" className="font-medium" />
              <button type="button" onClick={(e) => onOpen(e)} aria-label={`Open ${record.title || "row"}`} title="Open (⌘-click for full page)" className="absolute end-1 top-1/2 inline-flex h-6 -translate-y-1/2 items-center gap-1 rounded bg-overlay px-1.5 text-[11.5px] font-medium text-fg-2 opacity-0 shadow-[0_0_0_1px_var(--line-strong)] hover:bg-surface-2 group-hover/row:opacity-100 focus-visible:opacity-100 max-md:opacity-100">
                <Maximize2 className="size-3" /> Open
              </button>
            </div>
          ) : (
            <EditableValue prop={p} value={record.values[p.id]} record={record} databaseId={databaseId} readOnly={readOnly} onSave={(v) => onUpdate(record._id, { [p.id]: v })} />
          )}
        </div>
      ))}
      {!readOnly && (
        <div role="cell" className="contents">
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Row actions" size="xs" className="absolute -end-7 top-1 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100">
              <span className="text-xs">⋯</span>
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end">
            <MenuItem icon={<ArrowUpRight />} onSelect={() => onOpen({ shiftKey: true })}>Open as full page</MenuItem>
            <MenuItem icon={<Copy />} onSelect={onDuplicate}>Duplicate</MenuItem>
            <MenuSeparator />
            <MenuItem icon={<Trash2 />} danger onSelect={onDelete}>Delete</MenuItem>
          </MenuContent>
        </Menu>
        </div>
      )}
    </div>
  );
}
