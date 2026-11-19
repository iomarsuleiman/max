"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Minus, Moon, Plus, Sparkles, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/components/ui";
import { notifyError, useWorkspace } from "@/components/workspace/context";
import { applySpace } from "@/lib/client/space";
import { cardPalette, profileCardThemes } from "@/lib/domain/profileCard";

type Space = { colors: string[]; grain: number; intensity: number };
type Dot = { x: number; y: number }; // 0–1 across the field: x is hue, y runs from soft (top) to vivid (bottom)

const toHex = (h: number, s: number, l: number) => {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
};
const dotColor = (d: Dot) => toHex(d.x * 360, 0.55 + d.y * 0.3, 0.86 - d.y * 0.36);

/** Where a hex color sits on the field (inverse of dotColor, near enough for presets). */
function dotFor(hex: string): Dot {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) * 60 : max === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60;
  }
  return { x: h / 360, y: Math.max(0, Math.min(1, (0.86 - l) / 0.36)) };
}

const DEFAULT: Space = { colors: ["#ffb52d", "#ff7e94"], grain: 50, intensity: 23 };

/**
 * The Space editor (after Arc's theme picker): drag colors on the field, add or remove one, pick a
 * preset, tune the grain with the wavy slider and the tint with the dial. Previews live, saves on release.
 */
export function SpaceEditor() {
  const ws = useWorkspace();
  const { resolvedTheme, theme, setTheme } = useTheme();
  const saved = ws.settings?.space ?? null;
  const [space, setSpace] = useState<Space>(() => saved ?? DEFAULT);
  const [dots, setDots] = useState<Dot[]>(() => (saved ?? DEFAULT).colors.map(dotFor));
  const field = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (next: Space, persist = true) => {
    setSpace(next);
    applySpace(next);
    if (!persist) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void ws.call("settings.update", { space: next }).catch((err) => notifyError(err, "Couldn't save your space.")), 350);
  };
  const setDotsAndColors = (next: Dot[], persist: boolean) => {
    setDots(next);
    update({ ...space, colors: next.map(dotColor) }, persist);
  };
  const move = (e: ReactPointerEvent, i: number, persist: boolean) => {
    const box = field.current!.getBoundingClientRect();
    const d = { x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)) };
    setDotsAndColors(dots.map((o, j) => (j === i ? d : o)), persist);
  };

  return (
    <div className="space-editor">
      <div className="space-modes" role="radiogroup" aria-label="Appearance">
        {([["system", Sparkles, "Auto", "Match my device"], ["light", Sun, "Light", "Use light mode"], ["dark", Moon, "Dark", "Use dark mode"]] as const).map(([v, Icon, text, label]) => (
          <button key={v} type="button" role="radio" aria-checked={(theme ?? "system") === v} aria-label={label} onClick={() => { setTheme(v); void ws.call("settings.update", { theme: v }).catch(() => undefined); }} className={cn("space-mode", (theme ?? "system") === v && "is-on")}>
            <Icon className="size-4" aria-hidden />
            <span>{text}</span>
          </button>
        ))}
      </div>
      <div className="space-field-wrap">
        <div ref={field} className="space-field" role="group" aria-label="Space colors: drag a dot to change its color">
          {dots.map((d, i) => (
            <button
              key={i}
              type="button"
              className="space-dot"
              aria-label={`Color ${i + 1}: ${dotColor(d)}. Arrow keys move it.`}
              style={{ left: `${d.x * 100}%`, top: `${d.y * 100}%`, background: dotColor(d), width: i === 0 ? 34 : 24, height: i === 0 ? 34 : 24 }}
              onPointerDown={(e) => {
                dragging.current = i;
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => dragging.current === i && move(e, i, false)}
              onPointerUp={(e) => {
                if (dragging.current === i) move(e, i, true);
                dragging.current = null;
              }}
              onKeyDown={(e) => {
                const step = e.shiftKey ? 0.08 : 0.02;
                const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
                const dy = e.key === "ArrowDown" ? step : e.key === "ArrowUp" ? -step : 0;
                if (!dx && !dy) return;
                e.preventDefault();
                setDotsAndColors(dots.map((o, j) => (j === i ? { x: (o.x + dx + 1) % 1, y: Math.max(0, Math.min(1, o.y + dy)) } : o)), true);
              }}
            />
          ))}
          <div className="space-count">
            <button type="button" aria-label="Remove a color" disabled={dots.length <= 1} onClick={() => setDotsAndColors(dots.slice(0, -1), true)}>
              <Minus className="size-4" />
            </button>
            <button type="button" aria-label="Add a color" disabled={dots.length >= 3} onClick={() => setDotsAndColors([...dots, { x: (dots[dots.length - 1].x + 0.33) % 1, y: 0.4 }], true)}>
              <Plus className="size-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="space-presets" role="radiogroup" aria-label="Preset colors">
        {profileCardThemes.map((t) => {
          const p = cardPalette(t);
          const on = space.colors[0] === p.first && space.colors[1] === p.second;
          return (
            <button key={t} type="button" role="radio" aria-checked={on} aria-label={t} title={t} className={cn("space-preset", on && "is-on")} style={{ background: `linear-gradient(135deg, ${p.first}, ${p.second})` }} onClick={() => setDotsAndColors([p.first, p.second].map(dotFor), true)} />
          );
        })}
      </div>
      <div className="space-controls">
        <label className="space-grain">
          <span className="sr-only">Grain</span>
          <input type="range" min={0} max={100} value={space.grain} aria-label="Grain" onChange={(e) => update({ ...space, grain: Number(e.target.value) }, false)} onPointerUp={() => update(space)} onKeyUp={() => update(space)} />
        </label>
        <Dial label="Color strength" value={space.intensity} onChange={(v, persist) => update({ ...space, intensity: v }, persist)} />
      </div>
      <div className="flex items-center justify-between text-[12px] text-fg-3">
        <span>Grain</span>
        {saved ? (
          <button type="button" className="underline underline-offset-2 hover:text-fg-2" onClick={() => void ws.call("settings.update", { space: null }).then(() => setSpace(DEFAULT))}>
            Use my card&apos;s colors
          </button>
        ) : (
          <span>{resolvedTheme === "dark" ? "Dark" : "Light"} space</span>
        )}
        <span>Strength</span>
      </div>
    </div>
  );
}

/** A round knob: drag sideways or up and down, or use the arrow keys. */
function Dial({ label, value, onChange }: { label: string; value: number; onChange: (v: number, persist: boolean) => void }) {
  const start = useRef<{ x: number; y: number; v: number } | null>(null);
  const angle = -135 + (value / 100) * 270;
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      className="space-dial"
      onPointerDown={(e) => {
        start.current = { x: e.clientX, y: e.clientY, v: value };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const d = e.clientX - start.current.x - (e.clientY - start.current.y);
        onChange(Math.max(0, Math.min(100, start.current.v + d * 0.6)), false);
      }}
      onPointerUp={() => {
        start.current = null;
        onChange(value, true);
      }}
      onKeyDown={(e) => {
        const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 5 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -5 : 0;
        if (!d) return;
        e.preventDefault();
        onChange(Math.max(0, Math.min(100, value + d)), true);
      }}
    >
      <span className="space-dial-ticks" aria-hidden />
      <span className="space-dial-knob" style={{ transform: `rotate(${angle}deg)` }} aria-hidden>
        <i />
      </span>
    </div>
  );
}
