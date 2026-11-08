"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTheme } from "next-themes";

/**
 * Mermaid diagrams (from the Chaos editor): rendered only near the viewport, in strict security
 * mode, and cached on this device by a hash of the source and theme.
 */
const CACHE = "max.diagram.v1:";
const memory = new Map<string, string>();
function hash(value: string) {
  let a = 0xdeadbeef, b = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
  b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
  return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
}
function cached(key: string): string {
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const stored = localStorage.getItem(CACHE + key);
    if (stored) memory.set(key, stored);
    return stored ?? "";
  } catch {
    return "";
  }
}
function keep(key: string, image: string) {
  memory.set(key, image);
  try {
    if (image.length < 200_000) localStorage.setItem(CACHE + key, image);
  } catch {}
}

function useNear<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") return setNear(true);
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return [ref, near] as const;
}

export default function Diagram({ text }: { text: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const key = hash(`${theme}\n${text}`);
  const [rendered, setRendered] = useState<{ key: string; image: string }>({ key: "", image: "" });
  const [error, setError] = useState(false);
  const [ref, near] = useNear<HTMLElement>();
  const image = rendered.key === key ? rendered.image : near ? cached(key) : "";
  const drawn = useRef(false);
  useEffect(() => {
    if (!near || cached(key) || !text.trim()) return;
    let live = true;
    const timer = setTimeout(
      () =>
        void (async () => {
          try {
            const mermaid = (await import("mermaid")).default;
            const dark = theme === "dark";
            const c = dark ? { surface: "#25272c", text: "#eceef2", line: "#8f96a3", border: "#6f8fbf" } : { surface: "#f3f2ef", text: "#2a2d33", line: "#7d838f", border: "#5b7fb3" };
            mermaid.initialize({
              startOnLoad: false,
              securityLevel: "strict",
              suppressErrorRendering: true,
              maxTextSize: 20_000,
              theme: "base",
              themeVariables: { background: "transparent", primaryColor: c.surface, primaryTextColor: c.text, primaryBorderColor: c.border, lineColor: c.line, secondaryColor: c.surface, tertiaryColor: c.surface, fontFamily: "system-ui, sans-serif", fontSize: "14px" },
              flowchart: { htmlLabels: false, curve: "basis" },
            });
            const { svg } = await mermaid.render(`maxDiagram${id}`, text);
            const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
            keep(key, url);
            if (live) {
              setRendered({ key, image: url });
              setError(false);
            }
          } catch {
            if (live) {
              setRendered({ key, image: "" });
              setError(true);
            }
          }
        })(),
      drawn.current ? 350 : 0,
    );
    drawn.current = true;
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text, id, theme, key, near]);
  return (
    <figure ref={ref} className="lx-diagram">
      {image ? (
        <img src={image} alt="Diagram" />
      ) : error ? (
        <output className="text-[13px] text-fg-3">Check the diagram syntax below.</output>
      ) : (
        <div className="skeleton h-40 w-full" aria-label="Drawing diagram…" />
      )}
    </figure>
  );
}
