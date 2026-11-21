"use client";

import { useState } from "react";
import { Play, Plus, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button, Dialog, IconButton, Input, Select, Switch, Textarea } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { timeAgo } from "@/lib/client/format";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import type { AutomationAction, AutomationRule, PropertyDef } from "@/lib/domain/types";

type Trigger = AutomationRule["trigger"];

const describeTrigger = (t: Trigger, props: PropertyDef[]) =>
  t.type === "created" ? "When a row is created" : t.type === "button" ? `When “${t.label}” is pressed` : t.type === "schedule" ? `Every ${t.every}: create “${t.title}”` : `When ${props.find((p) => p.id === t.propertyId)?.name ?? "a property"} changes${t.to !== undefined && t.to !== null ? ` to ${optionName(props, t.propertyId, t.to)}` : ""}`;
const optionName = (props: PropertyDef[], propertyId: string, v: unknown) => props.find((p) => p.id === propertyId)?.options?.find((o) => o.id === v)?.name ?? (v === true ? "checked" : v === false ? "unchecked" : String(v));

/** The Automations button in a database's toolbar: list, switch on and off, edit, delete. */
export function AutomationsButton({ databaseId, properties }: { databaseId: string; properties: PropertyDef[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label="Automations" onClick={() => setOpen(true)}>
        <Zap className="size-4" />
      </IconButton>
      {open && <AutomationsDialog databaseId={databaseId} properties={properties} onClose={() => setOpen(false)} />}
    </>
  );
}

function AutomationsDialog({ databaseId, properties, onClose }: { databaseId: string; properties: PropertyDef[]; onClose: () => void }) {
  const ws = useWorkspace();
  const q = useOp<{ automations: AutomationRule[] }>("automations.list", { databaseId });
  const [editing, setEditing] = useState<AutomationRule | "new" | null>(null);
  const list = q.data?.automations ?? [];
  const save = (automation: Partial<AutomationRule>) => ws.call("automations.save", { databaseId, automation }).catch((e) => notifyError(e));
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Automations" description="When something happens to a row, do something: set properties, stamp a date, assign, or notify people. Rules run instantly with the change and never trigger each other." size="lg">
      <div className="grid gap-3 px-5 pb-5 pt-2">
        {editing ? (
          <RuleEditor rule={editing === "new" ? null : editing} properties={properties} onCancel={() => setEditing(null)} onSave={async (r) => (await save(r), setEditing(null))} />
        ) : (
          <>
            {list.length === 0 ? (
              <p className="rounded-lg bg-surface-2 px-3 py-6 text-center text-[13px] text-fg-3">No automations yet. For example: when Status changes to Done, set Completed to now and notify the assignees.</p>
            ) : (
              <ul className="settings-card divide-y divide-line py-1" aria-label="Automations">
                {list.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                    <Switch checked={r.enabled} label={`${r.name} on`} onCheckedChange={(enabled) => save({ ...r, enabled })} />
                    <button type="button" className="min-w-0 flex-1 text-start" onClick={() => setEditing(r)}>
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate text-[12px] text-fg-3">
                        {describeTrigger(r.trigger, properties)} · {r.actions.length} action{r.actions.length === 1 ? "" : "s"}
                        {r.runs ? ` · ran ${r.runs}×, last ${timeAgo(r.lastRunAt ?? 0)}` : " · hasn't run yet"}
                      </span>
                    </button>
                    <IconButton label={`Delete ${r.name}`} size="sm" onClick={() => ws.call("automations.delete", { databaseId, automationId: r.id }).catch((e) => notifyError(e))}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end">
              <Button variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEditing("new")}>New automation</Button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}

const SETTABLE = new Set(["text", "number", "select", "status", "multi_select", "checkbox", "date", "url", "email", "phone", "person"]);

function RuleEditor({ rule, properties, onCancel, onSave }: { rule: AutomationRule | null; properties: PropertyDef[]; onCancel: () => void; onSave: (r: Partial<AutomationRule>) => Promise<unknown> }) {
  const [name, setName] = useState(rule?.name ?? "");
  const [trigger, setTrigger] = useState<Trigger>(rule?.trigger ?? { type: "created" });
  const [actions, setActions] = useState<AutomationAction[]>(rule?.actions ?? [{ type: "notify", to: "assignees", message: "" }]);
  const [busy, setBusy] = useState(false);
  const settable = properties.filter((p) => SETTABLE.has(p.type));
  const watchable = properties.filter((p) => p.type !== "title" && SETTABLE.has(p.type));
  const prop = (id: string) => properties.find((p) => p.id === id);
  const setAction = (i: number, a: AutomationAction) => setActions((list) => list.map((x, j) => (j === i ? a : x)));
  return (
    <div className="grid gap-3 text-[13px]">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Done → notify" aria-label="Automation name" maxLength={80} />
      <fieldset className="grid gap-1.5 rounded-lg p-3 shadow-[0_0_0_1px_var(--line)]">
        <legend className="px-1 text-[12px] font-medium text-fg-3">When</legend>
        <Select
          label="Trigger"
          size="sm"
          variant="filled"
          value={trigger.type}
          onChange={(t) => setTrigger(t === "created" ? { type: "created" } : t === "button" ? { type: "button", label: "Run" } : t === "schedule" ? { type: "schedule", every: "week", title: "Weekly review" } : { type: "changed", propertyId: watchable[0]?.id ?? "" })}
          options={[{ value: "created", label: "A row is created" }, { value: "changed", label: "A property changes" }, { value: "button", label: "A button is pressed" }, { value: "schedule", label: "On a schedule (recurring task)" }]}
        />
        {trigger.type === "changed" && (
          <div className="flex flex-wrap gap-2">
            <Select label="Property" size="sm" variant="filled" value={trigger.propertyId} onChange={(id) => setTrigger({ type: "changed", propertyId: id })} options={watchable.map((p) => ({ value: p.id, label: p.name }))} />
            {prop(trigger.propertyId)?.options?.length ? (
              <Select label="To" size="sm" variant="filled" value={String(trigger.to ?? "")} onChange={(v) => setTrigger({ ...trigger, to: v || undefined })} options={[{ value: "", label: "to anything" }, ...prop(trigger.propertyId)!.options!.map((o) => ({ value: o.id, label: `to ${o.name}` }))]} />
            ) : prop(trigger.propertyId)?.type === "checkbox" ? (
              <Select label="To" size="sm" variant="filled" value={trigger.to === undefined ? "" : String(trigger.to)} onChange={(v) => setTrigger({ ...trigger, to: v === "" ? undefined : v === "true" })} options={[{ value: "", label: "either way" }, { value: "true", label: "to checked" }, { value: "false", label: "to unchecked" }]} />
            ) : null}
          </div>
        )}
        {trigger.type === "button" && <Input value={trigger.label} onChange={(e) => setTrigger({ type: "button", label: e.target.value })} aria-label="Button label" maxLength={40} />}
        {trigger.type === "schedule" && (
          <div className="flex flex-wrap items-center gap-2">
            <Select label="How often" size="sm" variant="filled" value={trigger.every} onChange={(v) => setTrigger({ ...trigger, every: v as "day" | "week" | "month" })} options={[{ value: "day", label: "Every day" }, { value: "week", label: "Every week" }, { value: "month", label: "Every month" }]} />
            <Input className="h-8 max-w-56" value={trigger.title} onChange={(e) => setTrigger({ ...trigger, title: e.target.value })} aria-label="New row title" placeholder="Title of the new row" maxLength={200} />
            <span className="text-[12px] text-fg-3">creates this row, then runs the actions below</span>
          </div>
        )}
      </fieldset>
      <fieldset className="grid gap-2 rounded-lg p-3 shadow-[0_0_0_1px_var(--line)]">
        <legend className="px-1 text-[12px] font-medium text-fg-3">Then</legend>
        {actions.map((a, i) => (
          <div key={i} className="grid gap-1.5 rounded-md bg-surface-2 p-2">
            <div className="flex items-center gap-2">
              <Select
                label="Action"
                size="sm"
                variant="filled"
                value={a.type}
                onChange={(t) => setAction(i, t === "notify" ? { type: "notify", to: "assignees", message: "" } : t === "set" ? { type: "set", propertyId: settable[0]?.id ?? "", value: null } : { type: t as "set_now" | "assign_actor", propertyId: properties.find((p) => p.type === (t === "set_now" ? "date" : "person"))?.id ?? "" })}
                options={[{ value: "set", label: "Set a property" }, { value: "set_now", label: "Stamp a date with now" }, { value: "assign_actor", label: "Assign the person acting" }, { value: "notify", label: "Notify people" }]}
              />
              <IconButton label="Remove action" size="sm" className="ms-auto" onClick={() => setActions((list) => list.filter((_, j) => j !== i))}>
                <Trash2 className="size-3.5" />
              </IconButton>
            </div>
            {a.type === "set" && (
              <div className="flex flex-wrap gap-2">
                <Select label="Property" size="sm" variant="filled" value={a.propertyId} onChange={(id) => setAction(i, { ...a, propertyId: id, value: null })} options={settable.map((p) => ({ value: p.id, label: p.name }))} />
                {prop(a.propertyId)?.options?.length ? (
                  <Select label="Value" size="sm" variant="filled" value={String(a.value ?? "")} onChange={(v) => setAction(i, { ...a, value: v })} options={prop(a.propertyId)!.options!.map((o) => ({ value: o.id, label: o.name }))} />
                ) : prop(a.propertyId)?.type === "checkbox" ? (
                  <Select label="Value" size="sm" variant="filled" value={String(a.value === true)} onChange={(v) => setAction(i, { ...a, value: v === "true" })} options={[{ value: "true", label: "Checked" }, { value: "false", label: "Unchecked" }]} />
                ) : (
                  <Input className="h-8 max-w-48" value={String(a.value ?? "")} onChange={(e) => setAction(i, { ...a, value: e.target.value })} aria-label="Value" />
                )}
              </div>
            )}
            {(a.type === "set_now" || a.type === "assign_actor") && (
              <Select label="Property" size="sm" variant="filled" value={a.propertyId} onChange={(id) => setAction(i, { ...a, propertyId: id })} options={properties.filter((p) => p.type === (a.type === "set_now" ? "date" : "person")).map((p) => ({ value: p.id, label: p.name }))} />
            )}
            {a.type === "notify" && (
              <>
                <Select label="Who" size="sm" variant="filled" value={Array.isArray(a.to) ? "assignees" : a.to} onChange={(v) => setAction(i, { ...a, to: v as "assignees" | "creator" })} options={[{ value: "assignees", label: "Everyone assigned (Person properties)" }, { value: "creator", label: "Whoever created the row" }]} />
                <Textarea rows={2} value={a.message} maxLength={500} onChange={(e) => setAction(i, { ...a, message: e.target.value })} placeholder="Message" aria-label="Message" />
              </>
            )}
          </div>
        ))}
        {actions.length < 10 && (
          <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setActions((l) => [...l, { type: "notify", to: "assignees", message: "" }])}>
            Add action
          </Button>
        )}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          pending={busy}
          disabled={!name.trim() || !actions.length || actions.some((a) => (a.type === "notify" ? !a.message.trim() : !a.propertyId))}
          onClick={async () => {
            setBusy(true);
            await onSave({ ...(rule ? { id: rule.id } : {}), name: name.trim(), enabled: rule?.enabled ?? true, trigger, actions });
            setBusy(false);
          }}
        >
          Save automation
        </Button>
      </div>
    </div>
  );
}

/** Button automations, shown on a row's page. */
export function RowButtons({ recordId, databaseId }: { recordId: string; databaseId: string }) {
  const ws = useWorkspace();
  const q = useOp<{ automations: AutomationRule[] }>("automations.list", { databaseId });
  const buttons = (q.data?.automations ?? []).filter((r) => r.enabled && r.trigger.type === "button");
  const [busy, setBusy] = useState<string | null>(null);
  if (!buttons.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {buttons.map((b) => (
        <Button
          key={b.id}
          size="sm"
          icon={<Play className="size-3.5" />}
          pending={busy === b.id}
          onClick={async () => {
            setBusy(b.id);
            try {
              await ws.call("automations.press", { recordId, automationId: b.id });
              toast.success(`${b.trigger.type === "button" ? b.trigger.label : b.name} done`);
            } catch (err) {
              notifyError(err);
            } finally {
              setBusy(null);
            }
          }}
        >
          {b.trigger.type === "button" ? b.trigger.label : b.name}
        </Button>
      ))}
    </div>
  );
}
