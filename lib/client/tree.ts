import type { PageSummary } from "./types";
import { rankBetween } from "@/lib/domain/rank";

export interface FlatItem {
  id: string;
  parentId: string | null;
  depth: number;
  page: PageSummary;
  hasChildren: boolean;
  expanded: boolean;
}

export function childrenMap(pages: PageSummary[]): Map<string | null, PageSummary[]> {
  const map = new Map<string | null, PageSummary[]>();
  const ids = new Set(pages.map((p) => p._id));
  for (const p of pages) {
    const key = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  for (const list of map.values()) list.sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0));
  return map;
}

export function flatten(map: Map<string | null, PageSummary[]>, expanded: Set<string>, parentId: string | null = null, depth = 0, out: FlatItem[] = []): FlatItem[] {
  for (const page of map.get(parentId) ?? []) {
    const hasChildren = (map.get(page._id)?.length ?? 0) > 0;
    const open = expanded.has(page._id);
    out.push({ id: page._id, parentId, depth, page, hasChildren, expanded: open });
    if (open && hasChildren) flatten(map, expanded, page._id, depth + 1, out);
  }
  return out;
}

export function removeDescendants(items: FlatItem[], id: string): FlatItem[] {
  const out: FlatItem[] = [];
  let skipDepth: number | null = null;
  for (const item of items) {
    if (skipDepth !== null) {
      if (item.depth > skipDepth) continue;
      skipDepth = null;
    }
    if (item.id === id) skipDepth = item.depth;
    out.push(item);
  }
  return out;
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/** Where a dragged row would land: depth from the horizontal offset, clamped to valid nesting. */
export function projectDrop(items: FlatItem[], activeId: string, overId: string, offsetX: number, indent: number, dir: "ltr" | "rtl" = "ltr") {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  if (overIndex < 0 || activeIndex < 0) return null;
  const active = items[activeIndex];
  const moved = arrayMove(items, activeIndex, overIndex);
  const prev = moved[overIndex - 1];
  const next = moved[overIndex + 1];
  const dragDepth = Math.round((dir === "rtl" ? -offsetX : offsetX) / indent);
  const projected = active.depth + dragDepth;
  // Databases hold rows, not subpages.
  const maxDepth = prev ? (prev.page.kind === "database" ? prev.depth : prev.depth + 1) : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.max(minDepth, Math.min(projected, maxDepth));
  let parentId: string | null = null;
  if (depth > 0 && prev) {
    if (depth === prev.depth) parentId = prev.parentId;
    else if (depth > prev.depth) parentId = prev.id;
    else parentId = moved.slice(0, overIndex).reverse().find((i) => i.depth === depth)?.parentId ?? null;
  }
  // Index among the new siblings.
  let index = 0;
  for (let i = 0; i < overIndex; i++) {
    const it = moved[i];
    if (it.id !== activeId && it.parentId === parentId && it.depth === depth) index++;
  }
  return { depth, parentId, index };
}

/** Applies a pending move locally so the sidebar updates before the server confirms. */
export function applyMove(pages: PageSummary[], move: { id: string; parentId: string | null; index: number } | null): PageSummary[] {
  if (!move) return pages;
  const siblings = pages
    .filter((p) => p.parentId === move.parentId && p._id !== move.id)
    .sort((a, b) => (a.rank < b.rank ? -1 : 1));
  const rank = rankBetween(siblings[move.index - 1]?.rank ?? null, siblings[move.index]?.rank ?? null);
  return pages.map((p) => (p._id === move.id ? { ...p, parentId: move.parentId, rank } : p));
}

export function isDescendant(pages: PageSummary[], ancestorId: string, id: string | null): boolean {
  const byId = new Map(pages.map((p) => [p._id, p]));
  let cur = id ? byId.get(id) : undefined;
  let guard = 0;
  while (cur && guard++ < 100) {
    if (cur._id === ancestorId) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return false;
}
