"use client";

import { useEffect, useRef, useState } from "react";
import { MARK_PATH } from "./Logo";

/**
 * The landing butterfly. A tap (or Enter/Space) makes its wings flap. Grab it and you can carry
 * it away or fling it: it spins with the speed you give it, then floats home and settles upright.
 * Its wings also flap on arrival and on hover. Arrow keys spin it. Reduced motion keeps it still.
 */
export function PlayfulLogo() {
  const [flaps, setFlaps] = useState(0); // bumping the key restarts the flap animation
  const [still, setStill] = useState(false);
  const busy = useRef(false);
  const mover = useRef<HTMLSpanElement>(null);
  const m = useRef({ x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0, frame: 0, last: 0, dragging: false, pointer: -1, px: 0, py: 0, time: 0, moved: 0, reduced: false });

  useEffect(() => {
    const s = m.current;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      const reduced = media.matches || document.documentElement.dataset.reduceMotion === "on";
      s.reduced = reduced;
      setStill(reduced);
      if (reduced) home();
    };
    const hidden = () => document.hidden && home();
    update();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", hidden);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    const hello = window.setTimeout(() => setFlaps((n) => (n === 0 ? 1 : n)), 500);
    return () => {
      cancelAnimationFrame(s.frame);
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", hidden);
      observer.disconnect();
      window.clearTimeout(hello);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paint = () => {
    const s = m.current;
    if (mover.current) mover.current.style.transform = `translate(${s.x}px, ${s.y}px) rotate(${s.angle}deg)`;
  };
  function home() {
    const s = m.current;
    cancelAnimationFrame(s.frame);
    Object.assign(s, { frame: 0, x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0 });
    paint();
  }
  /** Spin keeps its momentum with friction; position and angle spring home (critically damped). */
  const run = () => {
    const s = m.current;
    if (s.reduced || s.frame || document.hidden) return;
    s.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - s.last);
      s.last = now;
      if (!s.dragging) {
        // Carry home: a spring on position.
        const k = 0.00009, c = 0.019;
        s.vx += (-s.x * k - s.vx * c) * dt;
        s.vy += (-s.y * k - s.vy * c) * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        // Spin: coast while fast, then spring to the nearest upright turn.
        const rest = Math.round(s.angle / 360) * 360;
        if (Math.abs(s.spin) > 0.25) s.spin *= Math.exp(-dt * 0.0022);
        else s.spin += ((rest - s.angle) * 0.00012 - s.spin * 0.022) * dt;
        s.angle += s.spin * dt;
        const settled = Math.abs(s.x) < 0.3 && Math.abs(s.y) < 0.3 && Math.abs(s.vx) + Math.abs(s.vy) < 0.003 && Math.abs(rest - s.angle) < 0.2 && Math.abs(s.spin) < 0.002;
        if (settled) {
          Object.assign(s, { x: 0, y: 0, vx: 0, vy: 0, angle: 0, spin: 0, frame: 0 });
          paint();
          return;
        }
      }
      paint();
      s.frame = requestAnimationFrame(tick);
    };
    s.frame = requestAnimationFrame(tick);
  };
  const flap = () => {
    if (still || busy.current) return;
    busy.current = true;
    setFlaps((n) => n + 1);
  };

  const wings = (side: "left" | "right") => (
    <svg viewBox={side === "left" ? "0 0 50 100" : "50 0 50 100"} className="block size-full" fill="currentColor" aria-hidden focusable="false">
      <path d={MARK_PATH} />
    </svg>
  );
  return (
    <div className="mb-7 flex flex-col items-center gap-3">
      <button
        type="button"
        aria-label="Flap the Max butterfly's wings"
        aria-describedby="butterfly-hint"
        className="butterfly text-fg focus-visible:ring-fg grid size-44 touch-none place-items-center rounded-[44px] outline-none select-none focus-visible:ring-2 focus-visible:ring-offset-8 sm:size-52"
        style={{ cursor: still ? "pointer" : "grab" }}
        data-still={still || undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && !m.current.dragging && flap()}
        onPointerDown={(e) => {
          if (m.current.reduced || e.button !== 0) return;
          const s = m.current;
          Object.assign(s, { dragging: true, pointer: e.pointerId, px: e.clientX, py: e.clientY, time: performance.now(), moved: 0, vx: 0, vy: 0 });
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.style.cursor = "grabbing";
          run();
        }}
        onPointerMove={(e) => {
          const s = m.current;
          if (!s.dragging || e.pointerId !== s.pointer) return;
          const now = performance.now();
          const dt = Math.max(8, now - s.time);
          const dx = e.clientX - s.px;
          const dy = e.clientY - s.py;
          s.x += dx;
          s.y += dy;
          s.moved += Math.hypot(dx, dy);
          // Velocities in px/ms and deg/ms, smoothed so a fling carries its speed.
          s.vx = s.vx * 0.4 + (dx / dt) * 0.6;
          s.vy = s.vy * 0.4 + (dy / dt) * 0.6;
          s.spin = Math.max(-3, Math.min(3, s.spin * 0.5 + (dx / dt) * 1.1));
          s.angle += s.spin * dt * 0.6;
          s.px = e.clientX;
          s.py = e.clientY;
          s.time = now;
          paint();
        }}
        onPointerUp={(e) => {
          const s = m.current;
          if (!s.dragging) return;
          s.dragging = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          e.currentTarget.style.cursor = "grab";
          // Held still before letting go: no fling.
          if (performance.now() - s.time > 80) {
            s.vx = s.vy = 0;
            s.spin *= 0.2;
          }
          if (Math.abs(s.spin) > 0.4) flap();
        }}
        onPointerCancel={() => {
          m.current.dragging = false;
        }}
        onClick={() => {
          // A tap flaps the wings, as it always has; the end of a drag doesn't.
          if (m.current.moved < 6) flap();
          m.current.moved = 0;
        }}
        onKeyDown={(e) => {
          if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !m.current.reduced) {
            e.preventDefault();
            m.current.spin += e.key === "ArrowLeft" ? -0.6 : 0.6;
            flap();
            run();
          }
        }}
      >
        <span ref={mover} className="relative z-10 grid size-40 place-items-center will-change-transform sm:size-48">
          <span
            key={flaps}
            className="butterfly-body flex size-full"
            data-flapping={flaps > 0 && !still ? "" : undefined}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget.lastElementChild) busy.current = false;
            }}
          >
            <span className="butterfly-wing butterfly-wing--left">{wings("left")}</span>
            <span className="butterfly-wing butterfly-wing--right">{wings("right")}</span>
          </span>
        </span>
      </button>
      <p id="butterfly-hint" className="sr-only">
        Tap to flap its wings. Drag to carry it away or fling it to spin. Arrow keys spin it.
      </p>
    </div>
  );
}
