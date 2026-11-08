import type { DatabaseView, PageRow, PropertyDef } from "../types";

export function shortId(): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = new Uint8Array(8);
  globalThis.crypto.getRandomValues(buf);
  return Array.from(buf, (b) => a[b % a.length]).join("");
}

export const TITLE_PROPERTY_ID = "title";

export function defaultView(properties: PropertyDef[], name = "Table", type: DatabaseView["type"] = "table"): DatabaseView {
  return {
    id: shortId(),
    name,
    type,
    filters: [],
    sorts: [],
    hiddenPropertyIds: [],
    propertyOrder: properties.map((p) => p.id),
    columnWidths: {},
    groupByPropertyId: null,
  };
}

export function defaultDatabaseFields(): Pick<PageRow, "properties" | "views"> {
  const properties: PropertyDef[] = [
    { id: TITLE_PROPERTY_ID, name: "Name", type: "title" },
    {
      id: shortId(),
      name: "Status",
      type: "status",
      options: [
        { id: shortId(), name: "Not started", color: "gray" },
        { id: shortId(), name: "In progress", color: "blue" },
        { id: shortId(), name: "Done", color: "green" },
      ],
    },
    { id: shortId(), name: "Tags", type: "multi_select", options: [] },
    { id: shortId(), name: "Date", type: "date" },
  ];
  return { properties, views: [defaultView(properties)] };
}
