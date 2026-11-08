/**
 * Input rules for the editor (adapted from the Chaos editor policy), applied where content enters
 * it: typing a link, uploading, pasting. The server validates again on save.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Links Max keeps: web, email, and internal page links (/p/<id>). */
export function safeLink(href: string): boolean {
  if (/^\/p\/[A-Za-z0-9_-]+(#[\w-]*)?$/.test(href)) return true;
  try {
    const url = new URL(href);
    if (url.username || url.password) return false;
    return url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

export function normalizeLink(raw: string): string | null {
  const href = raw.trim();
  if (!href) return null;
  if (safeLink(href)) return href;
  if (!SCHEME.test(href) && !href.startsWith("/") && !href.startsWith("#") && /^[^\s/?#]+\.[^\s/?#]+/.test(href)) {
    const withScheme = `https://${href}`;
    if (safeLink(withScheme)) return withScheme;
  }
  return null;
}

export const isLinkAllowed = (href: string): boolean => normalizeLink(href) !== null;

/* ── Uploads ──────────────────────────────────────────────────────────────── */

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"] as const;
export const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
export type UploadProblem = "empty" | "type" | "size";

export function checkImage(file: { type: string; size: number }): UploadProblem | null {
  if (!file.size) return "empty";
  if (!(IMAGE_TYPES as readonly string[]).includes(file.type.toLowerCase())) return "type";
  if (file.size > IMAGE_MAX_BYTES) return "size";
  return null;
}

export const uploadProblemCopy: Record<UploadProblem, (name: string) => string> = {
  empty: (name) => `“${name}” is empty. Choose the image file again.`,
  type: (name) => `“${name}” isn't a PNG, JPEG, WebP, GIF, AVIF or SVG image. Convert it and upload it again.`,
  size: (name) => `“${name}” is larger than 20 MB. Compress or resize it, then upload it again.`,
};

/* ── Content normalization before save ───────────────────────────────────── */

interface LinkLike { type: "link"; href: string; content: unknown[] }
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Bare addresses gain https://; links that can't be stored become their text. */
export function normalizeEditorLinks<T>(blocks: T[]): { blocks: T[]; removed: number } {
  let removed = 0;
  let changed = false;
  const inline = (items: unknown[]): unknown[] => {
    let local = false;
    const next = items.flatMap((item) => {
      if (!isRecord(item) || item.type !== "link") return [item];
      const link = item as unknown as LinkLike;
      const href = normalizeLink(String(link.href ?? ""));
      if (href === link.href) return [item];
      local = true;
      if (href) return [{ ...link, href }];
      removed++;
      return Array.isArray(link.content) ? link.content : [];
    });
    if (local) changed = true;
    return local ? next : items;
  };
  const visit = (list: unknown[]): unknown[] => {
    let local = false;
    const next = list.map((value) => {
      if (!isRecord(value)) return value;
      let block = value;
      if (Array.isArray(block.content)) {
        const content = inline(block.content);
        if (content !== block.content) block = { ...block, content };
      } else if (isRecord(block.content) && block.content.type === "tableContent" && Array.isArray(block.content.rows)) {
        const table = block.content as { rows: { cells: unknown[] }[] };
        let tableChanged = false;
        const rows = table.rows.map((row) => {
          const cells = row.cells.map((cell) => {
            if (Array.isArray(cell)) {
              const c = inline(cell);
              if (c !== cell) tableChanged = true;
              return c;
            }
            if (isRecord(cell) && Array.isArray(cell.content)) {
              const c = inline(cell.content);
              if (c !== cell.content) {
                tableChanged = true;
                return { ...cell, content: c };
              }
            }
            return cell;
          });
          return tableChanged ? { ...row, cells } : row;
        });
        if (tableChanged) block = { ...block, content: { ...block.content, rows } };
      }
      if (Array.isArray(block.children) && block.children.length) {
        const children = visit(block.children);
        if (children !== block.children) block = { ...block, children };
      }
      if (block !== value) local = true;
      return block;
    });
    return local ? next : list;
  };
  const result = visit(blocks) as T[];
  return { blocks: changed ? result : blocks, removed };
}

/* ── Clipboard HTML ───────────────────────────────────────────────────────── */

const DROP = new Set(["script", "style", "noscript", "template", "iframe", "frame", "frameset", "object", "embed", "applet", "form", "input", "button", "select", "textarea", "option", "meta", "link", "base", "title", "head", "svg", "math", "canvas", "audio", "video", "source", "track", "picture", "map", "area", "dialog", "xml"]);
const CELL_UNWRAP = new Set(["b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "mark", "code", "a", "span", "font", "sub", "sup", "small", "big", "p", "div", "br", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6"]);
const KEEP_ATTRS: Record<string, string[]> = { a: ["href"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], ol: ["start"], li: [], code: [], pre: [] };

export interface SanitizedClipboard { html: string; removedImages: number; removedMedia: number; removedLinks: number }

/**
 * Cleans HTML from other apps (browsers, Word, Google Docs, Notion) before the editor parses it:
 * scripts, styles, forms, embeds and Office markup go; event handlers, classes and inline styles
 * go; unsafe links become text. Remote images are left out (upload them so they stay private).
 */
export function sanitizeClipboardHtml(html: string, parser: DOMParser = new DOMParser()): SanitizedClipboard {
  const doc = parser.parseFromString(html, "text/html");
  let removedImages = 0, removedMedia = 0, removedLinks = 0;
  const walker = doc.createTreeWalker(doc.body, 0x80);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  for (const c of comments) c.parentNode?.removeChild(c);
  const unwrap = (el: Element) => el.replaceWith(...Array.from(el.childNodes));
  const visit = (el: Element, inCell: boolean) => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag.includes(":")) {
        if (tag === "o:p") child.remove();
        else {
          visit(child, inCell);
          unwrap(child);
        }
        continue;
      }
      if (tag === "img") {
        removedImages++;
        child.remove();
        continue;
      }
      if (tag === "video" || tag === "audio" || tag === "iframe" || tag === "embed" || tag === "object") {
        removedMedia++;
        child.remove();
        continue;
      }
      if (DROP.has(tag)) {
        child.remove();
        continue;
      }
      const cell = inCell || tag === "td" || tag === "th";
      visit(child, cell);
      if (tag === "a") {
        const href = normalizeLink(child.getAttribute("href") ?? "");
        if (!href) {
          if (child.hasAttribute("href")) removedLinks++;
          unwrap(child);
          continue;
        }
        child.setAttribute("href", href);
      }
      if (inCell && CELL_UNWRAP.has(tag)) {
        if (tag === "br" || tag === "p" || tag === "div" || tag === "li") child.after(doc.createTextNode(" "));
        unwrap(child);
        continue;
      }
      const keep = KEEP_ATTRS[tag] ?? [];
      for (const attr of Array.from(child.attributes)) if (!keep.includes(attr.name.toLowerCase())) child.removeAttribute(attr.name);
    }
  };
  visit(doc.body, false);
  return { html: doc.body.innerHTML, removedImages, removedMedia, removedLinks };
}

export const isBlockNoteClipboard = (types: readonly string[]) => types.includes("blocknote/html");

/* ── YouTube ─────────────────────────────────────────────────────────────── */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

export function parseYouTube(input: string): { id: string; start?: number } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else id = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  if (!id || !YT_ID.test(id)) return null;
  const t = url.searchParams.get("t") ?? url.searchParams.get("start");
  const start = t ? parseTimestamp(t) : null;
  return start ? { id, start } : { id };
}

export function parseTimestamp(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (/^\d+$/.test(v)) return Number(v);
  if (/^\d+(:\d{1,2}){1,2}$/.test(v)) {
    const parts = v.split(":").map(Number);
    if (parts.slice(1).some((n) => n > 59)) return null;
    return parts.reduce((total, n) => total * 60 + n, 0);
  }
  const m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return null;
}

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function youTubeEmbedUrl(id: string, start?: number, end?: number): string {
  const params = new URLSearchParams({ rel: "0", modestbranding: "1", playsinline: "1" });
  if (start) params.set("start", String(Math.floor(start)));
  if (end && (!start || end > start)) params.set("end", String(Math.floor(end)));
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`;
}
