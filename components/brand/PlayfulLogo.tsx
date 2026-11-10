"use client";
import { useEffect, useRef } from "react";
import { LogoMark } from "./Logo";

/** Inertial rotation sleeps when at rest and respects both motion preferences. */
export function PlayfulLogo() {
  const mark = useRef<HTMLSpanElement>(null);
  const motion = useRef({ angle: 0, velocity: 0, frame: 0, last: 0, dragging: false, pointer: 0, x: 0, time: 0, reduced: false });
  useEffect(() => {
    const s = motion.current;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      s.reduced = media.matches || document.documentElement.dataset.reduceMotion === "on";
      if (s.reduced) {
        cancelAnimationFrame(s.frame);
        s.frame = 0;
        s.velocity = 0;
      }
    };
    const pause = () => {
      if (document.hidden) {
        cancelAnimationFrame(s.frame);
        s.frame = 0;
        s.velocity = 0;
        s.dragging = false;
      }
    };
    update();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", pause);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    return () => {
      cancelAnimationFrame(s.frame);
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", pause);
      observer.disconnect();
    };
  }, []);
  const paint = () => {
    if (mark.current) mark.current.style.transform = `rotate(${motion.current.angle % 360}deg)`;
  };
  const settle = () => {
    const s = motion.current;
    if (s.reduced || s.frame || document.hidden) return;
    s.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - s.last);
      s.last = now;
      s.angle += s.velocity * dt;
      s.velocity *= Math.exp(-dt * 0.0048);
      paint();
      s.frame = !s.dragging && Math.abs(s.velocity) > 0.003 && !s.reduced ? requestAnimationFrame(tick) : 0;
    };
    s.frame = requestAnimationFrame(tick);
  };
  return (
    <div className="mb-7 flex flex-col items-center gap-3">
      <button
        type="button"
        aria-label="Spin the Max butterfly"
        aria-describedby="butterfly-help"
        className="text-fg focus-visible:ring-fg grid size-44 touch-none place-items-center rounded-[44px] outline-none select-none focus-visible:ring-2 focus-visible:ring-offset-8 sm:size-52"
        style={{ cursor: "grab" }}
        onPointerDown={(e) => {
          const s = motion.current;
          cancelAnimationFrame(s.frame);
          s.frame = 0;
          s.dragging = true;
          s.pointer = e.pointerId;
          s.x = e.clientX;
          s.time = performance.now();
          s.velocity = 0;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.style.cursor = "grabbing";
        }}
        onPointerMove={(e) => {
          const s = motion.current;
          if (!s.dragging || e.pointerId !== s.pointer) return;
          const now = performance.now();
          const delta = (e.clientX - s.x) * 1.5;
          s.angle += delta;
          s.velocity = Math.max(-2, Math.min(2, delta / Math.max(8, now - s.time)));
          s.x = e.clientX;
          s.time = now;
          paint();
        }}
        onPointerUp={(e) => {
          motion.current.dragging = false;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          e.currentTarget.style.cursor = "grab";
          settle();
        }}
        onPointerCancel={() => {
          motion.current.dragging = false;
          motion.current.velocity = 0;
        }}
        onClick={(e) => {
          if (e.detail === 0 || Math.abs(motion.current.velocity) < 0.01) {
            if (motion.current.reduced) {
              motion.current.angle += 45;
              paint();
            } else {
              motion.current.velocity = 1.4;
              settle();
            }
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            motion.current.angle += e.key === "ArrowLeft" ? -30 : 30;
            paint();
          }
        }}
      >
        <span ref={mark} className="block size-40 sm:size-48">
          <LogoMark className="size-full" />
        </span>
      </button>
      <p id="butterfly-help" className="sr-only">
        A little room to play. Drag, tap, or use the arrow keys.
      </p>
    </div>
  );
}
