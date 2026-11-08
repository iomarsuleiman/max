"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, ChevronDown, Columns3, Copy, FileText, LayoutGrid, LayoutTemplate, List, MoreHorizontal, Pencil, Plus, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button, EmptyState, IconButton, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Skeleton, cn, confirmAction } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { readLocal, writeLocal } from "@/lib/client/storage";
import type { DatabaseView as View, PageRow, ViewType } from "@/lib/domain/types";
import type { PageSummary } from "@/lib/client/types";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { orderedProperties, useDatabase } from "./useDatabase";
import { TableView } from "./TableView";
import { BoardView, CalendarView, GalleryView, ListView } from "./OtherViews";
import { FilterButton, PropertiesButton, SearchBox, SortButton } from "./Toolbar";

const VIEW_ICON: Record<ViewType, typeof Table2> = { table: Table2, board: Columns3, list: List, gallery: LayoutGrid, calendar: Calendar };
const VIEW_LABEL: Record<ViewType, string> = { table: "Table", board: "Board", list: "List", gallery: "Gallery", calendar: "Calendar" };

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function DatabaseView({ database, readOnly }: { database: PageRow; readOnly: boolean }) {
  const ws = useWorkspace();
  const router = useRouter();
  const [viewId, setViewId] = useState<string | undefined>(() => readLocal<string | undefined>(`view:${database._id}`, undefined));
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const debounced = useDebounced(search.trim(), 200);
  const db = useDatabase(database, viewId, debounced, limit);
  const view = db.view;
  const templates = useOp<{ templates: PageSummary[] }>("templates.list", { databaseId: database._id });

  const selectView = (id: string) => {
    setViewId(id);
    writeLocal(`view:${database._id}`, id);
  };

  const props = useMemo(() => orderedProperties(db.properties, view), [db.properties, view]);
  const allProps = useMemo(() => orderedProperties(db.properties, view, true), [db.properties, view]);

  if (!view) return <p className="px-12 text-fg-3">This database has no views.</p>;

  const addView = async (type: ViewType) => {
    try {
      const { view: v } = await ws.call<{ view: View }>("views.create", { databaseId: database._id, name: VIEW_LABEL[type], type });
      selectView(v.id);
    } catch (err) {
      notifyError(err);
    }
  };
  const newRow = async (templateId?: string) => {
    const id = await db.createRecord({}, { templateId });
    if (id) router.push(`/p/${id}`);
  };

  const filtered = view.filters.length > 0 || !!debounced;
  const data = db.query.data;
  const common = {
    database,
    view,
    properties: props,
    records: data?.records ?? [],
    readOnly,
    onUpdate: db.updateRecord,
    onCreate: (values?: Record<string, unknown>, opts?: { index?: number }) => db.createRecord(values, opts),
    onUpdateView: db.updateView,
  };

  return (
    <section aria-label={`${pageTitle(database.title)} database`} className="pt-2">
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 sm:px-12">
        <div role="tablist" aria-label="Views" className="scroll-quiet -mb-px flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {db.views.map((v) => {
            const Icon = VIEW_ICON[v.type] ?? Table2;
            const active = v.id === view.id;
            return (
              <div key={v.id} className={cn("group/tab flex shrink-0 items-center border-b-2 border-transparent", active && "border-fg")}>
                <button type="button" role="tab" aria-selected={active} onClick={() => selectView(v.id)} className={cn("flex h-9 items-center gap-1.5 rounded-t px-2 text-[13.5px] text-fg-3 hover:text-fg-2", active && "font-medium text-fg")}>
                  <Icon className="size-3.5" />
                  {v.name}
                </button>
                {active && !readOnly && <ViewMenu database={database} view={v} canDelete={db.views.length > 1} onDeleted={() => selectView(db.views.find((x) => x.id !== v.id)!.id)} onDuplicate={async () => {
                  try {
                    const { view: nv } = await ws.call<{ view: View }>("views.create", { databaseId: database._id, name: `${v.name} (copy)`, type: v.type });
                    await ws.call("views.update", { databaseId: database._id, viewId: nv.id, patch: { filters: v.filters, sorts: v.sorts, hiddenPropertyIds: v.hiddenPropertyIds, propertyOrder: v.propertyOrder, groupByPropertyId: v.groupByPropertyId ?? null, datePropertyId: v.datePropertyId ?? null } });
                    selectView(nv.id);
                  } catch (err) {
                    notifyError(err);
                  }
                }} />}
              </div>
            );
          })}
          {!readOnly && (
            <Menu>
              <MenuTrigger asChild>
                <IconButton label="Add a view" className="ms-1 shrink-0">
                  <Plus className="size-4" />
                </IconButton>
              </MenuTrigger>
              <MenuContent>
                <MenuLabel>Add a view</MenuLabel>
                {(Object.keys(VIEW_LABEL) as ViewType[]).map((t) => {
                  const Icon = VIEW_ICON[t];
                  return (
                    <MenuItem key={t} icon={<Icon />} onSelect={() => addView(t)}>
                      {VIEW_LABEL[t]}
                    </MenuItem>
                  );
                })}
              </MenuContent>
            </Menu>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 py-1">
          <FilterButton view={view} properties={allProps} onChange={(filters) => db.updateView({ filters })} />
          <SortButton view={view} properties={allProps} onChange={(sorts) => db.updateView({ sorts })} />
          <SearchBox value={search} onChange={setSearch} />
          {(view.type === "table" || view.type === "gallery" || view.type === "list") && <PropertiesButton view={view} properties={allProps} onChange={(hiddenPropertyIds) => db.updateView({ hiddenPropertyIds })} />}
          {!readOnly && (
            <div className="ms-1 flex">
              <Button size="sm" variant="primary" className="rounded-e-none" onClick={() => newRow()}>
                New
              </Button>
              <Menu>
                <MenuTrigger asChild>
                  <Button size="sm" variant="primary" className="rounded-s-none border-s border-accent-fg/20 px-1.5" aria-label="New from template">
                    <ChevronDown className="size-3.5" />
                  </Button>
                </MenuTrigger>
                <MenuContent align="end" className="w-64">
                  <MenuLabel>Templates for {pageTitle(database.title)}</MenuLabel>
                  <MenuItem icon={<FileText />} onSelect={() => newRow()}>
                    Empty row
                  </MenuItem>
                  {templates.data?.templates.map((t) => (
                    <TemplateItem key={t._id} template={t} onUse={() => newRow(t._id)} />
                  ))}
                  <MenuSeparator />
                  <MenuItem
                    icon={<LayoutTemplate />}
                    onSelect={async () => {
                      try {
                        const { template } = await ws.call<{ template: { _id: string } }>("templates.create", { databaseId: database._id, title: "New template" });
                        router.push(`/p/${template._id}`);
                      } catch (err) {
                        notifyError(err);
                      }
                    }}
                  >
                    New template
                  </MenuItem>
                </MenuContent>
              </Menu>
            </div>
          )}
        </div>
      </div>
      {filtered && data && (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-2 text-[12.5px] text-fg-3 sm:px-12">
          Showing {data.total} of {data.unfilteredTotal} rows
          <button type="button" className="rounded px-1.5 py-0.5 text-accent-text hover:bg-hover" onClick={() => (setSearch(""), db.updateView({ filters: [] }))}>
            Clear filters and search
          </button>
        </div>
      )}
      <div className="pt-2">
        {db.query.error ? (
          <p className="px-4 py-6 text-[13px] text-danger sm:px-12">{db.query.error.message}</p>
        ) : !data ? (
          <div className="grid gap-2 px-4 py-3 sm:px-12">
            <Skeleton className="h-7" />
            <Skeleton className="h-7" />
            <Skeleton className="h-7 w-2/3" />
          </div>
        ) : data.unfilteredTotal === 0 && view.type !== "table" ? (
          <EmptyState title="No rows yet" body="Each row is also a page, with its own properties and content." className="py-10">
            {!readOnly && <Button variant="primary" onClick={() => newRow()}>Add the first row</Button>}
          </EmptyState>
        ) : data.total === 0 && filtered ? (
          <EmptyState title="No rows match" body="Try a different search, or change the filters for this view." className="py-10">
            <Button onClick={() => (setSearch(""), db.updateView({ filters: [] }))}>Clear filters and search</Button>
          </EmptyState>
        ) : (
          <>
            {view.type === "table" && <TableView {...common} onDelete={db.deleteRecords} canReorder={!view.sorts.length && !debounced} />}
            {view.type === "board" && <BoardView {...common} />}
            {view.type === "list" && <ListView {...common} />}
            {view.type === "gallery" && <GalleryView {...common} />}
            {view.type === "calendar" && <CalendarView {...common} />}
            {data.nextCursor !== null && (
              <div className="px-4 pt-3 sm:px-12">
                <Button size="sm" onClick={() => setLimit((l) => l + 100)}>
                  Load {Math.min(100, data.total - data.records.length)} more of {data.total - data.records.length} remaining
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function TemplateItem({ template, onUse }: { template: PageSummary; onUse: () => void }) {
  const router = useRouter();
  return (
    <div className="group flex items-center">
      <div className="min-w-0 flex-1">
        <MenuItem icon={template.icon ? <span>{template.icon}</span> : <LayoutTemplate />} onSelect={onUse}>
          {pageTitle(template.title)}
        </MenuItem>
      </div>
      <button type="button" aria-label={`Edit template ${pageTitle(template.title)}`} onClick={() => router.push(`/p/${template._id}`)} className="me-1 grid size-6 place-items-center rounded text-fg-3 hover:bg-hover">
        <Pencil className="size-3" />
      </button>
    </div>
  );
}

function ViewMenu({ database, view, canDelete, onDeleted, onDuplicate }: { database: PageRow; view: View; canDelete: boolean; onDeleted: () => void; onDuplicate: () => void }) {
  const ws = useWorkspace();
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="View options" size="xs" className="me-1">
          <MoreHorizontal className="size-3.5" />
        </IconButton>
      </MenuTrigger>
      <MenuContent>
        <MenuItem
          icon={<Pencil />}
          onSelect={() => {
            const name = window.prompt("Rename view", view.name);
            if (name?.trim()) ws.call("views.update", { databaseId: database._id, viewId: view.id, patch: { name: name.trim() } }).catch((e) => notifyError(e));
          }}
        >
          Rename view
        </MenuItem>
        <MenuLabel>Layout</MenuLabel>
        {(Object.keys(VIEW_LABEL) as ViewType[]).map((t) => {
          const Icon = VIEW_ICON[t];
          return (
            <MenuItem key={t} icon={<Icon />} hint={view.type === t ? "✓" : undefined} onSelect={() => ws.call("views.update", { databaseId: database._id, viewId: view.id, patch: { type: t } }).catch((e) => notifyError(e))}>
              {VIEW_LABEL[t]}
            </MenuItem>
          );
        })}
        <MenuSeparator />
        <MenuItem icon={<Copy />} onSelect={onDuplicate}>
          Duplicate view
        </MenuItem>
        <MenuItem
          icon={<Trash2 />}
          danger
          disabled={!canDelete}
          onSelect={async () => {
            const ok = await confirmAction({ title: `Delete the “${view.name}” view?`, body: <p>Rows aren&apos;t affected. Only this view&apos;s filters, sorts and layout are removed.</p>, confirmLabel: "Delete view", tone: "danger" });
            if (!ok) return;
            try {
              await ws.call("views.delete", { databaseId: database._id, viewId: view.id });
              onDeleted();
              toast.success("View deleted");
            } catch (err) {
              notifyError(err);
            }
          }}
        >
          Delete view
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
