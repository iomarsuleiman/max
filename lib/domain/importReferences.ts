import { pageIdFromParam } from "../pageUrl";
import type { Block, Inline } from "./blocks";
import type { PageRow } from "./types";

/** Remap references, never user-authored text or stable block/property IDs. */
export function remapDocumentReferences(blocks: Block[], ids: ReadonlyMap<string, string>): Block[] {
  const inline = (items: Inline[]): Inline[] => items.map((item) => {
    if (item.type === "pageMention" && typeof item.props === "object" && item.props !== null && "pageId" in item.props && typeof item.props.pageId === "string") {
      return { ...item, props: { ...item.props, pageId: ids.get(item.props.pageId) ?? item.props.pageId } };
    }
    if (item.type === "link" && typeof item.href === "string") {
      const match = /^\/p\/([^/?#]+)([?#].*)?$/.exec(item.href);
      if (!match) return item;
      const oldId = pageIdFromParam(match[1]);
      const newId = ids.get(oldId);
      if (!newId) return item;
      // Preserve readable slugs and anchors; absolute external URLs are untouched.
      const segment = match[1].endsWith(oldId) ? match[1].slice(0, -oldId.length) + newId : newId;
      return { ...item, href: `/p/${segment}${match[2] ?? ""}` };
    }
    return item;
  });
  return blocks.map((block) => {
    const props = { ...block.props };
    const key = block.type === "pageLink" ? "pageId" : block.type === "databaseView" ? "databaseId" : null;
    if (key && typeof props[key] === "string") props[key] = ids.get(props[key]) ?? props[key];
    let content = block.content;
    if (Array.isArray(content)) content = inline(content);
    else if (content?.type === "tableContent") {
      content = { ...content, rows: content.rows.map((row) => ({ ...row, cells: row.cells.map((cell) => Array.isArray(cell) ? inline(cell) : { ...cell, content: inline(cell.content) }) })) };
    }
    return { ...block, props, ...(content === undefined ? {} : { content }), children: remapDocumentReferences(block.children, ids) };
  });
}

export function remapDatabaseReferences(page: PageRow, database: PageRow | undefined, ids: ReadonlyMap<string, string>) {
  const properties = page.properties?.map((property) => property.type === "relation" && property.relationDatabaseId
    ? { ...property, relationDatabaseId: ids.get(property.relationDatabaseId) ?? property.relationDatabaseId }
    : property);
  const relationIds = new Set(database?.properties?.filter((p) => p.type === "relation").map((p) => p.id));
  const values = page.values && Object.fromEntries(Object.entries(page.values).map(([key, value]) => [key, !relationIds.has(key) ? value
    : Array.isArray(value) ? value.map((id) => ids.get(id) ?? id)
      : typeof value === "string" ? ids.get(value) ?? value : value]));
  const ownRelationIds = new Set(page.properties?.filter((p) => p.type === "relation").map((p) => p.id));
  const views = page.views?.map((view) => ({ ...view, filters: view.filters.map((filter) => ownRelationIds.has(filter.propertyId) && typeof filter.value === "string"
    ? { ...filter, value: ids.get(filter.value) ?? filter.value }
    : filter) }));
  return { properties, values, views };
}
