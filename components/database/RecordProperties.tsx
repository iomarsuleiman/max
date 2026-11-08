"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import type { PageRow, PropertyDef } from "@/lib/domain/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { EditableValue } from "./cells";
import { PropIcon } from "./meta";
import { AddProperty, PropertyMenu } from "./PropertyMenu";
import { orderedProperties } from "./useDatabase";

/** Property panel at the top of a database row's page. */
export function RecordProperties({ record, readOnly }: { record: PageRow; readOnly: boolean }) {
  const ws = useWorkspace();
  const db = useOp<{ database: { _id: string; title: string; icon: string | null }; properties: PropertyDef[]; views: PageRow["views"] }>("databases.get", record.databaseId ? { databaseId: record.databaseId } : "skip");
  const computed = useOp<{ records: { _id: string; values: Record<string, unknown> }[] }>("databases.query", record.databaseId && !record.isTemplate ? { databaseId: record.databaseId, limit: 200 } : "skip");
  const props = useMemo(() => orderedProperties(db.data?.properties ?? [], db.data?.views?.[0], true).filter((p) => p.type !== "title"), [db.data]);
  const values = { ...record.values, ...(computed.data?.records.find((r) => r._id === record._id)?.values ?? {}) } as Record<string, PageRow["values"] extends infer V ? V extends Record<string, infer X> ? X : never : never>;
  if (!db.data) return <div className="mb-4 h-24" aria-hidden />;
  return (
    <div className="mb-6 border-b border-line pb-3">
      <p className="mb-2 text-[12.5px] text-fg-3">
        In{" "}
        <Link href={`/p/${db.data.database._id}`} className="underline decoration-line-strong underline-offset-2 hover:text-fg-2">
          {db.data.database.icon} {pageTitle(db.data.database.title)}
        </Link>
      </p>
      <dl className="grid gap-0.5">
        {props.map((p) => (
          <div key={p.id} className="grid grid-cols-[minmax(110px,160px)_1fr] items-start max-sm:grid-cols-[110px_1fr]">
            <dt>
              {readOnly ? (
                <span className="flex h-8 items-center gap-1.5 px-1.5 text-[13.5px] text-fg-3"><PropIcon type={p.type} /> {p.name}</span>
              ) : (
                <PropertyMenu
                  databaseId={record.databaseId!}
                  prop={p}
                  properties={db.data!.properties}
                  trigger={
                    <button type="button" className="flex h-8 w-full items-center gap-1.5 rounded-md px-1.5 text-start text-[13.5px] text-fg-3 hover:bg-hover">
                      <PropIcon type={p.type} />
                      <span className="truncate">{p.name}</span>
                    </button>
                  }
                />
              )}
            </dt>
            <dd className="min-w-0 rounded-md">
              <EditableValue
                prop={p}
                value={values[p.id]}
                record={record}
                databaseId={record.databaseId!}
                readOnly={readOnly}
                placeholder="Empty"
                className="rounded-md"
                onSave={(v) => ws.call("records.update", { id: record._id, values: { [p.id]: v } }).catch((e) => notifyError(e, "Couldn't save that value."))}
              />
            </dd>
          </div>
        ))}
      </dl>
      {!readOnly && (
        <AddProperty
          databaseId={record.databaseId!}
          trigger={
            <button type="button" className="mt-1 flex h-8 items-center gap-1.5 rounded-md px-1.5 text-[13.5px] text-fg-3 hover:bg-hover">
              <Plus className="size-3.5" /> Add a property
            </button>
          }
        />
      )}
    </div>
  );
}
