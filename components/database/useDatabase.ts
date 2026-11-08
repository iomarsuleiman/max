"use client";

import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import { useOp } from "@/lib/client/data";
import type { DatabaseView, PageRow, PropertyDef } from "@/lib/domain/types";
import type { RecordView } from "@/lib/client/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";

export function orderedProperties(properties: PropertyDef[], view: DatabaseView | undefined, includeHidden = false): PropertyDef[] {
  const order = view?.propertyOrder ?? [];
  const sorted = [...properties].sort((a, b) => {
    if (a.type === "title") return -1;
    if (b.type === "title") return 1;
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
  });
  return includeHidden ? sorted : sorted.filter((p) => p.type === "title" || !view?.hiddenPropertyIds.includes(p.id));
}

/** Data and actions for one database view. */
export function useDatabase(database: PageRow, viewId: string | undefined, search: string, limit: number) {
  const ws = useWorkspace();
  const views = database.views ?? [];
  const view = views.find((v) => v.id === viewId) ?? views[0];
  const properties = useMemo(() => database.properties ?? [], [database.properties]);
  const q = useOp<{ records: RecordView[]; total: number; unfilteredTotal: number; nextCursor: number | null }>("databases.query", {
    databaseId: database._id,
    viewId: view?.id,
    search: search || undefined,
    limit,
  });

  const updateView = useCallback(
    async (patch: Partial<DatabaseView>) => {
      if (!view) return;
      try {
        await ws.call("views.update", { databaseId: database._id, viewId: view.id, patch });
      } catch (err) {
        notifyError(err, "Couldn't update the view.");
      }
    },
    [database._id, view, ws],
  );

  const createRecord = useCallback(
    async (values: Record<string, unknown> = {}, opts: { index?: number; open?: boolean; templateId?: string } = {}) => {
      try {
        if (opts.templateId) {
          const { id } = await ws.call<{ id: string }>("templates.apply", { templateId: opts.templateId });
          if (Object.keys(values).length) await ws.call("records.update", { id, values });
          return id;
        }
        const { record } = await ws.call<{ record: RecordView }>("records.create", { databaseId: database._id, values, index: opts.index });
        return record._id;
      } catch (err) {
        notifyError(err, "Couldn't add the row.");
        return null;
      }
    },
    [database._id, ws],
  );

  const updateRecord = useCallback(
    async (id: string, values: Record<string, unknown>) => {
      try {
        await ws.call("records.update", { id, values });
      } catch (err) {
        notifyError(err, "Couldn't save that value.");
      }
    },
    [ws],
  );

  const deleteRecords = useCallback(
    async (ids: string[]) => {
      try {
        await ws.call("records.delete", { ids });
        toast(`Moved ${ids.length} row${ids.length === 1 ? "" : "s"} to trash`, {
          action: { label: "Undo", onClick: () => Promise.all(ids.map((id) => ws.call("pages.restore", { id }))).then(() => toast.success("Restored")) },
        });
      } catch (err) {
        notifyError(err, "Couldn't delete the rows.");
      }
    },
    [ws],
  );

  return { view, views, properties, query: q, updateView, createRecord, updateRecord, deleteRecords };
}
