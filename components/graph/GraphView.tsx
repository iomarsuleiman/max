"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { List, Maximize2, Pause, Play, RotateCcw, Settings2, X } from "lucide-react";
import { IconButton, Input, Switch, cn } from "@/components/ui";
import { useOp } from "@/lib/client/data";
import { pageTitle } from "@/lib/client/format";
import { readLocal, writeLocal } from "@/lib/client/storage";
import { useWorkspace } from "@/components/workspace/context";
import { PageIcon } from "@/components/workspace/PageIcon";

interface ApiNode {
  id: string;
  title: string;
  icon: string | null;
  kind: "page" | "database" | "row";
  degree: number;
  createdAt: number;
  depth?: number;
}
interface ApiEdge {
  source: string;
  target: string;
  type: "link" | "parent";
}
interface Node extends SimulationNodeDatum, ApiNode {
  r: number;
  /** 0 → hidden, 1 → fully grown; drives the pop-in animation. */
  grow: number;
  appearAt: number;
}
interface Edge extends SimulationLinkDatum<Node> {
  type: ApiEdge["type"];
}

export interface GraphSettings {
  search: string;
  orphans: boolean;
  rows: boolean;
  hierarchy: boolean;
  arrows: boolean;
  labels: number; // zoom level where labels fade in
  nodeSize: number;
  linkWidth: number;
  center: number;
  repel: number;
  linkStrength: number;
  linkDistance: number;
  depth: number;
}

const DEFAULTS: GraphSettings = {
  search: "",
  orphans: true,
  rows: true,
  hierarchy: true,
  arrows: false,
  labels: 0.9,
  nodeSize: 1,
  linkWidth: 1,
  center: 0.5,
  repel: 10,
  linkStrength: 1,
  linkDistance: 60,
  depth: 1,
};

const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const POP_MS = 420;

function cssVar(el: Element, name: string, fallback: string) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * Obsidian-style graph of pages. Global when `pageId` is unset; a local graph around that page otherwise.
 * Canvas rendering keeps thousands of nodes smooth; a hidden list mirrors the nodes for keyboard and screen-reader use.
 */
export function GraphView({ pageId, compact, className }: { pageId?: string; compact?: boolean; className?: string }) {
  const ws = useWorkspace();
  const storeKey = pageId ? "graph-local" : "graph-global";
  const [settings, setSettings] = useState<GraphSettings>(() => ({ ...DEFAULTS, ...(readLocal<Partial<GraphSettings>>(storeKey, {})), search: "" }));
  const set = useCallback(
    (patch: Partial<GraphSettings>) =>
      setSettings((s) => {
        const next = { ...s, ...patch };
        const { search: _s, ...persist } = next;
        void _s;
        writeLocal(storeKey, persist);
        return next;
      }),
    [storeKey],
  );
  const [panelOpen, setPanelOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const q = useOp<{ nodes: ApiNode[]; edges: ApiEdge[]; truncated: boolean }>("graph.get", pageId ? { pageId, depth: settings.depth } : {});

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const simRef = useRef<Simulation<Node, Edge> | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const viewRef = useRef({ x: 0, y: 0, k: 1 });
  /** Where the view is easing to (fit to screen); null when idle. */
  const viewTargetRef = useRef<{ x: number; y: number; k: number } | null>(null);
  const fitPendingRef = useRef(true);
  const hoverRef = useRef<Node | null>(null);
  const dragRef = useRef<{ node: Node | null; startX: number; startY: number; moved: boolean; panX: number; panY: number } | null>(null);
  const frameRef = useRef(0);
  const dirtyRef = useRef(true);
  const playRef = useRef<{ start: number; duration: number } | null>(null);
  const [hover, setHover] = useState<{ node: ApiNode; x: number; y: number; links: number; maxX: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const reduceMotion = useMemo(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, []);

  // Filtered data → simulation nodes (positions are kept across refetches so the graph doesn't jump).
  const filtered = useMemo(() => {
    const data = q.data;
    if (!data) return null;
    const term = settings.search.trim().toLowerCase();
    let nodes = data.nodes.filter((n) => settings.rows || n.kind !== "row" || n.id === pageId);
    let ids = new Set(nodes.map((n) => n.id));
    let edges = data.edges.filter((e) => (settings.hierarchy || e.type === "link") && ids.has(e.source) && ids.has(e.target));
    if (!settings.orphans) {
      const linked = new Set(edges.flatMap((e) => [e.source, e.target]));
      nodes = nodes.filter((n) => linked.has(n.id) || n.id === pageId);
    }
    if (term) nodes = nodes.filter((n) => pageTitle(n.title).toLowerCase().includes(term) || n.id === pageId);
    ids = new Set(nodes.map((n) => n.id));
    edges = edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    return { nodes, edges, truncated: data.truncated };
  }, [q.data, settings.search, settings.rows, settings.hierarchy, settings.orphans, pageId]);

  const neighbors = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const e of filtered?.edges ?? []) {
      (m.get(e.source) ?? m.set(e.source, new Set()).get(e.source)!).add(e.target);
      (m.get(e.target) ?? m.set(e.target, new Set()).get(e.target)!).add(e.source);
    }
    return m;
  }, [filtered]);

  const radius = useCallback((n: ApiNode) => Math.min(9, 2 + Math.sqrt(n.degree) * 0.9) * settings.nodeSize * (n.kind === "row" ? 0.8 : 1), [settings.nodeSize]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const colors = {
      bg: cssVar(canvas, "--bg-graph", "transparent"),
      node: cssVar(canvas, "--fg-3", "#888"),
      text: cssVar(canvas, "--fg", "#222"),
      line: cssVar(canvas, "--line-strong", "#ccc"),
      accent: cssVar(canvas, "--accent", "#7c5cff"),
      db: cssVar(canvas, "--icon-blue", "#2f80ed"),
      row: cssVar(canvas, "--icon-gray", "#999"),
      surface: cssVar(canvas, "--surface", "#fff"),
    };
    let easing = false;
    const target = viewTargetRef.current;
    if (target) {
      const v = viewRef.current;
      const f = reduceMotion ? 1 : 0.18;
      v.x += (target.x - v.x) * f;
      v.y += (target.y - v.y) * f;
      v.k += (target.k - v.k) * f;
      if (Math.abs(target.k - v.k) < 0.002 && Math.abs(target.x - v.x) < 0.5 && Math.abs(target.y - v.y) < 0.5) {
        Object.assign(v, target);
        viewTargetRef.current = null;
      } else easing = true;
    }
    const { x, y, k } = viewRef.current;
    const now = performance.now();
    const play = playRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.translate(w / 2 + x, h / 2 + y);
    ctx.scale(k, k);

    let animating = false;
    for (const n of nodesRef.current) {
      const target = play ? (now >= play.start + n.appearAt ? 1 : 0) : 1;
      if (target === 1 && n.grow < 1) {
        const started = play ? play.start + n.appearAt : now - POP_MS;
        const t = Math.min(1, (now - started) / POP_MS);
        n.grow = reduceMotion ? 1 : t >= 1 ? 1 : Math.max(0.001, t);
        animating = animating || n.grow < 1;
      } else if (target === 0) {
        n.grow = 0;
        animating = true;
      }
    }

    const hovered = hoverRef.current;
    const near = hovered ? neighbors.get(hovered.id) : null;
    const isLit = (id: string) => !hovered || id === hovered.id || !!near?.has(id);
    const visible = (n: Node) => n.grow > 0;

    // Links.
    ctx.lineCap = "round";
    for (const e of edgesRef.current) {
      const s = e.source as Node;
      const t = e.target as Node;
      if (!visible(s) || !visible(t) || s.x == null || t.x == null) continue;
      const lit = hovered && (s.id === hovered.id || t.id === hovered.id);
      ctx.globalAlpha = (hovered ? (lit ? 0.95 : 0.12) : e.type === "parent" ? 0.45 : 0.7) * Math.min(s.grow, t.grow);
      ctx.strokeStyle = lit ? colors.accent : colors.line;
      ctx.lineWidth = (lit ? 1.6 : 1) * settings.linkWidth / Math.max(0.6, k);
      ctx.setLineDash(e.type === "parent" ? [3 / k, 3 / k] : []);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y!);
      ctx.lineTo(t.x, t.y!);
      ctx.stroke();
      if (settings.arrows && e.type === "link") {
        const ang = Math.atan2(t.y! - s.y!, t.x - s.x);
        const tr = t.r * easeOutBack(t.grow) + 2;
        const ax = t.x - Math.cos(ang) * tr;
        const ay = t.y! - Math.sin(ang) * tr;
        const size = 5 / Math.max(0.7, k);
        ctx.setLineDash([]);
        ctx.fillStyle = lit ? colors.accent : colors.line;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax - size * Math.cos(ang - 0.45), ay - size * Math.sin(ang - 0.45));
        ctx.lineTo(ax - size * Math.cos(ang + 0.45), ay - size * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.setLineDash([]);

    // Nodes.
    for (const n of nodesRef.current) {
      if (!visible(n) || n.x == null) continue;
      const scale = easeOutBack(n.grow);
      const r = Math.max(0.5, n.r * scale);
      const focus = n.id === pageId || n.id === ws.activePageId;
      ctx.globalAlpha = isLit(n.id) ? 1 : 0.2;
      ctx.fillStyle = hovered?.id === n.id || focus ? colors.accent : n.kind === "database" ? colors.db : n.kind === "row" ? colors.row : colors.node;
      ctx.beginPath();
      ctx.arc(n.x, n.y!, r, 0, Math.PI * 2);
      ctx.fill();
      if (focus) {
        ctx.strokeStyle = colors.accent;
        ctx.lineWidth = 1.5 / k;
        ctx.beginPath();
        ctx.arc(n.x, n.y!, r + 2 / k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Labels fade in with zoom; hovered and neighbor labels always show.
    const fade = Math.max(0, Math.min(1, (k - settings.labels) / 0.35));
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `${Math.round(12 / k * 100) / 100}px Inter, system-ui, sans-serif`;
    for (const n of nodesRef.current) {
      if (!visible(n) || n.x == null) continue;
      const strong = hovered && isLit(n.id);
      const alpha = strong ? 1 : hovered ? fade * 0.15 : fade * Math.min(1, n.grow * 1.4);
      if (alpha < 0.02) continue;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = colors.text;
      const label = pageTitle(n.title);
      ctx.fillText(label.length > 40 ? `${label.slice(0, 38)}…` : label, n.x, n.y! + n.r * easeOutBack(n.grow) + 4 / k);
    }
    ctx.globalAlpha = 1;
    dirtyRef.current = animating || easing;
    if (play && now > play.start + play.duration + POP_MS) {
      playRef.current = null;
      setPlaying(false);
    }
  }, [neighbors, pageId, reduceMotion, settings.arrows, settings.labels, settings.linkWidth, ws.activePageId]);

  const loop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    const tick = () => {
      draw();
      const sim = simRef.current;
      if (dirtyRef.current || (sim && sim.alpha() > sim.alphaMin()) || playRef.current) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
  }, [draw]);
  const redraw = useCallback(() => {
    dirtyRef.current = true;
    loop();
  }, [loop]);

  // Build or update the simulation when data changes.
  useEffect(() => {
    if (!filtered) return;
    const prev = new Map(nodesRef.current.map((n) => [n.id, n]));
    const order = [...filtered.nodes].sort((a, b) => a.createdAt - b.createdAt);
    const rank = new Map(order.map((n, i) => [n.id, i]));
    const nodes: Node[] = filtered.nodes.map((n) => {
      const old = prev.get(n.id);
      const angle = Math.random() * Math.PI * 2;
      const dist = 40 + Math.random() * 120;
      return Object.assign(old ?? { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist, grow: 0 }, n, { r: radius(n), appearAt: rank.get(n.id)! });
    });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const edges: Edge[] = filtered.edges.map((e) => ({ source: byId.get(e.source)!, target: byId.get(e.target)!, type: e.type }));
    nodesRef.current = nodes;
    edgesRef.current = edges;
    if (hoverRef.current && !byId.has(hoverRef.current.id)) hoverRef.current = null;

    const sim = simRef.current ?? forceSimulation<Node, Edge>().alphaDecay(0.028).velocityDecay(0.38);
    simRef.current = sim;
    sim.nodes(nodes);
    if (!prev.size) fitPendingRef.current = true;
    sim.on("tick", () => {
      dirtyRef.current = true;
      if (fitPendingRef.current && sim.alpha() < 0.12) {
        fitPendingRef.current = false;
        fitRef.current();
      }
    });
    sim.alpha(prev.size ? 0.35 : 1).restart();
    if (reduceMotion && !prev.size) {
      sim.stop();
      sim.tick(220);
    }
    redraw();
    // forces are applied in the next effect
    return undefined;
  }, [filtered, radius, redraw, reduceMotion]);

  // Forces follow the sliders.
  useEffect(() => {
    const sim = simRef.current;
    if (!sim) return;
    const edges = edgesRef.current;
    sim
      .force("charge", forceManyBody<Node>().strength(-settings.repel * 9).distanceMax(600))
      .force("link", forceLink<Node, Edge>(edges).id((n) => n.id).distance((e) => settings.linkDistance + (e.type === "parent" ? 10 : 0)).strength(() => 0.5 * settings.linkStrength))
      .force("collide", forceCollide<Node>().radius((n) => n.r + 2))
      .force("x", forceX<Node>(0).strength(0.04 * settings.center))
      .force("y", forceY<Node>(0).strength(0.04 * settings.center))
      .force("center", forceCenter(0, 0).strength(0.05));
    for (const n of nodesRef.current) n.r = radius(n);
    sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
    loop();
  }, [filtered, settings.repel, settings.linkDistance, settings.linkStrength, settings.center, radius, loop]);

  useEffect(() => redraw(), [settings.arrows, settings.labels, settings.linkWidth, ws.activePageId, redraw]);

  useEffect(
    () => () => {
      cancelAnimationFrame(frameRef.current);
      simRef.current?.stop();
    },
    [],
  );

  // Redraw on resize and when the theme flips.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(el);
    const mo = new MutationObserver(() => redraw());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "style"] });
    return () => (ro.disconnect(), mo.disconnect());
  }, [redraw]);

  const toWorld = (clientX: number, clientY: number) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const { x, y, k } = viewRef.current;
    return { wx: (clientX - rect.left - rect.width / 2 - x) / k, wy: (clientY - rect.top - rect.height / 2 - y) / k, sx: clientX - rect.left, sy: clientY - rect.top };
  };
  const hit = (clientX: number, clientY: number) => {
    const { wx, wy } = toWorld(clientX, clientY);
    const k = viewRef.current.k;
    let best: Node | null = null;
    let bestD = Infinity;
    for (const n of nodesRef.current) {
      if (n.x == null || n.grow <= 0) continue;
      const d = Math.hypot(n.x - wx, n.y! - wy);
      if (d < Math.max(n.r + 3, 8 / k) && d < bestD) (best = n), (bestD = d);
    }
    return best;
  };

  const setHovered = (n: Node | null, clientX = 0, clientY = 0) => {
    if (hoverRef.current?.id !== n?.id) {
      hoverRef.current = n;
      redraw();
    }
    if (n) {
      const { sx, sy } = toWorld(clientX, clientY);
      setHover({ node: n, x: sx, y: sy, links: neighbors.get(n.id)?.size ?? 0, maxX: (wrapRef.current?.clientWidth ?? 400) - 250 });
    } else setHover(null);
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; k: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: viewRef.current.k };
      dragRef.current = null;
      return;
    }
    viewTargetRef.current = null;
    const node = hit(e.clientX, e.clientY);
    dragRef.current = { node, startX: e.clientX, startY: e.clientY, moved: false, panX: viewRef.current.x, panY: viewRef.current.y };
    if (node) {
      node.fx = node.x;
      node.fy = node.y;
      simRef.current?.alphaTarget(0.25).restart();
      loop();
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      viewRef.current.k = clampZoom((pinch.current.k * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d);
      redraw();
      return;
    }
    const drag = dragRef.current;
    if (!drag) {
      if (e.pointerType === "mouse") setHovered(hit(e.clientX, e.clientY), e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
    if (!drag.moved) return;
    if (drag.node) {
      const { wx, wy } = toWorld(e.clientX, e.clientY);
      drag.node.fx = wx;
      drag.node.fy = wy;
      setHovered(drag.node, e.clientX, e.clientY);
    } else {
      viewRef.current.x = drag.panX + dx;
      viewRef.current.y = drag.panY + dy;
      setHover(null);
      redraw();
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.node) {
      drag.node.fx = null;
      drag.node.fy = null;
      simRef.current?.alphaTarget(0);
      if (!drag.moved) ws.openPage(drag.node.id, { mode: "side", list: nodesRef.current.map((n) => n.id), event: e });
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    const { sx, sy } = toWorld(e.clientX, e.clientY);
    const rect = canvasRef.current!.getBoundingClientRect();
    viewTargetRef.current = null;
    const v = viewRef.current;
    const next = clampZoom(v.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)));
    // Zoom around the cursor.
    const cx = sx - rect.width / 2;
    const cy = sy - rect.height / 2;
    v.x = cx - ((cx - v.x) * next) / v.k;
    v.y = cy - ((cy - v.y) * next) / v.k;
    v.k = next;
    setHover(null);
    redraw();
  };
  // React's wheel listener is passive; block page scroll natively.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", stop, { passive: false });
    return () => el.removeEventListener("wheel", stop);
  }, []);

  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    const nodes = nodesRef.current.filter((n) => n.x != null);
    if (!canvas || !nodes.length) return;
    const xs = nodes.map((n) => n.x!);
    const ys = nodes.map((n) => n.y!);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = clampZoom(Math.min(canvas.clientWidth / (maxX - minX + 160), canvas.clientHeight / (maxY - minY + 160), 1.3));
    viewTargetRef.current = { k, x: (-(minX + maxX) / 2) * k, y: (-(minY + maxY) / 2) * k };
    redraw();
  }, [redraw]);
  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  /** Obsidian's “Animate”: replay the graph growing, oldest page first. */
  const animate = useCallback(() => {
    if (playRef.current) {
      playRef.current = null;
      setPlaying(false);
      for (const n of nodesRef.current) n.grow = 1;
      redraw();
      return;
    }
    const nodes = nodesRef.current;
    if (!nodes.length) return;
    const duration = Math.min(9000, Math.max(1800, nodes.length * 60));
    const step = duration / Math.max(1, nodes.length);
    const order = [...nodes].sort((a, b) => a.createdAt - b.createdAt);
    order.forEach((n, i) => {
      n.appearAt = i * step;
      n.grow = 0;
      const angle = Math.random() * Math.PI * 2;
      n.x = Math.cos(angle) * 20;
      n.y = Math.sin(angle) * 20;
      n.vx = n.vy = 0;
    });
    viewRef.current = { x: 0, y: 0, k: viewRef.current.k };
    playRef.current = { start: performance.now(), duration };
    fitPendingRef.current = false;
    setTimeout(() => fitRef.current(), duration + 600);
    setPlaying(true);
    simRef.current?.alpha(1).restart();
    loop();
  }, [loop, redraw]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const v = viewRef.current;
    const step = 40;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => (v.x += step),
      ArrowRight: () => (v.x -= step),
      ArrowUp: () => (v.y += step),
      ArrowDown: () => (v.y -= step),
      "+": () => (v.k = clampZoom(v.k * 1.2)),
      "=": () => (v.k = clampZoom(v.k * 1.2)),
      "-": () => (v.k = clampZoom(v.k / 1.2)),
      "0": () => fit(),
    };
    const run = keys[e.key];
    if (run && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      run();
      redraw();
    }
  };

  const count = filtered?.nodes.length ?? 0;
  const linkCount = filtered?.edges.length ?? 0;
  const sortedList = useMemo(() => [...(filtered?.nodes ?? [])].sort((a, b) => b.degree - a.degree || pageTitle(a.title).localeCompare(pageTitle(b.title))), [filtered]);

  return (
    <div ref={wrapRef} className={cn("relative isolate min-h-0 flex-1 overflow-hidden bg-canvas", className)}>
      <canvas
        ref={canvasRef}
        className={cn("block size-full touch-none outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--focus)]", hover ? "cursor-pointer" : "cursor-grab active:cursor-grabbing")}
        role="img"
        aria-label={`${pageId ? "Local graph" : "Graph"} of ${count} pages and ${linkCount} connections. Arrow keys pan, plus and minus zoom, 0 fits. Use the list button for a keyboard list of pages.`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => !dragRef.current && setHovered(null)}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onDoubleClick={(e) => {
          const n = hit(e.clientX, e.clientY);
          if (n) ws.openPage(n.id, { mode: "full" });
        }}
      />

      {q.isLoading && !q.data && <div role="status" className="absolute inset-0 grid place-items-center text-[13px] text-fg-3">Building graph…</div>}
      {filtered && count === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6 text-center text-[13.5px] text-fg-3">
          {settings.search ? "No pages match that search." : "No pages to show yet. Link pages with @ mentions to see connections."}
        </div>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-60 animate-in rounded-lg bg-surface p-2.5 text-[13px] shadow-[var(--shadow-pop)] fade-in zoom-in-95"
          style={{ left: Math.min(hover.x + 14, hover.maxX), top: Math.max(8, hover.y + 14) }}
        >
          <div className="flex items-center gap-1.5 font-medium text-fg">
            <PageIcon icon={hover.node.icon} kind={hover.node.kind} size={16} />
            <span className="truncate">{pageTitle(hover.node.title)}</span>
          </div>
          <div className="mt-1 text-[12px] text-fg-3">
            {hover.node.kind === "database" ? "Database" : hover.node.kind === "row" ? "Database row" : "Page"} · {hover.links} {hover.links === 1 ? "connection" : "connections"}
          </div>
          <div className="mt-1.5 text-[11.5px] text-fg-3">Click to peek · double-click to open</div>
        </div>
      )}

      <div className="absolute end-2 top-2 z-20 flex items-center gap-0.5 rounded-md bg-surface/90 p-0.5 shadow-[0_0_0_1px_var(--line)] backdrop-blur">
        <IconButton size="sm" label={playing ? "Stop animation" : "Animate graph"} onClick={animate} aria-pressed={playing}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </IconButton>
        <IconButton size="sm" label="Fit to screen" shortcut="0" onClick={fit}>
          <Maximize2 className="size-4" />
        </IconButton>
        <IconButton size="sm" label="Pages as a list" onClick={() => setListOpen((v) => !v)} aria-pressed={listOpen}>
          <List className="size-4" />
        </IconButton>
        <IconButton size="sm" label="Graph settings" onClick={() => setPanelOpen((v) => !v)} aria-pressed={panelOpen} aria-expanded={panelOpen}>
          <Settings2 className="size-4" />
        </IconButton>
      </div>

      {panelOpen && <GraphPanel settings={settings} set={set} local={!!pageId} compact={compact} onClose={() => setPanelOpen(false)} />}

      {listOpen && (
        <nav aria-label="Pages in the graph" className="absolute bottom-2 start-2 top-12 z-20 flex w-64 flex-col rounded-lg bg-surface shadow-[var(--shadow-pop)]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12.5px] font-medium text-fg-2">
            {count} pages · {linkCount} connections
            <IconButton size="xs" label="Close list" onClick={() => setListOpen(false)}>
              <X />
            </IconButton>
          </div>
          <ul className="scroll-quiet min-h-0 flex-1 overflow-y-auto p-1">
            {sortedList.map((n) => (
              <li key={n.id}>
                <a
                  href={`/p/${n.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    ws.openPage(n.id, { mode: "side", list: sortedList.map((x) => x.id), event: e });
                  }}
                  onFocus={() => {
                    const node = nodesRef.current.find((x) => x.id === n.id) ?? null;
                    hoverRef.current = node;
                    redraw();
                  }}
                  className="flex items-center gap-2 rounded px-2 py-1 text-[13px] text-fg hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                >
                  <PageIcon icon={n.icon} kind={n.kind} size={15} />
                  <span className="min-w-0 flex-1 truncate">{pageTitle(n.title)}</span>
                  <span className="text-[11.5px] tabular-nums text-fg-3" aria-label={`${n.degree} connections`}>
                    {n.degree}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      {filtered?.truncated && <p className="absolute bottom-2 end-2 text-[12px] text-fg-3">Showing the first 5,000 pages.</p>}
    </div>
  );
}

const clampZoom = (k: number) => Math.min(6, Math.max(0.08, k));

function GraphPanel({ settings, set, local, compact, onClose }: { settings: GraphSettings; set: (p: Partial<GraphSettings>) => void; local: boolean; compact?: boolean; onClose: () => void }) {
  return (
    <section aria-label="Graph settings" className={cn("scroll-quiet absolute end-2 top-12 z-20 w-64 overflow-y-auto rounded-lg bg-surface p-3 text-[13px] shadow-[var(--shadow-pop)]", compact ? "bottom-2" : "max-h-[calc(100%-4rem)]")}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-fg-3">Filters</h2>
        <div className="flex">
          <IconButton size="xs" label="Reset graph settings" onClick={() => set({ ...DEFAULTS })}>
            <RotateCcw />
          </IconButton>
          <IconButton size="xs" label="Close graph settings" onClick={onClose}>
            <X />
          </IconButton>
        </div>
      </div>
      <Input placeholder="Search pages…" aria-label="Search pages in the graph" value={settings.search} onChange={(e) => set({ search: e.target.value })} className="mb-2 h-8" />
      {local && <Range label="Depth" min={1} max={4} step={1} value={settings.depth} onChange={(depth) => set({ depth })} format={(v) => `${v}`} />}
      <Toggle label="Orphans" checked={settings.orphans} onChange={(orphans) => set({ orphans })} />
      <Toggle label="Database rows" checked={settings.rows} onChange={(rows) => set({ rows })} />
      <Toggle label="Sub-page links" checked={settings.hierarchy} onChange={(hierarchy) => set({ hierarchy })} />
      <h2 className="mb-1 mt-3 text-[12px] font-semibold uppercase tracking-wide text-fg-3">Display</h2>
      <Toggle label="Arrows" checked={settings.arrows} onChange={(arrows) => set({ arrows })} />
      <Range label="Text fade threshold" min={0.2} max={2.5} step={0.05} value={settings.labels} onChange={(labels) => set({ labels })} />
      <Range label="Node size" min={0.4} max={3} step={0.1} value={settings.nodeSize} onChange={(nodeSize) => set({ nodeSize })} />
      <Range label="Link thickness" min={0.3} max={4} step={0.1} value={settings.linkWidth} onChange={(linkWidth) => set({ linkWidth })} />
      <h2 className="mb-1 mt-3 text-[12px] font-semibold uppercase tracking-wide text-fg-3">Forces</h2>
      <Range label="Center force" min={0} max={2} step={0.05} value={settings.center} onChange={(center) => set({ center })} />
      <Range label="Repel force" min={0} max={30} step={0.5} value={settings.repel} onChange={(repel) => set({ repel })} />
      <Range label="Link force" min={0} max={2} step={0.05} value={settings.linkStrength} onChange={(linkStrength) => set({ linkStrength })} />
      <Range label="Link distance" min={10} max={250} step={5} value={settings.linkDistance} onChange={(linkDistance) => set({ linkDistance })} format={(v) => `${v}`} />
    </section>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between py-1 text-fg-2">
      <span aria-hidden>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} label={label} />
    </div>
  );
}

function Range({ label, value, min, max, step, onChange, format = (v) => v.toFixed(2) }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <label className="block py-1 text-fg-2">
      <span className="flex justify-between">
        {label}
        <span className="tabular-nums text-fg-3">{format(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 h-6 w-full accent-[var(--accent)]" />
    </label>
  );
}
