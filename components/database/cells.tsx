"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, Plus, Search, X } from "lucide-react";
import { Popover, PopoverClose, cn } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import type { PageRow, PropertyDef, PropertyValue, SelectOption } from "@/lib/domain/types";
import type { RecordView } from "@/lib/client/types";
import { COLORS, READONLY_TYPES, Tag, formatDateValue, formatNumber } from "./meta";
import { PageIcon } from "@/components/workspace/PageIcon";

type Value = PropertyValue | undefined;

/** Read-only rendering of a property value. */
export function ValueView({ prop, value, record, compact }: { prop: PropertyDef; value: Value; record: Pick<RecordView, "title" | "createdAt" | "updatedAt">; compact?: boolean }) {
  switch (prop.type) {
    case "title":
      return <span className="truncate font-medium">{pageTitle(record.title)}</span>;
    case "checkbox":
      return (
        <span className={cn("grid size-4 place-items-center rounded-[4px] shadow-[inset_0_0_0_1.5px_var(--line-strong)]", value === true && "bg-accent shadow-none")} aria-label={value ? "Checked" : "Not checked"}>
          {value === true && <Check className="size-3 text-accent-fg" strokeWidth={3} />}
        </span>
      );
    case "select":
    case "status": {
      const opt = prop.options?.find((o) => o.id === value);
      return opt ? <Tag name={opt.name} color={opt.color} /> : null;
    }
    case "multi_select": {
      const ids = Array.isArray(value) ? value : [];
      const opts = ids.map((id) => prop.options?.find((o) => o.id === id)).filter((o): o is SelectOption => !!o);
      return <span className={cn("flex gap-1", compact ? "overflow-hidden" : "flex-wrap")}>{opts.map((o) => <Tag key={o.id} name={o.name} color={o.color} />)}</span>;
    }
    case "number":
      return typeof value === "number" ? <span className="tabular-nums">{formatNumber(value, prop)}</span> : null;
    case "date":
      return typeof value === "string" ? <span>{formatDateValue(value)}</span> : null;
    case "created_time":
      return <span className="text-fg-2">{formatDateValue(new Date(record.createdAt).toISOString().slice(0, 16))}</span>;
    case "updated_time":
      return <span className="text-fg-2">{formatDateValue(new Date(record.updatedAt).toISOString().slice(0, 16))}</span>;
    case "url":
      return typeof value === "string" ? (
        <a href={value} target="_blank" rel="noreferrer noopener" className="truncate underline decoration-line-strong underline-offset-2 hover:decoration-fg-2" onClick={(e) => e.stopPropagation()}>
          {value.replace(/^https?:\/\/(www\.)?/, "")}
        </a>
      ) : null;
    case "email":
      return typeof value === "string" ? <a href={`mailto:${value}`} className="truncate underline decoration-line-strong underline-offset-2" onClick={(e) => e.stopPropagation()}>{value}</a> : null;
    case "phone":
      return typeof value === "string" ? <a href={`tel:${value}`} className="truncate" dir="ltr" onClick={(e) => e.stopPropagation()}>{value}</a> : null;
    case "relation":
      return <RelationChips ids={Array.isArray(value) ? value : []} />;
    case "formula":
    case "rollup":
      if (value === null || value === undefined || value === "") return null;
      if (typeof value === "boolean") return <ValueView prop={{ ...prop, type: "checkbox" }} value={value} record={record} />;
      if (typeof value === "number") return <span className="tabular-nums">{value.toLocaleString("en", { maximumFractionDigits: 4 })}</span>;
      return <span className="truncate">{String(value)}</span>;
    default:
      return value === null || value === undefined ? null : <span className="truncate">{String(value)}</span>;
  }
}

function RelationChips({ ids }: { ids: string[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <RelationChip key={id} id={id} />
      ))}
    </span>
  );
}

function RelationChip({ id }: { id: string }) {
  const q = useOp<{ page: PageRow }>("pages.get", { id });
  return (
    <Link href={`/p/${id}`} onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 truncate rounded px-1 text-[13px] underline decoration-line-strong underline-offset-2 hover:bg-hover">
      {q.data?.page.icon && <PageIcon icon={q.data.page.icon} size={13} />}
      {q.data ? pageTitle(q.data.page.title) : q.error ? "Deleted row" : "…"}
    </Link>
  );
}

/**
 * The editor for one property value, shown in a popover anchored to the cell. Returns null for
 * calculated properties, which can't be edited.
 */
export function ValueEditor({ prop, value, onSave, onCreateOption, onClose, databaseId }: {
  prop: PropertyDef;
  value: Value;
  onSave: (value: unknown) => void;
  onCreateOption?: (name: string) => void;
  onClose: () => void;
  databaseId: string;
}) {
  if (READONLY_TYPES.has(prop.type)) {
    return <p className="max-w-64 p-3 text-[13px] text-fg-2">{prop.type === "formula" ? "Calculated by this property's formula." : prop.type === "rollup" ? "Calculated from related rows." : "Set automatically."}</p>;
  }
  switch (prop.type) {
    case "select":
    case "status":
    case "multi_select":
      return <OptionsEditor prop={prop} value={value} onSave={onSave} />;
    case "relation":
      return <RelationEditor prop={prop} value={value} onSave={onSave} databaseId={databaseId} />;
    case "date":
      return <DateEditor value={typeof value === "string" ? value : ""} onSave={(v) => (onSave(v || null), onClose())} />;
    case "checkbox":
      return null;
    default:
      return <TextEditor prop={prop} value={value} onSave={(v) => (onSave(v), onClose())} onCancel={onClose} />;
  }
  void onCreateOption;
}

function TextEditor({ prop, value, onSave, onCancel }: { prop: PropertyDef; value: Value; onSave: (v: string | number | null) => void; onCancel: () => void }) {
  const [draft, setDraft] = useState(value === null || value === undefined ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const multiline = prop.type === "text" || prop.type === "title";
  const validate = (raw: string): string | number | null | false => {
    const v = raw.trim();
    if (!v) return null;
    if (prop.type === "number") {
      const n = Number(v.replace(/,/g, ""));
      if (!Number.isFinite(n)) return (setError("Enter a number, like 42 or 3.5."), false);
      return n;
    }
    if (prop.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return (setError("Enter an email address, like name@example.com."), false);
    if (prop.type === "url" && !/^(https?:\/\/)?[^\s]+\.[^\s]+/.test(v)) return (setError("Enter a web address, like example.com."), false);
    if (prop.type === "phone" && !/^[+()\d\s.-]{3,32}$/.test(v)) return (setError("Enter a phone number using digits, spaces, + ( ) or -."), false);
    return prop.type === "title" || prop.type === "text" ? raw : v;
  };
  const commit = () => {
    const v = validate(draft);
    if (v === false) return;
    onSave(v);
  };
  const props = {
    autoFocus: true,
    value: draft,
    "aria-invalid": !!error || undefined,
    "aria-label": prop.name,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => (setDraft(e.target.value), setError(null)),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Enter" && (!multiline || !e.shiftKey)) {
        e.preventDefault();
        commit();
      }
      if (e.key === "Escape") onCancel();
    },
    className: "w-full bg-transparent px-2.5 py-2 text-[13.5px] outline-none",
  };
  return (
    <div className="w-[min(320px,calc(100vw-24px))]">
      {multiline ? <textarea rows={3} {...props} /> : <input inputMode={prop.type === "number" ? "decimal" : prop.type === "phone" ? "tel" : prop.type === "email" ? "email" : prop.type === "url" ? "url" : "text"} dir={prop.type === "phone" || prop.type === "url" || prop.type === "email" ? "ltr" : "auto"} {...props} />}
      <div className="flex items-center justify-between gap-2 border-t border-line px-2.5 py-1.5 text-[11.5px] text-fg-3">
        {error ? <span role="alert" className="text-danger">{error}</span> : <span>{multiline ? "Enter to save · Shift+Enter for a new line" : "Enter to save · Esc to cancel"}</span>}
      </div>
    </div>
  );
}

function DateEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [withTime, setWithTime] = useState(value.length > 10);
  const [draft, setDraft] = useState(value);
  const today = new Date();
  const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return (
    <div className="grid w-64 gap-2 p-2.5">
      <input
        autoFocus
        type={withTime ? "datetime-local" : "date"}
        value={withTime ? draft.slice(0, 16) : draft.slice(0, 10)}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") onSave(draft);
        }}
        aria-label="Date"
        className="h-8 rounded-md bg-surface-2 px-2 text-[13.5px] outline-none focus:shadow-[0_0_0_1px_var(--accent)]"
      />
      <div className="flex flex-wrap gap-1">
        {[["Today", 0], ["Tomorrow", 1], ["Next week", 7]].map(([label, days]) => (
          <button key={label} type="button" onClick={() => onSave(iso(new Date(today.getTime() + Number(days) * 86400000)))} className="h-6 rounded px-2 text-xs text-fg-2 shadow-[0_0_0_1px_var(--line)] hover:bg-hover">
            {label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[12.5px] text-fg-2">
        <input type="checkbox" checked={withTime} onChange={(e) => setWithTime(e.target.checked)} className="accent-[var(--accent)]" /> Include time
      </label>
      <div className="flex justify-between">
        <button type="button" onClick={() => onSave("")} className="h-7 rounded-md px-2 text-[12.5px] text-fg-2 hover:bg-hover">
          Clear
        </button>
        <button type="button" onClick={() => onSave(draft)} className="h-7 rounded-md bg-accent px-3 text-[12.5px] font-medium text-accent-fg hover:bg-accent-hover">
          Save date
        </button>
      </div>
    </div>
  );
}

function OptionsEditor({ prop, value, onSave }: { prop: PropertyDef; value: Value; onSave: (v: unknown) => void }) {
  const multi = prop.type === "multi_select";
  const [query, setQuery] = useState("");
  const selected = useMemo(() => new Set(Array.isArray(value) ? value : value ? [String(value)] : []), [value]);
  const options = prop.options ?? [];
  const q = query.trim().toLowerCase();
  const list = options.filter((o) => !q || o.name.toLowerCase().includes(q));
  const exact = options.some((o) => o.name.toLowerCase() === q);
  const toggle = (opt: SelectOption | string) => {
    const id = typeof opt === "string" ? opt : opt.id;
    if (multi) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // New names are sent as names; the server creates the option.
      onSave([...next]);
    } else onSave(selected.has(id) ? null : id);
  };
  return (
    <div className="w-[min(280px,calc(100vw-24px))]">
      <div className="flex flex-wrap items-center gap-1 border-b border-line p-2">
        {[...selected].map((id) => {
          const o = options.find((x) => x.id === id);
          return o ? (
            <span key={id} className="tag gap-1" data-color={o.color}>
              {o.name}
              <button type="button" aria-label={`Remove ${o.name}`} onClick={() => toggle(o)} className="opacity-60 hover:opacity-100">
                <X className="size-3" />
              </button>
            </span>
          ) : null;
        })}
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && q) {
              const match = options.find((o) => o.name.toLowerCase() === q) ?? list[0];
              if (match && (exact || prop.type === "status")) toggle(match);
              else if (prop.type !== "status") toggle(query.trim());
              setQuery("");
            }
          }}
          placeholder={prop.type === "status" ? "Search status" : "Search or create an option"}
          aria-label="Search options"
          className="h-6 min-w-24 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-3"
        />
      </div>
      <ul className="max-h-60 overflow-y-auto p-1" role="listbox" aria-multiselectable={multi}>
        {list.map((o) => (
          <li key={o.id}>
            <button type="button" role="option" aria-selected={selected.has(o.id)} onClick={() => toggle(o)} className="flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-start hover:bg-hover">
              <Tag name={o.name} color={o.color} />
              {selected.has(o.id) && <Check className="ms-auto size-3.5 text-fg-2" />}
            </button>
          </li>
        ))}
        {q && !exact && prop.type !== "status" && (
          <li>
            <button type="button" onClick={() => (toggle(query.trim()), setQuery(""))} className="flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-start text-[13px] hover:bg-hover">
              <Plus className="size-3.5 text-fg-3" /> Create <Tag name={query.trim()} color={COLORS[options.length % COLORS.length]} />
            </button>
          </li>
        )}
        {!list.length && (!q || prop.type === "status") && <li className="px-2 py-2 text-[12.5px] text-fg-3">{q ? "No matching option." : "No options yet. Type to create one."}</li>}
      </ul>
    </div>
  );
}

function RelationEditor({ prop, value, onSave, databaseId }: { prop: PropertyDef; value: Value; onSave: (v: unknown) => void; databaseId: string }) {
  const [query, setQuery] = useState("");
  const target = prop.relationDatabaseId ?? databaseId;
  const q = useOp<{ records: RecordView[] }>("databases.query", { databaseId: target, search: query || undefined, limit: 30 });
  const selected = new Set(Array.isArray(value) ? value : []);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSave([...next]);
  };
  return (
    <div className="w-[min(300px,calc(100vw-24px))]">
      <div className="relative border-b border-line p-2">
        <Search className="pointer-events-none absolute start-4 top-1/2 size-3.5 -translate-y-1/2 text-fg-3" />
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Search rows" aria-label="Search rows" className="h-7 w-full rounded-md bg-surface-2 ps-7 pe-2 text-[13px] outline-none" />
      </div>
      <ul className="max-h-64 overflow-y-auto p-1">
        {q.data?.records.map((r) => (
          <li key={r._id}>
            <button type="button" onClick={() => toggle(r._id)} className="flex h-7 w-full items-center gap-2 rounded-[5px] px-2 text-start text-[13.5px] hover:bg-hover">
              {r.icon && <PageIcon icon={r.icon} />}
              <span className="truncate">{pageTitle(r.title)}</span>
              {selected.has(r._id) && <Check className="ms-auto size-3.5 text-fg-2" />}
            </button>
          </li>
        ))}
        {q.data && !q.data.records.length && <li className="px-2 py-3 text-[12.5px] text-fg-3">No rows found.</li>}
      </ul>
    </div>
  );
}

/** A cell that shows a value and opens its editor on click/Enter. Checkboxes toggle in place. */
export function EditableValue({ prop, value, record, databaseId, readOnly, onSave, className, placeholder, align = "start" }: {
  prop: PropertyDef;
  value: Value;
  record: Pick<RecordView, "title" | "createdAt" | "updatedAt">;
  databaseId: string;
  readOnly?: boolean;
  onSave: (value: unknown) => void;
  className?: string;
  placeholder?: ReactNode;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) ref.current?.focus({ preventScroll: true });
  }, [open]);
  const empty = value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length);
  if (prop.type === "checkbox") {
    return (
      <button type="button" disabled={readOnly} role="checkbox" aria-checked={value === true} aria-label={prop.name} onClick={() => onSave(!(value === true))} className={cn("flex h-full w-full items-center px-2", className)}>
        <ValueView prop={prop} value={value} record={record} />
      </button>
    );
  }
  const trigger = (
    <button
      ref={ref}
      type="button"
      disabled={readOnly && !["url", "email", "phone"].includes(prop.type)}
      aria-label={`${prop.name}${empty ? ", empty" : ""}`}
      className={cn("flex h-full min-h-8 w-full min-w-0 items-center px-2 text-start text-[13.5px] outline-none hover:bg-hover focus-visible:shadow-[inset_0_0_0_2px_var(--focus)] disabled:hover:bg-transparent", className)}
    >
      {empty && prop.type !== "created_time" && prop.type !== "updated_time" && prop.type !== "formula" && prop.type !== "rollup" ? <span className="text-fg-3/70">{placeholder}</span> : <ValueView prop={prop} value={value} record={record} compact />}
    </button>
  );
  if (readOnly) return trigger;
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} align={align}>
      <ValueEditor prop={prop} value={value} databaseId={databaseId} onSave={onSave} onClose={() => setOpen(false)} />
      <PopoverClose className="sr-only">Close</PopoverClose>
    </Popover>
  );
}
