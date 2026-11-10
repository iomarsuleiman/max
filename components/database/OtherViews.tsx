"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { Button, IconButton, Select, cn } from "@/components/ui";
import type { DatabaseView, PageRow, PropertyDef, SelectOption } from "@/lib/domain/types";
import type { RecordView } from "@/lib/client/types";
import { pageTitle } from "@/lib/client/format";
import { CoverView } from "@/components/page/CoverView";
import { PageIcon } from "@/components/workspace/PageIcon";
import { ValueView } from "./cells";
import { Tag } from "./meta";

interface ViewProps {
  database: PageRow;
  view: DatabaseView;
  properties: PropertyDef[];
  records: RecordView[];
  readOnly: boolean;
  onUpdate: (id: string, values: Record<string, unknown>) => void;
  onCreate: (values?: Record<string, unknown>) => Promise<string | null>;
  onUpdateView: (patch: Partial<DatabaseView>) => void;
  onOpenRecord: (id: string, event?: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }) => void;
}

/** Plain clicks open the row per the view's setting; ⌘/Ctrl-click and middle-click keep the link's default. */
const openHandler = (open: ViewProps["onOpenRecord"], id: string) => (e: React.MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.button !== 0) return;
  e.preventDefault();
  open(id, e);
};

function CardProps({ properties, record }: { properties: PropertyDef[]; record: RecordView }) {
  const shown = properties.filter((p) => p.type !== "title" && record.values[p.id] !== null && record.values[p.id] !== undefined && record.values[p.id] !== "" && !(Array.isArray(record.values[p.id]) && !(record.values[p.id] as unknown[]).length));
  if (!shown.length) return null;
  return (
    <div className="mt-1.5 grid gap-1 text-[12.5px] text-fg-2">
      {shown.slice(0, 5).map((p) => (
        <div key={p.id} className="flex min-w-0 items-center" title={p.name}>
          <ValueView prop={p} value={record.values[p.id]} record={record} compact />
        </div>
      ))}
    </div>
  );
}

/* ── Board ───────────────────────────────────────────────────────────────── */

export function BoardView({ onOpenRecord, database, view, properties, records, readOnly, onUpdate, onCreate, onUpdateView }: ViewProps) {
  const router = useRouter();
  const groupable = properties.filter((p) => p.type === "status" || p.type === "select");
  const group = properties.find((p) => p.id === view.groupByPropertyId) ?? groupable[0];
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const [moving, setMoving] = useState<Record<string, string | null>>({});
  if (!group) {
    return (
      <div className="px-4 py-10 text-center text-[13.5px] text-fg-2 sm:px-12">
        A board groups rows by a Status or Select property. Add one with the + in table view, then come back.
      </div>
    );
  }
  const columns: (SelectOption | null)[] = [...(group.options ?? []), null];
  const valueOf = (r: RecordView) => (r._id in moving ? moving[r._id] : (r.values[group.id] as string | null) ?? null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return;
    const target = over.id === "__none" ? null : String(over.id);
    const id = String(active.id);
    const rec = records.find((r) => r._id === id);
    if (!rec || valueOf(rec) === target) return;
    setMoving((m) => ({ ...m, [id]: target }));
    void Promise.resolve(onUpdate(id, { [group.id]: target })).finally(() => setMoving((m) => { const n = { ...m }; delete n[id]; return n; }));
  };
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex items-center gap-2 px-4 pb-2 text-[12.5px] text-fg-3 sm:px-12">
        Grouped by
        <Select label="Group by" size="sm" variant="filled" value={group.id} disabled={readOnly} onChange={(id) => onUpdateView({ groupByPropertyId: id })} options={groupable.map((p) => ({ value: p.id, label: p.name }))} />
      </div>
      <div className="scroll-quiet flex gap-3 overflow-x-auto px-4 pb-4 sm:px-12">
        {columns.map((opt) => {
          const items = records.filter((r) => valueOf(r) === (opt?.id ?? null));
          if (!opt && !items.length) return null;
          return (
            <BoardColumn key={opt?.id ?? "__none"} id={opt?.id ?? "__none"}>
              <div className="flex h-8 items-center gap-2 px-1">
                {opt ? <Tag name={opt.name} color={opt.color} /> : <span className="text-[13px] text-fg-3">No {group.name}</span>}
                <span className="text-[12px] tabular-nums text-fg-3">{items.length}</span>
              </div>
              <div className="grid gap-1.5">
                {items.map((r) => (
                  <BoardCard key={r._id} id={r._id} disabled={readOnly}>
                    <Link href={`/p/${r._id}`} className="block rounded-lg bg-overlay p-2.5 shadow-[0_0_0_1px_var(--line),0_1px_2px_oklch(0_0_0/0.04)] hover:bg-surface-2" onClick={openHandler(onOpenRecord, r._id)}>
                      <div className="flex items-start gap-1.5 text-[13.5px] font-medium text-fg">
                        {r.icon && <PageIcon icon={r.icon} />}
                        <span className="min-w-0 break-words">{pageTitle(r.title)}</span>
                      </div>
                      <CardProps properties={properties.filter((p) => p.id !== group.id)} record={r} />
                    </Link>
                  </BoardCard>
                ))}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={async () => {
                      const id = await onCreate(opt ? { [group.id]: opt.id } : {});
                      if (id) onOpenRecord(id);
                    }}
                    className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2"
                  >
                    <Plus className="size-3.5" /> New
                  </button>
                )}
              </div>
            </BoardColumn>
          );
        })}
      </div>
      <span className="sr-only">{database.title}</span>
    </DndContext>
  );
}

function BoardColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("w-[260px] shrink-0 rounded-lg p-1.5 transition-colors", isOver ? "bg-accent-soft" : "bg-transparent")}>
      {children}
    </div>
  );
}

function BoardCard({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined} className={cn("touch-manipulation", isDragging && "relative z-30 rotate-1 opacity-90 shadow-pop")}>
      {children}
    </div>
  );
}

/* ── List ────────────────────────────────────────────────────────────────── */

export function ListView({ onOpenRecord, properties, records, readOnly, onCreate }: ViewProps) {
  const router = useRouter();
  return (
    <div className="px-4 sm:px-12">
      <ul className="grid border-t border-line">
        {records.map((r) => (
          <li key={r._id} className="border-b border-line">
            <Link href={`/p/${r._id}`} onClick={openHandler(onOpenRecord, r._id)} className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-1 py-1.5 hover:bg-hover">
              <span className="flex min-w-0 flex-1 items-center gap-2 text-[14px] font-medium text-fg">
                <PageIcon icon={r.icon} />
                <span className="truncate">{pageTitle(r.title)}</span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-[12.5px] text-fg-2">
                {properties.filter((p) => p.type !== "title").slice(0, 4).map((p) => (
                  <span key={p.id} title={p.name}>
                    <ValueView prop={p} value={r.values[p.id]} record={r} compact />
                  </span>
                ))}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {!readOnly && (
        <button type="button" onClick={async () => { const id = await onCreate(); if (id) onOpenRecord(id); }} className="mt-1 flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-3 hover:bg-hover hover:text-fg-2">
          <Plus className="size-3.5" /> New
        </button>
      )}
    </div>
  );
}

/* ── Gallery ─────────────────────────────────────────────────────────────── */

export function GalleryView({ onOpenRecord, properties, records, readOnly, onCreate, view }: ViewProps) {
  const router = useRouter();
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3 px-4 sm:px-12">
      {records.map((r) => (
        <Link key={r._id} href={`/p/${r._id}`} onClick={openHandler(onOpenRecord, r._id)} className="overflow-hidden rounded-lg bg-overlay shadow-[0_0_0_1px_var(--line),0_1px_2px_oklch(0_0_0/0.04)] transition-colors hover:bg-surface-2">
          {view.cardPreview !== "none" && <CoverView cover={r.cover} position={r.coverPosition} className="h-28 w-full" />}
          <div className="p-2.5">
            <div className="flex items-center gap-1.5 text-[13.5px] font-medium text-fg">
              {r.icon && <PageIcon icon={r.icon} />}
              <span className="truncate">{pageTitle(r.title)}</span>
            </div>
            <CardProps properties={properties} record={r} />
          </div>
        </Link>
      ))}
      {!readOnly && (
        <button type="button" onClick={async () => { const id = await onCreate(); if (id) onOpenRecord(id); }} className="grid min-h-40 place-items-center rounded-lg text-[13px] text-fg-3 shadow-[0_0_0_1px_var(--line)] hover:bg-hover hover:text-fg-2">
          <span className="inline-flex items-center gap-1.5"><Plus className="size-4" /> New</span>
        </button>
      )}
    </div>
  );
}

/* ── Calendar ────────────────────────────────────────────────────────────── */

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function CalendarView({ onOpenRecord, properties, records, readOnly, onCreate, onUpdate, view, onUpdateView }: ViewProps) {
  const router = useRouter();
  const dateProps = properties.filter((p) => p.type === "date");
  const dateProp = properties.find((p) => p.id === view.datePropertyId) ?? dateProps[0];
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const days = useMemo(() => {
    const start = new Date(month);
    start.setDate(1 - ((start.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  if (!dateProp) {
    return <div className="px-4 py-10 text-center text-[13.5px] text-fg-2 sm:px-12">A calendar places rows by a Date property. Add one in table view, then come back.</div>;
  }
  const byDay = new Map<string, RecordView[]>();
  for (const r of records) {
    const v = r.values[dateProp.id];
    if (typeof v === "string") {
      const key = v.slice(0, 10);
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(r);
    }
  }
  const undated = records.filter((r) => typeof r.values[dateProp.id] !== "string").length;
  const today = iso(new Date());
  return (
    <DndContext
      sensors={sensors}
      onDragEnd={({ active, over }) => {
        if (over && !readOnly) {
          const r = records.find((x) => x._id === active.id);
          const old = r?.values[dateProp.id];
          const time = typeof old === "string" && old.length > 10 ? old.slice(10) : "";
          if (r && (typeof old !== "string" || old.slice(0, 10) !== over.id)) onUpdate(r._id, { [dateProp.id]: `${over.id}${time}` });
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2 px-4 pb-2 sm:px-12">
        <h3 className="text-[15px] font-semibold">{month.toLocaleDateString("en", { month: "long", year: "numeric" })}</h3>
        <div className="ms-auto flex items-center gap-1">
          {dateProps.length > 1 && (
            <Select label="Date property" size="sm" variant="filled" value={dateProp.id} onChange={(id) => onUpdateView({ datePropertyId: id })} options={dateProps.map((p) => ({ value: p.id, label: p.name }))} />
          )}
          <IconButton label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="size-4 flip-rtl" /></IconButton>
          <Button size="xs" variant="ghost" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>Today</Button>
          <IconButton label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="size-4 flip-rtl" /></IconButton>
        </div>
      </div>
      <div className="scroll-quiet overflow-x-auto px-4 sm:px-12">
        <div className="grid min-w-[700px] grid-cols-7 border-s border-t border-line text-[12.5px]">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="border-b border-e border-line px-2 py-1 text-fg-3">{d}</div>
          ))}
          {days.map((d) => {
            const key = iso(d);
            const items = byDay.get(key) ?? [];
            return (
              <CalendarDay key={key} id={key} outside={d.getMonth() !== month.getMonth()}>
                <div className="flex items-center justify-between">
                  <span className={cn("grid size-6 place-items-center rounded-full text-[12px]", key === today ? "bg-danger font-semibold text-white" : "text-fg-2")}>{d.getDate()}</span>
                  {!readOnly && (
                    <button type="button" aria-label={`New row on ${d.toLocaleDateString("en", { dateStyle: "medium" })}`} onClick={async () => { const id = await onCreate({ [dateProp.id]: key }); if (id) onOpenRecord(id); }} className="grid size-5 place-items-center rounded text-fg-3 opacity-0 hover:bg-hover group-hover/day:opacity-100 focus-visible:opacity-100">
                      <Plus className="size-3.5" />
                    </button>
                  )}
                </div>
                <div className="mt-1 grid gap-1">
                  {items.map((r) => (
                    <CalendarItem key={r._id} id={r._id} disabled={readOnly}>
                      <Link href={`/p/${r._id}`} onClick={openHandler(onOpenRecord, r._id)} className="block truncate rounded bg-overlay px-1.5 py-0.5 text-[12.5px] font-medium text-fg shadow-[0_0_0_1px_var(--line)] hover:bg-surface-2">
                        {r.icon && <PageIcon icon={r.icon} size={13} className="me-1 inline-grid align-[-2px]" />}
                        {pageTitle(r.title)}
                      </Link>
                    </CalendarItem>
                  ))}
                </div>
              </CalendarDay>
            );
          })}
        </div>
      </div>
      {undated > 0 && <p className="px-4 pt-2 text-[12.5px] text-fg-3 sm:px-12">{undated} row{undated === 1 ? " has" : "s have"} no {dateProp.name} and {undated === 1 ? "isn't" : "aren't"} shown. Switch to table view to set {undated === 1 ? "it" : "them"}.</p>}
    </DndContext>
  );
}

function CalendarDay({ id, outside, children }: { id: string; outside: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cn("group/day min-h-28 border-b border-e border-line p-1", outside && "bg-surface/60", isOver && "bg-accent-soft")}>
      {children}
    </div>
  );
}

function CalendarItem({ id, disabled, children }: { id: string; disabled: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} style={transform ? { transform: `translate(${transform.x}px, ${transform.y}px)` } : undefined} className={cn(isDragging && "relative z-30 opacity-90 shadow-pop")}>
      {children}
    </div>
  );
}
