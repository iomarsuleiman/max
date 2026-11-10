import type { Block, Inline, InlineText } from "../domain/blocks";
import type { PropertyType } from "../domain/types";
import { object, richText, text, type ImportWarning } from "./types";

export function convertInlines(value: unknown): Inline[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const r = object(raw);
    const a = r.annotations ? object(r.annotations) : {};
    const styles: Record<string, boolean | string> = {};
    for (const [from, to] of [
      ["bold", "bold"],
      ["italic", "italic"],
      ["strikethrough", "strike"],
      ["underline", "underline"],
      ["code", "code"],
    ])
      if (a[from] === true) styles[to] = true;
    if (typeof a.color === "string" && a.color !== "default")
      styles[a.color.endsWith("_background") ? "backgroundColor" : "textColor"] = a.color.replace("_background", "");
    const item: InlineText = { type: "text", text: text(r.plain_text) || (r.text ? text(object(r.text).content) : richText([r])), styles };
    const href = text(r.href) || (r.text && object(r.text).link ? text(object(object(r.text).link).url) : "");
    return /^https?:\/\//i.test(href) ? { type: "link", href, content: [item] } : item;
  });
}
export interface NotionBlock {
  raw: Record<string, unknown>;
  children: NotionBlock[];
}
export interface Media {
  blockId: string;
  url: string;
  name: string;
  kind: "image" | "file" | "audio" | "video";
}
export function convertBlocks(
  nodes: NotionBlock[],
  sourceId: string,
): { blocks: Block[]; warnings: ImportWarning[]; media: Media[]; childSources: { id: string; kind: "page" | "database" }[] } {
  const warnings: ImportWarning[] = [];
  const media: Media[] = [];
  const childSources: { id: string; kind: "page" | "database" }[] = [];
  const warn = (message: string) => warnings.push({ sourceId, message });
  const convert = (node: NotionBlock): Block => {
    const r = node.raw;
    const kind = text(r.type);
    const p = r[kind] ? object(r[kind]) : {};
    const b: Block = { id: text(r.id), type: "paragraph", props: {}, content: convertInlines(p.rich_text), children: [] };
    switch (kind) {
      case "paragraph":
        break;
      case "heading_1":
      case "heading_2":
      case "heading_3":
        b.type = "heading";
        b.props.level = Number(kind.slice(-1));
        break;
      case "bulleted_list_item":
        b.type = "bulletListItem";
        break;
      case "numbered_list_item":
        b.type = "numberedListItem";
        break;
      case "to_do":
        b.type = "checkListItem";
        b.props.checked = p.checked === true;
        break;
      case "quote":
        b.type = "quote";
        break;
      case "callout":
        b.type = "callout";
        b.props.icon = p.icon ? text(object(p.icon).emoji) || "💡" : "💡";
        break;
      case "toggle":
        b.type = "toggleListItem";
        break;
      case "divider":
        b.type = "divider";
        break;
      case "code":
        b.type = "codeBlock";
        b.props.language = text(p.language) || "text";
        b.content = [{ type: "text", text: richText(p.rich_text), styles: {} }];
        break;
      case "equation":
        b.type = "equation";
        b.content = [{ type: "text", text: text(p.expression) }];
        break;
      case "table":
        b.type = "table";
        b.content = {
          type: "tableContent",
          headerRows: p.has_column_header ? 1 : 0,
          rows: node.children
            .map((n) => ({ cells: (Array.isArray(object(n.raw.table_row).cells) ? object(n.raw.table_row).cells : []) as unknown[] }))
            .map((row) => ({ cells: row.cells.map(convertInlines) })),
        };
        return b;
      case "image":
      case "file":
      case "audio":
      case "video": {
        const f = p[p.type === "external" ? "external" : "file"];
        const url = f ? text(object(f).url) : "";
        const name = text(p.name) || richText(p.caption) || `Notion ${kind}`;
        if (url) media.push({ blockId: b.id, url, name, kind });
        // A durable asset replaces this fallback after download. Expiring URLs never enter content.
        b.content = [{ type: "text", text: `${name} (attachment unavailable; see import report)`, styles: {} }];
        break;
      }
      case "child_page":
      case "child_database": {
        childSources.push({ id: text(r.id), kind: kind === "child_page" ? "page" : "database" });
        b.content = [
          { type: "link", href: `https://www.notion.so/${text(r.id).replaceAll("-", "")}`, content: [{ type: "text", text: text(p.title) || "Notion page" }] },
        ];
        break;
      }
      case "bookmark":
      case "embed":
      case "link_preview": {
        const url = text(p.url);
        b.content = /^https?:\/\//i.test(url) ? [{ type: "link", href: url, content: [{ type: "text", text: richText(p.caption) || url }] }] : [];
        if (kind !== "bookmark") warn(`${kind} retained as an external link.`);
        break;
      }
      case "column_list":
      case "column":
        warn("Column layout converted to a linear reading order.");
        break;
      default:
        b.content = [{ type: "text", text: richText(p.rich_text) || `[Unsupported Notion block: ${kind}]` }];
        warn(`Unsupported ${kind} block retained as text where possible.`);
    }
    b.children = node.children.map(convert);
    return b;
  };
  return { blocks: nodes.map(convert), warnings, media, childSources };
}
export interface PropertyMapping {
  name: string;
  type: Exclude<PropertyType, "title">;
  options?: { name: string; color: "gray" }[];
}
export function convertProperties(raw: unknown): { properties: PropertyMapping[]; warnings: string[] } {
  const properties: PropertyMapping[] = [];
  const warnings: string[] = [];
  for (const [name, value] of Object.entries(object(raw))) {
    const p = object(value);
    const kind = text(p.type);
    if (kind === "title") continue;
    if (["rich_text", "number", "select", "multi_select", "status", "checkbox", "date", "url", "email", "phone_number"].includes(kind)) {
      const type = kind === "rich_text" ? "text" : kind === "phone_number" ? "phone" : kind;
      const parsed = propertyType(type);
      const config = p[kind] ? object(p[kind]) : {};
      const options = Array.isArray(config.options) ? config.options.map((o) => ({ name: text(object(o).name), color: "gray" as const })) : undefined;
      properties.push({ name, type: parsed, ...(options ? { options } : {}) });
      if (kind === "date") warnings.push(`${name}: date ranges/timezones are retained as text to avoid changing dates.`);
      if (kind === "date") properties[properties.length - 1].type = "text";
    } else {
      properties.push({ name, type: "text" });
      warnings.push(`${name}: ${kind} is imported as a static readable value; its behavior is not transferred.`);
    }
  }
  return { properties, warnings };
}
function propertyType(kind: string): PropertyMapping["type"] {
  switch (kind) {
    case "number":
    case "select":
    case "multi_select":
    case "status":
    case "checkbox":
    case "date":
    case "url":
    case "email":
    case "phone":
      return kind;
    default:
      return "text";
  }
}
export function convertValues(raw: unknown): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(object(raw))) {
    const p = object(value);
    const kind = text(p.type);
    const v = p[kind];
    switch (kind) {
      case "title":
        break;
      case "rich_text":
        values[name] = richText(v);
        break;
      case "number":
      case "checkbox":
      case "url":
      case "email":
      case "phone_number":
        values[name] = v ?? null;
        break;
      case "select":
      case "status":
        values[name] = v ? text(object(v).name) : null;
        break;
      case "multi_select":
        values[name] = Array.isArray(v) ? v.map((o) => text(object(o).name)) : [];
        break;
      case "date": {
        const d = v ? object(v) : {};
        values[name] = [text(d.start), text(d.end), text(d.time_zone)].filter(Boolean).join(" → ") || null;
        break;
      }
      default:
        values[name] = v === null || v === undefined ? null : JSON.stringify(v).slice(0, 9000);
    }
  }
  return values;
}
export function remapNotionLinks(blocks: Block[], mapping: Map<string, string>): Block[] {
  const normalized = new Map([...mapping].map(([k, v]) => [k.replaceAll("-", "").toLowerCase(), v]));
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") {
      const match = /^https:\/\/(?:www\.)?notion\.so\/(?:[^/?#]*-)?([a-f0-9]{32}|[a-f0-9-]{36})(?:[?#].*)?$/i.exec(value);
      const target = match ? normalized.get(match[1].replaceAll("-", "").toLowerCase()) : null;
      return target ? `/p/${target}` : value;
    }
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]));
    return value;
  };
  // The recursive transform preserves the canonical block shape.
  return rewrite(blocks) as Block[];
}
