import { z } from "zod";
import { parseContent, referencedPageIds } from "../blocks";
import type { PageRow } from "../types";
import { defineOp } from "./define";
import { allPages, requirePage, templateMembers } from "./helpers";

export interface GraphNode {
  id: string;
  title: string;
  icon: string | null;
  kind: PageRow["kind"] | "row";
  /** Links in plus links out, used for node size. */
  degree: number;
  createdAt: number;
  /** Hops from the focus page in a local graph; 0 is the focus page itself. */
  depth?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  /** "link": a mention or link in the content. "parent": a sub-page or database row. */
  type: "link" | "parent";
}

const MAX_NODES = 5_000;

export const graphGet = defineOp({
  name: "graph.get",
  kind: "query",
  title: "Get the page graph",
  description:
    "Returns pages as nodes and their connections as edges: links and mentions in content (type link) and sub-page or database-row nesting (type parent). Pass pageId for a local graph around one page, with depth as the number of hops (1 to 4). Trashed pages and templates are left out.",
  input: z.object({
    pageId: z.string().min(1).optional(),
    depth: z.number().int().min(1).max(4).optional(),
    includeRows: z.boolean().optional(),
  }),
  async run(ctx, { pageId, depth = 1, includeRows = true }) {
    if (pageId) await requirePage(ctx, pageId, { allowArchived: true });
    const [pages, docs] = await Promise.all([allPages(ctx), ctx.db.list("documents", ctx.ownerId)]);
    const hidden = templateMembers(pages);
    const live = new Map(
      pages.filter((p) => !p.archivedAt && !hidden.has(p._id) && (includeRows || !p.databaseId || p._id === pageId)).map((p) => [p._id, p]),
    );

    const edges: GraphEdge[] = [];
    const seen = new Set<string>();
    const add = (source: string, target: string, type: GraphEdge["type"]) => {
      if (source === target || !live.has(source) || !live.has(target)) return;
      const key = `${type}:${source}:${target}`;
      if (seen.has(key)) return;
      seen.add(key);
      edges.push({ source, target, type });
    };
    for (const p of live.values()) {
      const up = p.parentId ?? p.databaseId;
      if (up) add(up, p._id, "parent");
    }
    for (const d of docs) {
      if (!live.has(d.pageId) || !d.content.includes("pageId") && !d.content.includes("/p/")) continue;
      for (const target of referencedPageIds(parseContent(d.content))) add(d.pageId, target, "link");
    }

    let ids = new Set(live.keys());
    const depthOf = new Map<string, number>();
    if (pageId && live.has(pageId)) {
      const adj = new Map<string, string[]>();
      for (const e of edges) {
        (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
        (adj.get(e.target) ?? adj.set(e.target, []).get(e.target)!).push(e.source);
      }
      depthOf.set(pageId, 0);
      let frontier = [pageId];
      for (let hop = 1; hop <= depth; hop++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const n of adj.get(id) ?? []) {
            if (depthOf.has(n)) continue;
            depthOf.set(n, hop);
            next.push(n);
          }
        }
        frontier = next;
      }
      ids = new Set(depthOf.keys());
    }

    const kept = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    const degree = new Map<string, number>();
    for (const e of kept) {
      degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
      degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
    }
    const nodes: GraphNode[] = [...ids].slice(0, MAX_NODES).map((id) => {
      const p = live.get(id)!;
      return { id, title: p.title, icon: p.icon, kind: p.databaseId ? ("row" as const) : p.kind, createdAt: p.createdAt, degree: degree.get(id) ?? 0, ...(depthOf.size ? { depth: depthOf.get(id) } : {}) };
    });
    return { nodes, edges: kept, truncated: ids.size > MAX_NODES };
  },
});
