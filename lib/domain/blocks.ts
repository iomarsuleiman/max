/**
 * Server-safe helpers for the canonical document format (BlockNote JSON, as produced by the
 * editor). Used for search text, word counts, MCP block operations, and Markdown import/export.
 * These never run on every keystroke; the editor saves JSON as-is.
 */

import { PAGE_LINK_RE } from "../pageUrl";

export interface InlineText {
  type: "text";
  text: string;
  styles?: Record<string, boolean | string>;
}
export interface InlineLink {
  type: "link";
  href: string;
  content: InlineText[];
}
export interface InlineMention {
  type: "pageMention";
  props: { pageId: string; title?: string };
}
export type Inline = InlineText | InlineLink | InlineMention | { type: string; [k: string]: unknown };

export interface TableContent {
  type: "tableContent";
  columnWidths?: (number | null)[];
  headerRows?: number;
  rows: { cells: (Inline[] | { type: "tableCell"; content: Inline[]; props?: Record<string, unknown> })[] }[];
}

export interface Block {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content?: Inline[] | TableContent;
  children: Block[];
}

export const DOCUMENT_SCHEMA_VERSION = 1;
/** Hard cap for one page's serialized content (Convex documents are limited to 1 MiB). */
export const MAX_CONTENT_BYTES = 900_000;

export function parseContent(content: string | unknown): Block[] {
  if (Array.isArray(content)) return content as Block[];
  if (typeof content !== "string" || !content) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? (parsed as Block[]) : [];
  } catch {
    return [];
  }
}

export function* walk(blocks: Block[], depth = 0, parent: Block | null = null): Generator<{ block: Block; depth: number; parent: Block | null }> {
  for (const block of blocks) {
    yield { block, depth, parent };
    if (block.children?.length) yield* walk(block.children, depth + 1, block);
  }
}

export const cellInlines = (cell: TableContent["rows"][number]["cells"][number]): Inline[] =>
  Array.isArray(cell) ? cell : (cell?.content ?? []);

export function inlineText(items: Inline[] = []): string {
  return items
    .map((item) => {
      if (item.type === "text") return (item as InlineText).text;
      if (item.type === "link") return inlineText((item as InlineLink).content);
      if (item.type === "pageMention") return `@${(item as InlineMention).props.title ?? "page"}`;
      if (item.type === "dateMention") return `@${String((item as { props?: { date?: string } }).props?.date ?? "")}`;
      return "";
    })
    .join("");
}

export function blockText(block: Block): string {
  const c = block.content;
  if (c && !Array.isArray(c) && c.type === "tableContent") {
    return c.rows.map((r) => r.cells.map((cell) => inlineText(cellInlines(cell))).join(" | ")).join("\n");
  }
  if (Array.isArray(c)) return inlineText(c);
  const p = block.props ?? {};
  return [p.caption, p.alt, p.name, p.title, p.url && block.type === "embed" ? p.url : undefined]
    .filter((x): x is string => typeof x === "string" && !!x)
    .join(" — ");
}

export function documentText(blocks: Block[]): string {
  return [...walk(blocks)].map(({ block }) => blockText(block)).filter(Boolean).join("\n");
}

export function countWords(text: string): number {
  const words = text.trim().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return words ? words.length : 0;
}

/** Page ids referenced by mentions or internal links, for backlinks. */
export function referencedPageIds(blocks: Block[]): string[] {
  const ids = new Set<string>();
  const visitInline = (items: Inline[] = []) => {
    for (const item of items) {
      if (item.type === "pageMention") ids.add((item as InlineMention).props.pageId);
      if (item.type === "link") {
        const m = PAGE_LINK_RE.exec((item as InlineLink).href);
        if (m) ids.add(m[1]);
      }
    }
  };
  for (const { block } of walk(blocks)) {
    if (Array.isArray(block.content)) visitInline(block.content);
    else if (block.content?.type === "tableContent") block.content.rows.forEach((r) => r.cells.forEach((c) => visitInline(cellInlines(c))));
    if ((block.type === "pageLink" || block.type === "databaseView") && typeof block.props?.pageId === "string") ids.add(block.props.pageId);
    if (block.type === "databaseView" && typeof block.props?.databaseId === "string" && block.props.databaseId) ids.add(block.props.databaseId);
  }
  return [...ids];
}

/* ── Block-level operations (used by MCP; the editor performs the same edits in the UI) ── */

export function findBlock(blocks: Block[], id: string): { block: Block; siblings: Block[]; index: number; parent: Block | null } | null {
  const search = (list: Block[], parent: Block | null): ReturnType<typeof findBlock> => {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) return { block: list[i], siblings: list, index: i, parent };
      const hit = search(list[i].children ?? [], list[i]);
      if (hit) return hit;
    }
    return null;
  };
  return search(blocks, null);
}

export function newBlockId(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("");
}

/** Fills in ids/props/children so externally supplied blocks are valid editor blocks. */
export function normalizeBlocks(input: unknown[], seen = new Set<string>()): Block[] {
  return input.map((raw) => {
    const b = (raw ?? {}) as Partial<Block>;
    let id = typeof b.id === "string" && b.id && !seen.has(b.id) ? b.id : newBlockId();
    while (seen.has(id)) id = newBlockId();
    seen.add(id);
    const type = typeof b.type === "string" && b.type ? b.type : "paragraph";
    const content =
      b.content === undefined
        ? NO_INLINE_TYPES.has(type)
          ? undefined
          : []
        : typeof b.content === "string"
          ? [{ type: "text", text: b.content, styles: {} }]
          : b.content;
    return {
      id,
      type,
      props: { ...(DEFAULT_PROPS[type] ?? DEFAULT_PROPS.paragraph), ...(b.props ?? {}) },
      content: content as Block["content"],
      children: normalizeBlocks(Array.isArray(b.children) ? b.children : [], seen),
    };
  });
}

const TEXT_PROPS = { textColor: "default", backgroundColor: "default", textAlignment: "left" };
const NO_INLINE_TYPES = new Set(["image", "video", "audio", "file", "divider", "youtube", "pageLink", "diagram", "bookmark", "toc", "embed", "databaseView", "columnList", "column"]);
const DEFAULT_PROPS: Record<string, Record<string, unknown>> = {
  paragraph: TEXT_PROPS,
  heading: { ...TEXT_PROPS, level: 1, isToggleable: false },
  quote: { textColor: "default", backgroundColor: "default" },
  bulletListItem: TEXT_PROPS,
  numberedListItem: TEXT_PROPS,
  checkListItem: { ...TEXT_PROPS, checked: false },
  toggleListItem: TEXT_PROPS,
  codeBlock: { language: "text" },
  callout: { tone: "info" },
  equation: {},
  divider: {},
  table: { textColor: "default" },
  image: { textAlignment: "left", backgroundColor: "default", name: "", url: "", caption: "", showPreview: true, alt: "" },
  youtube: { videoId: "", url: "", start: 0, end: 0, caption: "", title: "" },
  diagram: { text: "" },
  pageLink: { pageId: "" },
  bookmark: { url: "", title: "" },
  toc: {},
  embed: { url: "" },
  databaseView: { databaseId: "" },
  columnList: {},
  column: { width: 1 },
  file: { backgroundColor: "default", name: "", url: "", caption: "" },
  video: { textAlignment: "left", backgroundColor: "default", name: "", url: "", caption: "", showPreview: true },
  audio: { backgroundColor: "default", name: "", url: "", caption: "", showPreview: true },
};

/* ── Markdown ────────────────────────────────────────────────────────────── */

const escapeMd = (s: string) => s.replace(/([\\`*_[\]])/g, "\\$1");

function inlineToMarkdown(items: Inline[] = [], resolveTitle?: (id: string) => string | undefined): string {
  return items
    .map((item) => {
      if (item.type === "text") {
        const t = item as InlineText;
        let s = t.styles?.code ? "`" + t.text + "`" : escapeMd(t.text);
        if (!t.text.trim()) return t.text;
        if (t.styles?.bold) s = `**${s}**`;
        if (t.styles?.italic) s = `*${s}*`;
        if (t.styles?.strike) s = `~~${s}~~`;
        return s;
      }
      if (item.type === "link") {
        const l = item as InlineLink;
        return `[${inlineToMarkdown(l.content)}](${l.href})`;
      }
      if (item.type === "pageMention") {
        const m = item as InlineMention;
        const title = resolveTitle?.(m.props.pageId) ?? m.props.title ?? "Untitled";
        return `[${escapeMd(title)}](/p/${m.props.pageId})`;
      }
      if (item.type === "dateMention") return `@${String((item as { props?: { date?: string } }).props?.date ?? "")}`;
      return "";
    })
    .join("");
}

export function blocksToMarkdown(blocks: Block[], resolveTitle?: (id: string) => string | undefined): string {
  const out: string[] = [];
  const render = (list: Block[], depth: number) => {
    let ordinal = 0;
    for (const block of list) {
      const indent = "  ".repeat(depth);
      const text = Array.isArray(block.content) ? inlineToMarkdown(block.content, resolveTitle) : "";
      ordinal = block.type === "numberedListItem" ? ordinal + 1 : 0;
      switch (block.type) {
        case "heading":
          out.push(`${"#".repeat(Math.min(6, Number(block.props.level) || 1))} ${text}`);
          break;
        case "bulletListItem":
          out.push(`${indent}- ${text}`);
          break;
        case "numberedListItem":
          out.push(`${indent}${ordinal}. ${text}`);
          break;
        case "checkListItem":
          out.push(`${indent}- [${block.props.checked ? "x" : " "}] ${text}`);
          break;
        case "toggleListItem":
          out.push(`${indent}- ${text}`);
          break;
        case "quote":
          out.push(`> ${text}`);
          break;
        case "callout":
          out.push(`> [!${String(block.props.tone ?? "info").toUpperCase()}]\n> ${text}`);
          break;
        case "codeBlock": {
          const code = Array.isArray(block.content) ? block.content.map((c) => (c as InlineText).text ?? "").join("") : "";
          out.push("```" + (block.props.language && block.props.language !== "text" ? block.props.language : "") + "\n" + code + "\n```");
          break;
        }
        case "equation": {
          const tex = Array.isArray(block.content) ? block.content.map((c) => (c as InlineText).text ?? "").join("") : "";
          out.push(`$$\n${tex}\n$$`);
          break;
        }
        case "diagram":
          out.push("```mermaid\n" + String(block.props.text ?? "") + "\n```");
          break;
        case "divider":
          out.push("---");
          break;
        case "image":
          out.push(`![${escapeMd(String(block.props.alt || block.props.caption || ""))}](${block.props.url})`);
          break;
        case "youtube":
          out.push(`https://www.youtube.com/watch?v=${block.props.videoId}`);
          break;
        case "embed":
        case "bookmark":
          if (block.props.url) out.push(`[${escapeMd(String(block.props.title || block.props.url))}](${block.props.url})`);
          break;
        case "file":
        case "video":
        case "audio":
          if (block.props.url) out.push(`[${escapeMd(String(block.props.name || block.type))}](${block.props.url})`);
          break;
        case "databaseView": {
          const id = String(block.props.databaseId);
          if (id) out.push(`[${escapeMd(resolveTitle?.(id) ?? "Database")}](/p/${id})`);
          break;
        }
        case "toc":
        case "columnList":
        case "column":
          break;
        case "pageLink": {
          const id = String(block.props.pageId);
          out.push(`[${escapeMd(resolveTitle?.(id) ?? "Untitled")}](/p/${id})`);
          break;
        }
        case "table": {
          const table = block.content as TableContent | undefined;
          if (table?.rows?.length) {
            const rows = table.rows.map((r) => "| " + r.cells.map((c) => inlineToMarkdown(cellInlines(c), resolveTitle).replace(/\|/g, "\\|")).join(" | ") + " |");
            const cols = table.rows[0].cells.length;
            rows.splice(1, 0, "| " + Array(cols).fill("---").join(" | ") + " |");
            out.push(rows.join("\n"));
          }
          break;
        }
        default:
          out.push(text);
      }
      const nested = ["bulletListItem", "numberedListItem", "checkListItem", "toggleListItem"].includes(block.type);
      if (block.children?.length) render(block.children, nested ? depth + 1 : depth);
    }
  };
  render(blocks, 0);
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|~~([^~]+)~~|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  const push = (text: string, styles: Record<string, boolean> = {}) => {
    if (text) out.push({ type: "text", text: text.replace(/\\([\\`*_[\]])/g, "$1"), styles });
  };
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index));
    if (m[2] !== undefined) push(m[2], { bold: true });
    else if (m[3] !== undefined) push(m[3], { italic: true });
    else if (m[4] !== undefined) push(m[4], { italic: true });
    else if (m[5] !== undefined) push(m[5], { strike: true });
    else if (m[6] !== undefined) out.push({ type: "text", text: m[6], styles: { code: true } });
    else if (m[7] !== undefined) {
      const internal = /^\/p\/([A-Za-z0-9_-]+)$/.exec(m[8]);
      if (internal) out.push({ type: "pageMention", props: { pageId: internal[1], title: m[7] } });
      else out.push({ type: "link", href: m[8], content: [{ type: "text", text: m[7], styles: {} }] });
    }
    last = m.index + m[0].length;
  }
  push(src.slice(last));
  return out;
}

/** Converts common Markdown into editor blocks. Unsupported syntax is kept as plain text. */
export function markdownToBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const root: Block[] = [];
  const listStack: { indent: number; block: Block }[] = [];
  const make = (type: string, props: Record<string, unknown> = {}, content?: Block["content"]): Block =>
    normalizeBlocks([{ type, props, content: content ?? (NO_INLINE_TYPES.has(type) ? undefined : []), children: [] }])[0];
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (paragraph.length) root.push(make("paragraph", {}, parseInline(paragraph.join(" "))));
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flushParagraph();
      listStack.length = 0;
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      if (fence[1] === "mermaid") root.push(make("diagram", { text: body.join("\n") }));
      else root.push(make("codeBlock", { language: fence[1] || "text" }, [{ type: "text", text: body.join("\n"), styles: {} }]));
      continue;
    }
    if (/^\$\$\s*$/.test(line)) {
      flushParagraph();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\$\$\s*$/.test(lines[i])) body.push(lines[i++]);
      root.push(make("equation", {}, [{ type: "text", text: body.join("\n"), styles: {} }]));
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      listStack.length = 0;
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      listStack.length = 0;
      root.push(make("heading", { level: Math.min(3, heading[1].length) }, parseInline(heading[2])));
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      listStack.length = 0;
      root.push(make("divider"));
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line);
    if (image) {
      flushParagraph();
      root.push(make("image", { url: image[2], alt: image[1], caption: "", name: image[1] }));
      continue;
    }
    if (/^\|.*\|\s*$/.test(line)) {
      flushParagraph();
      listStack.length = 0;
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        const cells = lines[i].trim().slice(1, -1).split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
        if (!cells.every((c) => /^:?-{3,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      const width = Math.max(...rows.map((r) => r.length));
      root.push(
        make("table", {}, {
          type: "tableContent",
          columnWidths: Array(width).fill(null),
          headerRows: 1,
          rows: rows.map((r) => ({ cells: Array.from({ length: width }, (_, k) => ({ type: "tableCell" as const, content: parseInline(r[k] ?? ""), props: {} })) })),
        }),
      );
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      listStack.length = 0;
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      i--;
      const callout = /^\[!(\w+)\]\s*$/.exec(body[0] ?? "");
      if (callout) {
        const tone = callout[1].toLowerCase();
        root.push(make("callout", { tone: ["info", "tip", "warning", "danger", "key"].includes(tone) ? tone : "info" }, parseInline(body.slice(1).join(" "))));
      } else root.push(make("quote", {}, parseInline(body.join(" "))));
      continue;
    }
    const item = /^(\s*)([-*+]|\d+[.)])\s+(\[( |x|X)\]\s+)?(.*)$/.exec(line);
    if (item) {
      flushParagraph();
      const indent = item[1].replace(/\t/g, "  ").length;
      const type = item[4] !== undefined ? "checkListItem" : /\d/.test(item[2]) ? "numberedListItem" : "bulletListItem";
      const block = make(type, type === "checkListItem" ? { checked: item[4].toLowerCase() === "x" } : {}, parseInline(item[5]));
      while (listStack.length && listStack[listStack.length - 1].indent >= indent) listStack.pop();
      if (listStack.length) listStack[listStack.length - 1].block.children.push(block);
      else root.push(block);
      listStack.push({ indent, block });
      continue;
    }
    listStack.length = 0;
    paragraph.push(line.trim());
  }
  flushParagraph();
  return root;
}
