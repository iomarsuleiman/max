"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { CheckCircle2, ClipboardList } from "@/components/icons";
import { Button, EmptyState, Field, Input, Select, Skeleton, Textarea } from "@/components/ui";
import { Topbar } from "@/components/workspace/Topbar";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { pageHref } from "@/lib/pageUrl";
import type { PropertyDef } from "@/lib/domain/types";

const FILLABLE = new Set(["title", "text", "number", "select", "status", "multi_select", "checkbox", "date", "url", "email", "phone", "person"]);

/**
 * A database as a form: one field per property, and submitting adds a row. Anyone who can add
 * rows to the database can use it (in an organization, its members); the server checks every value.
 */
export function FormView({ databaseId }: { databaseId: string }) {
  const ws = useWorkspace();
  const q = useOp<{ database: { _id: string; title: string; icon: string | null }; properties: PropertyDef[] }>("databases.get", { databaseId });
  const people = useOp<{ people: { id: string; name: string }[] }>("people.list", q.data?.properties.some((p) => p.type === "person") ? {} : "skip").data?.people ?? [];
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  if (q.error) return <EmptyState icon={<ClipboardList className="size-5" />} title="This form isn't available" body={q.error.message} className="mt-24" />;
  if (!q.data) return <div className="mx-auto mt-16 w-full max-w-xl px-4"><Skeleton className="h-80" /></div>;
  const props = q.data.properties.filter((p) => FILLABLE.has(p.type));
  const set = (id: string, v: unknown) => setValues((s) => ({ ...s, [id]: v }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined && !(Array.isArray(v) && !v.length)));
      const { record } = await ws.call<{ record: { _id: string } }>("records.create", { databaseId, values: clean });
      setSent(record._id);
      setValues({});
    } catch (err) {
      notifyError(err, "Couldn't send the form.");
    } finally {
      setBusy(false);
    }
  };
  const field = (p: PropertyDef) => {
    const v = values[p.id];
    const id = `form-${p.id}`;
    switch (p.type) {
      case "checkbox":
        return <label key={p.id} className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={v === true} onChange={(e) => set(p.id, e.target.checked)} /> {p.name}</label>;
      case "select":
      case "status":
        return <Field key={p.id} label={p.name} htmlFor={id}><Select label={p.name} variant="filled" value={String(v ?? "")} onChange={(x) => set(p.id, x)} options={[{ value: "", label: "—" }, ...(p.options ?? []).map((o) => ({ value: o.name, label: o.name }))]} /></Field>;
      case "multi_select":
      case "person": {
        const opts = p.type === "person" ? people.map((x) => ({ value: x.id, label: x.name })) : (p.options ?? []).map((o) => ({ value: o.name, label: o.name }));
        const list = Array.isArray(v) ? (v as string[]) : [];
        return (
          <fieldset key={p.id} className="grid gap-1">
            <legend className="mb-1 text-[13px] font-medium">{p.name}</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
              {opts.map((o) => (
                <label key={o.value} className="flex items-center gap-1.5"><input type="checkbox" checked={list.includes(o.value)} onChange={(e) => set(p.id, e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))} /> {o.label}</label>
              ))}
            </div>
          </fieldset>
        );
      }
      case "text":
        return <Field key={p.id} label={p.name} htmlFor={id}><Textarea id={id} rows={3} value={String(v ?? "")} onChange={(e) => set(p.id, e.target.value)} /></Field>;
      default:
        return (
          <Field key={p.id} label={p.type === "title" ? p.name : p.name} htmlFor={id}>
            <Input id={id} required={p.type === "title"} type={p.type === "number" ? "number" : p.type === "date" ? "date" : p.type === "email" ? "email" : p.type === "url" ? "url" : "text"} value={String(v ?? "")} onChange={(e) => set(p.id, e.target.value)} />
          </Field>
        );
    }
  };
  return (
    <>
      <Topbar crumbs={[{ title: pageTitle(q.data.database.title), href: pageHref(databaseId, q.data.database.title) }, { title: "Form", href: `/forms/${databaseId}` }]} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl px-4 pb-24 pt-12">
          <p className="font-mono text-[11px] font-bold tracking-[.16em] text-fg-3">FORM</p>
          <h1 className="mt-1 text-[28px] font-bold tracking-tight">{pageTitle(q.data.database.title)}</h1>
          {sent ? (
            <div className="settings-card mt-6 grid gap-3 py-5 text-center">
              <CheckCircle2 className="mx-auto size-6 text-success" aria-hidden />
              <p className="text-[15px] font-medium">Sent. Thank you!</p>
              <div className="flex justify-center gap-2">
                <Button onClick={() => setSent(null)}>Send another</Button>
                <Link href={pageHref(sent)} className="inline-flex h-8 items-center rounded-md px-3 text-[13.5px] hover:bg-hover">Open what you sent</Link>
              </div>
            </div>
          ) : (
            <form onSubmit={submit} className="settings-card mt-6 grid gap-4 py-5">
              {props.map(field)}
              <div className="flex justify-end">
                <Button type="submit" variant="primary" pending={busy}>Send</Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
