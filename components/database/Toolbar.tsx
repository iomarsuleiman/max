"use client";

import { useEffect, useState } from "react";
import { ArrowUpDown, Eye, EyeOff, Filter, Plus, Search, X } from "lucide-react";
import { Button, Popover, cn } from "@/components/ui";
import type { DatabaseView, FilterOperator, PropertyDef, ViewFilter, ViewSort } from "@/lib/domain/types";
import { PropIcon } from "./meta";

const OPS_BY_TYPE: Record<string, { op: FilterOperator; label: string; needsValue: boolean }[]> = {
  text: [
    { op: "contains", label: "contains", needsValue: true },
    { op: "not_contains", label: "doesn't contain", needsValue: true },
    { op: "equals", label: "is", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
  number: [
    { op: "equals", label: "=", needsValue: true },
    { op: "not_equals", label: "≠", needsValue: true },
    { op: "gt", label: ">", needsValue: true },
    { op: "lt", label: "<", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
  select: [
    { op: "equals", label: "is", needsValue: true },
    { op: "not_equals", label: "is not", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
  multi_select: [
    { op: "contains", label: "contains", needsValue: true },
    { op: "not_contains", label: "doesn't contain", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
  checkbox: [
    { op: "is_checked", label: "is checked", needsValue: false },
    { op: "is_not_checked", label: "is not checked", needsValue: false },
  ],
  date: [
    { op: "equals", label: "is", needsValue: true },
    { op: "before", label: "is before", needsValue: true },
    { op: "after", label: "is after", needsValue: true },
    { op: "is_empty", label: "is empty", needsValue: false },
    { op: "is_not_empty", label: "is not empty", needsValue: false },
  ],
};
export function operatorsFor(prop: PropertyDef) {
  if (prop.type === "status") return OPS_BY_TYPE.select;
  if (prop.type in OPS_BY_TYPE) return OPS_BY_TYPE[prop.type];
  if (prop.type === "created_time" || prop.type === "updated_time") return OPS_BY_TYPE.date;
  return OPS_BY_TYPE.text;
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(!!value);
  useEffect(() => {
    if (value) setOpen(true);
  }, [value]);
  if (!open)
    return (
      <Button size="sm" variant="ghost" icon={<Search className="size-3.5" />} onClick={() => setOpen(true)} aria-label="Search this database">
        <span className="max-sm:hidden">Search</span>
      </Button>
    );
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute start-2 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
      <input
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => !value && setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && (onChange(""), setOpen(false))}
        placeholder="Search rows"
        aria-label="Search rows"
        className="h-7 w-44 rounded-md bg-surface-2 ps-7 pe-6 text-[13px] outline-none focus:shadow-[0_0_0_1px_var(--accent)] max-sm:w-32"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute end-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-fg-3 hover:bg-hover">
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

export function FilterButton({ view, properties, onChange }: { view: DatabaseView; properties: PropertyDef[]; onChange: (filters: ViewFilter[]) => void }) {
  const filters = view.filters;
  const add = (propertyId: string) => {
    const prop = properties.find((p) => p.id === propertyId)!;
    onChange([...filters, { id: Math.random().toString(36).slice(2, 10), propertyId, operator: operatorsFor(prop)[0].op, value: prop.type === "checkbox" ? null : "" }]);
  };
  return (
    <Popover
      align="end"
      className="w-[min(460px,calc(100vw-24px))] p-2"
      trigger={
        <Button size="sm" variant="ghost" icon={<Filter className="size-3.5" />} className={cn(filters.length && "text-accent-text")}>
          <span className="max-sm:hidden">Filter</span>
          {filters.length > 0 && <span className="rounded bg-accent-soft px-1 text-[11px]">{filters.length}</span>}
        </Button>
      }
    >
      {filters.length === 0 && <p className="px-1 pb-2 text-[12.5px] text-fg-3">Show only rows that match. Filters are saved with this view.</p>}
      <ul className="grid gap-1.5">
        {filters.map((f, i) => {
          const prop = properties.find((p) => p.id === f.propertyId);
          if (!prop) return null;
          const ops = operatorsFor(prop);
          const needs = ops.find((o) => o.op === f.operator)?.needsValue;
          const set = (patch: Partial<ViewFilter>) => onChange(filters.map((x, j) => (j === i ? { ...x, ...patch } : x)));
          return (
            <li key={f.id} className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 text-end text-[12px] text-fg-3">{i === 0 ? "Where" : "and"}</span>
              <select aria-label="Property" value={f.propertyId} onChange={(e) => set({ propertyId: e.target.value, operator: operatorsFor(properties.find((p) => p.id === e.target.value)!)[0].op, value: "" })} className="h-7 max-w-36 rounded-md bg-surface-2 px-1.5 text-[13px]">
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <select aria-label="Condition" value={f.operator} onChange={(e) => set({ operator: e.target.value as FilterOperator })} className="h-7 rounded-md bg-surface-2 px-1.5 text-[13px]">
                {ops.map((o) => <option key={o.op} value={o.op}>{o.label}</option>)}
              </select>
              {needs &&
                (prop.type === "select" || prop.type === "status" || prop.type === "multi_select" ? (
                  <select aria-label="Value" value={String(f.value ?? "")} onChange={(e) => set({ value: e.target.value })} className="h-7 max-w-36 rounded-md bg-surface-2 px-1.5 text-[13px]">
                    <option value="">Choose…</option>
                    {prop.options?.map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
                  </select>
                ) : (
                  <input
                    aria-label="Value"
                    type={prop.type === "date" || prop.type === "created_time" || prop.type === "updated_time" ? "date" : prop.type === "number" ? "number" : "text"}
                    defaultValue={String(f.value ?? "")}
                    onBlur={(e) => set({ value: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && set({ value: (e.target as HTMLInputElement).value })}
                    className="h-7 w-32 rounded-md bg-surface-2 px-2 text-[13px] outline-none focus:shadow-[0_0_0_1px_var(--accent)]"
                  />
                ))}
              <button type="button" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))} className="grid size-6 place-items-center rounded text-fg-3 hover:bg-hover">
                <X className="size-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between gap-2">
        <select aria-label="Add a filter" value="" onChange={(e) => e.target.value && add(e.target.value)} className="h-7 rounded-md px-1.5 text-[13px] text-fg-2 hover:bg-hover">
          <option value="">+ Add a filter</option>
          {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {filters.length > 0 && (
          <Button size="xs" variant="ghost" onClick={() => onChange([])}>
            Clear all filters
          </Button>
        )}
      </div>
    </Popover>
  );
}

export function SortButton({ view, properties, onChange }: { view: DatabaseView; properties: PropertyDef[]; onChange: (sorts: ViewSort[]) => void }) {
  const sorts = view.sorts;
  return (
    <Popover
      align="end"
      className="w-[min(380px,calc(100vw-24px))] p-2"
      trigger={
        <Button size="sm" variant="ghost" icon={<ArrowUpDown className="size-3.5" />} className={cn(sorts.length && "text-accent-text")}>
          <span className="max-sm:hidden">Sort</span>
          {sorts.length > 0 && <span className="rounded bg-accent-soft px-1 text-[11px]">{sorts.length}</span>}
        </Button>
      }
    >
      {sorts.length === 0 && <p className="px-1 pb-2 text-[12.5px] text-fg-3">Without a sort, rows keep the order you drag them into.</p>}
      <ul className="grid gap-1.5">
        {sorts.map((s, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <select aria-label="Sort by" value={s.propertyId} onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, propertyId: e.target.value } : x)))} className="h-7 min-w-0 flex-1 rounded-md bg-surface-2 px-1.5 text-[13px]">
              {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select aria-label="Direction" value={s.direction} onChange={(e) => onChange(sorts.map((x, j) => (j === i ? { ...x, direction: e.target.value as "asc" | "desc" } : x)))} className="h-7 rounded-md bg-surface-2 px-1.5 text-[13px]">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
            <button type="button" aria-label="Remove sort" onClick={() => onChange(sorts.filter((_, j) => j !== i))} className="grid size-6 place-items-center rounded text-fg-3 hover:bg-hover">
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between">
        <select aria-label="Add a sort" value="" onChange={(e) => e.target.value && onChange([...sorts, { propertyId: e.target.value, direction: "asc" }])} className="h-7 rounded-md px-1.5 text-[13px] text-fg-2 hover:bg-hover">
          <option value="">+ Add a sort</option>
          {properties.filter((p) => !sorts.some((s) => s.propertyId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {sorts.length > 0 && (
          <Button size="xs" variant="ghost" onClick={() => onChange([])}>
            Clear sorts
          </Button>
        )}
      </div>
    </Popover>
  );
}

export function PropertiesButton({ view, properties, onChange }: { view: DatabaseView; properties: PropertyDef[]; onChange: (hidden: string[]) => void }) {
  const hidden = new Set(view.hiddenPropertyIds);
  return (
    <Popover align="end" className="w-64 p-1.5" trigger={<Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />}><span className="max-sm:hidden">Properties</span></Button>}>
      <p className="px-1.5 pb-1 text-[11.5px] font-medium text-fg-3">Shown in this view</p>
      <ul className="grid max-h-72 overflow-y-auto">
        {properties.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              disabled={p.type === "title"}
              aria-pressed={!hidden.has(p.id)}
              onClick={() => {
                const next = new Set(hidden);
                if (next.has(p.id)) next.delete(p.id);
                else next.add(p.id);
                onChange([...next]);
              }}
              className="flex h-7 w-full items-center gap-2 rounded-[5px] px-1.5 text-start text-[13.5px] hover:bg-hover disabled:opacity-60"
            >
              <PropIcon type={p.type} className="size-3.5 text-fg-3" />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {hidden.has(p.id) ? <EyeOff className="size-3.5 text-fg-3" /> : <Eye className="size-3.5 text-fg-2" />}
            </button>
          </li>
        ))}
      </ul>
      {hidden.size > 0 && (
        <button type="button" onClick={() => onChange([])} className="mt-1 flex h-7 w-full items-center gap-2 rounded-[5px] px-1.5 text-[13px] text-fg-2 hover:bg-hover">
          <Plus className="size-3.5" /> Show all
        </button>
      )}
    </Popover>
  );
}
