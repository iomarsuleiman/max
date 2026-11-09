"use client";

import { useState, type ReactNode } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, EyeOff, Filter, GripVertical, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button, Input, Popover, PopoverClose, Select, Textarea, confirmAction, cn } from "@/components/ui";
import type { DatabaseView, PropertyDef, PropertyType, RollupFn, SelectOption } from "@/lib/domain/types";
import { useOp } from "@/lib/client/data";
import type { PageSummary } from "@/lib/client/types";
import { pageTitle } from "@/lib/client/format";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { ADDABLE_TYPES, COLORS, PropIcon, TYPE_META, Tag } from "./meta";

const ROLLUP_FNS: { value: RollupFn; label: string }[] = [
  { value: "show_original", label: "Show values" },
  { value: "count", label: "Count all" },
  { value: "count_values", label: "Count values" },
  { value: "sum", label: "Sum" },
  { value: "average", label: "Average" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
  { value: "percent_checked", label: "Percent checked" },
];

/** Settings for one property: name, type, options, formula, rollup, sort/filter shortcuts. */
export function PropertyMenu({ databaseId, prop, properties, view, trigger, onSort, onFilter, onHide }: {
  databaseId: string;
  prop: PropertyDef;
  properties: PropertyDef[];
  view?: DatabaseView;
  trigger: ReactNode;
  onSort?: (direction: "asc" | "desc") => void;
  onFilter?: () => void;
  onHide?: () => void;
}) {
  const ws = useWorkspace();
  const [name, setName] = useState(prop.name);
  const [open, setOpen] = useState(false);
  const [formula, setFormula] = useState(prop.formula ?? "");
  const [formulaError, setFormulaError] = useState<string | null>(null);
  const update = async (patch: Record<string, unknown>, ok?: string) => {
    try {
      await ws.call("properties.update", { databaseId, propertyId: prop.id, ...patch });
      if (ok) toast.success(ok, { duration: 1500 });
      return true;
    } catch (err) {
      notifyError(err);
      return false;
    }
  };
  const remove = async () => {
    const ok = await confirmAction({
      title: `Delete the “${prop.name}” property?`,
      body: <p>Its values are removed from every row in this database. Views that sort or filter by it are updated. This can't be undone.</p>,
      confirmLabel: "Delete property",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await ws.call("properties.delete", { databaseId, propertyId: prop.id, confirm: true });
      toast.success(`Deleted “${prop.name}”`);
      setOpen(false);
    } catch (err) {
      notifyError(err);
    }
  };
  const isSelect = ["select", "multi_select", "status"].includes(prop.type);
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && (setName(prop.name), setFormula(prop.formula ?? "")))} trigger={trigger} className="w-[min(300px,calc(100vw-24px))] p-0">
      <div className="grid gap-2 border-b border-line p-2.5">
        <Input
          value={name}
          aria-label="Property name"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && name.trim() && name !== prop.name) void update({ name: name.trim() }, "Renamed");
          }}
          onBlur={() => name.trim() && name !== prop.name && update({ name: name.trim() })}
        />
        {prop.type !== "title" && (
          <div className="grid gap-1 text-[12px] text-fg-3">
            <span aria-hidden>Type</span>
            <Select
              label="Type"
              value={prop.type}
              options={ADDABLE_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label, icon: <PropIcon type={t} /> }))}
              onChange={async (next: PropertyType) => {
                if (next === "relation") return toast.error("Add a new Relation property instead of converting this one.");
                if (next === "rollup") return toast.error("Add a new Rollup property so you can choose what to summarize.");
                const ok = await confirmAction({
                  title: `Change “${prop.name}” to ${TYPE_META[next].label}?`,
                  body: <p>Existing values are converted where possible. Values that don't fit the new type are cleared.</p>,
                  confirmLabel: "Change type",
                });
                if (ok) void update({ type: next }, `Changed to ${TYPE_META[next].label}`);
              }}
            />
          </div>
        )}
        {prop.type === "number" && (
          <div className="grid gap-1 text-[12px] text-fg-3">
            <span aria-hidden>Number format</span>
            <Select
              label="Number format"
              value={prop.numberFormat ?? "number"}
              onChange={(v) => update({ numberFormat: v })}
              options={[
                { value: "number", label: "Number" },
                { value: "percent", label: "Percent" },
                { value: "currency", label: "Currency (USD)" },
              ]}
            />
          </div>
        )}
        {prop.type === "formula" && (
          <div className="grid gap-1">
            <label htmlFor={`f-${prop.id}`} className="text-[12px] text-fg-3">
              Formula
            </label>
            <Textarea id={`f-${prop.id}`} dir="ltr" rows={3} value={formula} onChange={(e) => (setFormula(e.target.value), setFormulaError(null))} onKeyDown={(e) => e.stopPropagation()} className="font-mono text-[12.5px]" />
            {formulaError && <p role="alert" className="text-xs text-danger">{formulaError}</p>}
            <p className="text-[11.5px] leading-snug text-fg-3">Use prop(&quot;Name&quot;), + − × ÷, if(), concat(), round(), dateBetween(a, b, &quot;days&quot;), today().</p>
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                try {
                  await ws.call("properties.update", { databaseId, propertyId: prop.id, formula });
                  toast.success("Formula saved");
                } catch (err) {
                  setFormulaError((err as Error).message);
                }
              }}
            >
              Save formula
            </Button>
          </div>
        )}
        {prop.type === "rollup" && <RollupSettings databaseId={databaseId} prop={prop} properties={properties} onSave={(rollup) => update({ rollup }, "Rollup updated")} />}
      </div>
      {isSelect && <OptionsList prop={prop} onSave={(options) => update({ options })} />}
      <div className="grid p-1">
        {onSort && (
          <>
            <MenuButton icon={<ArrowUpNarrowWide />} onClick={() => (onSort("asc"), setOpen(false))}>Sort ascending</MenuButton>
            <MenuButton icon={<ArrowDownWideNarrow />} onClick={() => (onSort("desc"), setOpen(false))}>Sort descending</MenuButton>
          </>
        )}
        {onFilter && <MenuButton icon={<Filter />} onClick={() => (onFilter(), setOpen(false))}>Filter by {prop.name}</MenuButton>}
        {onHide && prop.type !== "title" && view && <MenuButton icon={<EyeOff />} onClick={() => (onHide(), setOpen(false))}>Hide in this view</MenuButton>}
        {prop.type !== "title" && (
          <MenuButton icon={<Trash2 />} danger onClick={remove}>
            Delete property
          </MenuButton>
        )}
      </div>
    </Popover>
  );
}

function MenuButton({ icon, children, onClick, danger }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn("flex h-7 items-center gap-2 rounded-[5px] px-2 text-start text-[13.5px] hover:bg-hover [&>svg]:size-4 [&>svg]:text-fg-2", danger && "hover:bg-danger-soft hover:text-danger [&>svg]:hover:text-danger")}>
      {icon}
      {children}
    </button>
  );
}

function OptionsList({ prop, onSave }: { prop: PropertyDef; onSave: (options: SelectOption[]) => void }) {
  const [adding, setAdding] = useState("");
  const options = prop.options ?? [];
  return (
    <div className="border-b border-line p-1.5">
      <p className="px-1.5 pb-1 text-[11.5px] font-medium text-fg-3">Options</p>
      <ul className="grid max-h-56 overflow-y-auto">
        {options.map((o, i) => (
          <li key={o.id} className="group flex items-center gap-1 rounded-[5px] px-1 py-0.5 hover:bg-hover">
            <GripVertical className="size-3.5 text-fg-3 opacity-0" aria-hidden />
            <input
              defaultValue={o.name}
              aria-label="Option name"
              onKeyDown={(e) => e.stopPropagation()}
              onBlur={(e) => e.target.value.trim() && e.target.value !== o.name && onSave(options.map((x) => (x.id === o.id ? { ...x, name: e.target.value.trim() } : x)))}
              className="h-6 min-w-0 flex-1 rounded bg-transparent px-1 text-[13px] outline-none focus:bg-overlay focus:shadow-[0_0_0_1px_var(--accent)]"
            />
            <Popover
              trigger={
                <button type="button" aria-label={`Color for ${o.name}`} className="grid size-6 place-items-center rounded hover:bg-hover">
                  <span className="dot" data-color={o.color} />
                </button>
              }
              align="end"
              className="grid w-40 grid-cols-3 gap-1 p-2"
            >
              {COLORS.map((c) => (
                <PopoverClose asChild key={c}>
                  <button type="button" onClick={() => onSave(options.map((x) => (x.id === o.id ? { ...x, color: c } : x)))} className="flex h-7 items-center justify-center rounded hover:bg-hover" aria-label={c}>
                    <Tag name={c} color={c} />
                  </button>
                </PopoverClose>
              ))}
            </Popover>
            <button
              type="button"
              aria-label={`Delete option ${o.name}`}
              onClick={async () => {
                const ok = await confirmAction({ title: `Delete “${o.name}”?`, body: <p>Rows that use this option will have it cleared.</p>, confirmLabel: "Delete option", tone: "danger" });
                if (ok) onSave(options.filter((x) => x.id !== o.id));
              }}
              className="grid size-6 place-items-center rounded text-fg-3 opacity-0 hover:bg-hover hover:text-danger group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3.5" />
            </button>
            <span className="sr-only">{i}</span>
          </li>
        ))}
      </ul>
      <form
        className="mt-1 flex items-center gap-1 px-1"
        onSubmit={(e) => {
          e.preventDefault();
          const n = adding.trim();
          if (!n) return;
          if (options.some((o) => o.name.toLowerCase() === n.toLowerCase())) return toast.error(`“${n}” already exists.`);
          onSave([...options, { id: "", name: n, color: COLORS[options.length % COLORS.length] } as SelectOption].map((o) => (o.id ? o : { name: o.name, color: o.color } as SelectOption)));
          setAdding("");
        }}
      >
        <Plus className="size-3.5 text-fg-3" />
        <input value={adding} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.stopPropagation()} placeholder="Add an option" aria-label="Add an option" className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-fg-3" />
      </form>
    </div>
  );
}

function RollupSettings({ databaseId, prop, properties, onSave }: { databaseId: string; prop: PropertyDef; properties: PropertyDef[]; onSave: (r: PropertyDef["rollup"]) => void }) {
  const relations = properties.filter((p) => p.type === "relation");
  const [rel, setRel] = useState(prop.rollup?.relationPropertyId ?? relations[0]?.id ?? "");
  const relProp = relations.find((r) => r.id === rel);
  const target = useOp<{ properties: PropertyDef[] }>("databases.get", relProp?.relationDatabaseId ? { databaseId: relProp.relationDatabaseId } : "skip");
  const [targetProp, setTargetProp] = useState(prop.rollup?.targetPropertyId ?? "");
  const [fn, setFn] = useState<RollupFn>(prop.rollup?.fn ?? "count");
  void databaseId;
  if (!relations.length) return <p className="text-[12.5px] text-fg-3">Add a Relation property first; a rollup summarizes the related rows.</p>;
  return (
    <div className="grid gap-2 text-[12px] text-fg-3">
      <div className="grid gap-1">
        <span aria-hidden>Relation</span>
        <Select label="Relation" value={rel} onChange={setRel} options={relations.map((r) => ({ value: r.id, label: r.name }))} />
      </div>
      <div className="grid gap-1">
        <span aria-hidden>Property</span>
        <Select label="Property" value={targetProp} onChange={setTargetProp} options={(target.data?.properties ?? []).map((p) => ({ value: p.id, label: p.name, icon: <PropIcon type={p.type} /> }))} />
      </div>
      <div className="grid gap-1">
        <span aria-hidden>Calculate</span>
        <Select label="Calculate" value={fn} onChange={(v) => setFn(v as RollupFn)} options={ROLLUP_FNS.map((f) => ({ value: f.value, label: f.label }))} />
      </div>
      <Button size="sm" variant="primary" disabled={!rel || !targetProp} onClick={() => onSave({ relationPropertyId: rel, targetPropertyId: targetProp, fn })}>
        Save rollup
      </Button>
    </div>
  );
}

/** "+" button that adds a property. */
export function AddProperty({ databaseId, trigger }: { databaseId: string; trigger: ReactNode }) {
  const ws = useWorkspace();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType | null>(null);
  const [relationDb, setRelationDb] = useState("");
  const dbs = (ws.tree ?? []).filter((p) => p.kind === "database") as PageSummary[];
  const create = async () => {
    if (!type) return;
    try {
      await ws.call("properties.add", { databaseId, name: name.trim() || TYPE_META[type].label, type, relationDatabaseId: type === "relation" ? relationDb || databaseId : undefined, formula: type === "formula" ? "" : undefined });
      toast.success(`Added “${name.trim() || TYPE_META[type].label}”`, { duration: 1500 });
      setOpen(false);
      setName("");
      setType(null);
    } catch (err) {
      notifyError(err);
    }
  };
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} align="end" className="w-[min(280px,calc(100vw-24px))] p-2">
      {!type ? (
        <>
          <p className="px-1.5 pb-1.5 text-[11.5px] font-medium text-fg-3">Property type</p>
          <ul className="grid max-h-80 overflow-y-auto">
            {ADDABLE_TYPES.map((t) => (
              <li key={t}>
                <button type="button" onClick={() => (setType(t), t === "rollup" && toast("Choose the relation and property in the new column's settings."))} className="flex w-full items-center gap-2 rounded-[5px] px-1.5 py-1 text-start hover:bg-hover">
                  <span className="grid size-6 place-items-center rounded bg-surface-2 text-fg-2"><PropIcon type={t} /></span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px]">{TYPE_META[t].label}</span>
                    <span className="block truncate text-[11.5px] text-fg-3">{TYPE_META[t].help}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <form className="grid gap-2" onSubmit={(e) => (e.preventDefault(), void create())}>
          <p className="flex items-center gap-1.5 text-[12px] text-fg-3"><PropIcon type={type} /> {TYPE_META[type].label}</p>
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={TYPE_META[type].label} aria-label="Property name" onKeyDown={(e) => e.stopPropagation()} />
          {type === "relation" && (
            <div className="grid gap-1 text-[12px] text-fg-3">
              <span aria-hidden>Related database</span>
              <Select
                label="Related database"
                value={relationDb}
                onChange={setRelationDb}
                options={[{ value: "", label: "This database" }, ...dbs.filter((d) => d._id !== databaseId).map((d) => ({ value: d._id, label: pageTitle(d.title) }))]}
              />
            </div>
          )}
          {type === "rollup" ? (
            <RollupCreate databaseId={databaseId} name={name} onDone={() => (setOpen(false), setType(null), setName(""))} />
          ) : (
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setType(null)}>Back</Button>
              <Button size="sm" variant="primary" type="submit">Add property</Button>
            </div>
          )}
        </form>
      )}
    </Popover>
  );
}

function RollupCreate({ databaseId, name, onDone }: { databaseId: string; name: string; onDone: () => void }) {
  const ws = useWorkspace();
  const schema = useOp<{ properties: PropertyDef[] }>("databases.get", { databaseId });
  const relations = schema.data?.properties.filter((p) => p.type === "relation") ?? [];
  const [rel, setRel] = useState("");
  const relProp = relations.find((r) => r.id === (rel || relations[0]?.id));
  const target = useOp<{ properties: PropertyDef[] }>("databases.get", relProp?.relationDatabaseId ? { databaseId: relProp.relationDatabaseId } : "skip");
  const [tp, setTp] = useState("");
  const [fn, setFn] = useState<RollupFn>("count");
  if (schema.data && !relations.length) return <p className="text-[12.5px] text-fg-3">Add a Relation property first. A rollup summarizes values from related rows.</p>;
  return (
    <div className="grid gap-2 text-[12px] text-fg-3">
      <Select label="Relation" value={rel || relations[0]?.id || ""} onChange={setRel} options={relations.map((r) => ({ value: r.id, label: r.name }))} />
      <Select label="Property to summarize" placeholder="Property to summarize…" value={tp} onChange={setTp} options={(target.data?.properties ?? []).map((p) => ({ value: p.id, label: p.name, icon: <PropIcon type={p.type} /> }))} />
      <Select label="Calculation" value={fn} onChange={(v) => setFn(v as RollupFn)} options={ROLLUP_FNS.map((f) => ({ value: f.value, label: f.label }))} />
      <Button
        size="sm"
        variant="primary"
        disabled={!relProp || !tp}
        onClick={() =>
          ws
            .call("properties.add", { databaseId, name: name.trim() || "Rollup", type: "rollup", rollup: { relationPropertyId: relProp!.id, targetPropertyId: tp, fn } })
            .then(() => (toast.success("Rollup added"), onDone()))
            .catch((e) => notifyError(e))
        }
      >
        Add rollup
      </Button>
    </div>
  );
}
