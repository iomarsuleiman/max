"use client";

import { insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { getDefaultReactSlashMenuItems, type DefaultReactSuggestionItem } from "@blocknote/react";
import { AppWindow, AtSign, FilePlus2, Globe, Lightbulb, Link2, ListTree, Network, PlayCircle, Sheet, Sigma } from "lucide-react";
import type { MaxEditorType } from "./blocks";

/**
 * The "/" menu (ported from the Chaos editor): BlockNote's commands grouped the way a writer scans
 * them, plus Max blocks, with fuzzy search over titles and aliases (English and Arabic keyboards).
 */

/** Every BlockNote block can be stored, including files, audio and video. */
export const UNSUPPORTED_SLASH_KEYS = new Set<string>();

type SlashGroup = "basic" | "headings" | "pages" | "media" | "advanced" | "other";
const ORDER: SlashGroup[] = ["basic", "pages", "headings", "media", "advanced", "other"];
const LABELS: Record<SlashGroup, string> = { basic: "Basic blocks", headings: "Headings", pages: "Pages", media: "Media", advanced: "Advanced", other: "Other" };

const defaultGroups: Record<string, SlashGroup> = {
  paragraph: "basic", bullet_list: "basic", numbered_list: "basic", check_list: "basic", toggle_list: "basic", quote: "basic", divider: "basic",
  heading: "headings", heading_2: "headings", heading_3: "headings", toggle_heading: "headings", toggle_heading_2: "headings", toggle_heading_3: "headings",
  image: "media", video: "media", audio: "media", file: "media",
  table: "advanced", code_block: "advanced",
  emoji: "other",
};

const defaultAliases: Record<string, string[]> = {
  paragraph: ["text", "plain", "نص", "فقرة"],
  heading: ["h1", "title", "عنوان"], heading_2: ["h2", "subtitle", "عنوان"], heading_3: ["h3", "عنوان"],
  bullet_list: ["ul", "bullets", "قائمة", "نقاط"], numbered_list: ["ol", "numbers", "قائمة", "مرقمة"],
  check_list: ["todo", "to-do", "task", "checkbox", "مهام", "مهمة"], toggle_list: ["collapse", "details", "طي"],
  quote: ["blockquote", "اقتباس"], divider: ["hr", "line", "separator", "فاصل", "خط"],
  code_block: ["code", "snippet", "كود"], table: ["grid", "جدول"], image: ["picture", "photo", "img", "صورة"],
  emoji: ["emoji", "إيموجي"],
};

/** Notion's order: the blocks people reach for most come first. */
const PREFERRED = ["paragraph", "check_list", "bullet_list", "numbered_list", "toggle_list", "quote", "callout", "divider", "two_columns", "three_columns", "page", "link_page", "database_inline", "database_linked", "heading", "heading_2", "heading_3", "toggle_heading", "toggle_heading_2", "toggle_heading_3", "image", "video", "audio", "file", "youtube", "embed", "bookmark", "table", "code_block", "toc", "equation", "diagram"];

export interface MaxSlashItem extends DefaultReactSuggestionItem {
  key: string;
  slashGroup: SlashGroup;
}

export function maxSlashItems(
  editor: MaxEditorType,
  columnItems: (DefaultReactSuggestionItem & { key?: string })[],
  actions: { createSubpage: () => void; linkPage: () => void; createDatabase: () => void; linkDatabase: () => void },
): MaxSlashItem[] {
  const base = (getDefaultReactSlashMenuItems(editor) as (DefaultReactSuggestionItem & { key: string })[])
    .filter((item) => !UNSUPPORTED_SLASH_KEYS.has(item.key))
    .map((item): MaxSlashItem => {
      const slashGroup = defaultGroups[item.key] ?? "other";
      return { ...item, slashGroup, group: LABELS[slashGroup], aliases: [...(item.aliases ?? []), ...(defaultAliases[item.key] ?? [])] };
    });
  const insert = (type: string) => () => {
    insertOrUpdateBlockForSlashMenu(editor, { type } as never);
  };
  const item = (key: string, slashGroup: SlashGroup, title: string, subtext: string, aliases: string[], icon: React.JSX.Element, onItemClick: () => void): MaxSlashItem => ({
    key, slashGroup, group: LABELS[slashGroup], title, subtext, aliases, icon, onItemClick,
  });
  const extra: MaxSlashItem[] = [
    item("page", "pages", "Page", "Create a page inside this one", ["subpage", "new page", "صفحة"], <FilePlus2 size={18} />, actions.createSubpage),
    item("link_page", "pages", "Link to page", "Link to another page (or type @)", ["mention", "reference", "@", "رابط"], <AtSign size={18} />, actions.linkPage),
    item("callout", "basic", "Callout", "Highlight a note, tip or warning", ["note", "tip", "warning", "info", "ملاحظة", "تنبيه"], <Lightbulb size={18} />, insert("callout")),
    item("toc", "advanced", "Table of contents", "Links to this page's headings", ["toc", "outline", "contents", "فهرس"], <ListTree size={18} />, insert("toc")),
    item("equation", "advanced", "Equation", "Math with LaTeX", ["math", "latex", "formula", "معادلة"], <Sigma size={18} />, insert("equation")),
    item("diagram", "advanced", "Diagram", "Flowcharts and more with Mermaid", ["mermaid", "flowchart", "chart", "graph", "مخطط"], <Network size={18} />, insert("diagram")),
    item("youtube", "media", "YouTube", "Embed a video, or just the useful part", ["video", "yt", "embed", "فيديو"], <PlayCircle size={18} />, insert("youtube")),
    item("bookmark", "media", "Web bookmark", "A card that links to a website", ["link", "url", "web", "رابط"], <Globe size={18} />, insert("bookmark")),
    item("embed", "media", "Embed", "Figma, Maps, Docs, Loom, Spotify and more", ["iframe", "figma", "maps", "loom", "vimeo", "spotify", "codepen", "تضمين"], <AppWindow size={18} />, insert("embed")),
    item("database_inline", "pages", "Database – inline", "A table, board or calendar inside this page", ["table", "database", "board", "قاعدة بيانات"], <Sheet size={18} />, actions.createDatabase),
    item("database_linked", "pages", "Linked view of database", "Show an existing database here", ["linked", "view", "database"], <Link2 size={18} />, actions.linkDatabase),
    ...columnItems.map((c, i) => {
      const n = /three|3/i.test(`${c.key ?? ""} ${c.title}`) ? 3 : 2;
      return { ...c, key: c.key ?? `columns_${i}`, slashGroup: "basic" as SlashGroup, group: LABELS.basic, aliases: [...(c.aliases ?? []), `${n} columns`, `${n} cols`, "columns", "layout", "side by side", "أعمدة"] };
    }),
  ];
  const all = [...base, ...extra];
  const rank = (k: string) => {
    const i = PREFERRED.indexOf(k);
    return i < 0 ? PREFERRED.length : i;
  };
  return ORDER.flatMap((group) => all.filter((i) => i.slashGroup === group).sort((a, b) => rank(a.key) - rank(b.key)));
}

/** Folds case, accents, Arabic diacritics/tatweel and common alef/yaa/taa-marbuta spellings. */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .toLowerCase()
    .trim();
}

function score(item: { title: string; aliases?: readonly string[] }, query: string): number | undefined {
  const title = normalizeSearch(item.title);
  if (title.startsWith(query)) return 0;
  if (title.split(/[\s/·-]+/).some((w) => w.startsWith(query))) return 1;
  const aliases = (item.aliases ?? []).map(normalizeSearch);
  if (aliases.some((a) => a.startsWith(query))) return 2;
  if (title.includes(query)) return 3;
  if (aliases.some((a) => a.includes(query))) return 4;
  return undefined;
}

/** Groups stay together, ordered by their best match. */
export function searchSlashItems<T extends { title: string; aliases?: readonly string[]; group?: string }>(items: T[], rawQuery: string): T[] {
  const query = normalizeSearch(rawQuery);
  if (!query) return items;
  const scored = items.map((item, index) => ({ item, index, score: score(item, query) })).filter((s): s is { item: T; index: number; score: number } => s.score !== undefined);
  const best = new Map<string | undefined, number>();
  for (const s of scored) best.set(s.item.group, Math.min(best.get(s.item.group) ?? Infinity, s.score));
  const groupOrder = [...best.keys()];
  return scored
    .sort((a, b) => best.get(a.item.group)! - best.get(b.item.group)! || groupOrder.indexOf(a.item.group) - groupOrder.indexOf(b.item.group) || a.score - b.score || a.index - b.index)
    .map((s) => s.item);
}
