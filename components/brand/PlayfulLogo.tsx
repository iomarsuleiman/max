"use client";
import { useEffect, useRef } from "react";
import { LogoMark } from "./Logo";

/** Damped rotation sleeps when at rest and respects both motion preferences. */
export function PlayfulLogo() {
  const mark = useRef<HTMLSpanElement>(null);
  const motion = useRef({ angle: 0, velocity: 0, frame: 0, last: 0, dragging: false, pointer: 0, x: 0, time: 0, reduced: false, travel: 0, target: 0 });
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
    s.target = Math.round((s.angle + s.velocity * 100) / 360) * 360;
    s.last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - s.last);
      s.last = now;
      s.angle += s.velocity * dt;
      s.velocity += (s.target - s.angle) * 0.00012 * dt;
      s.velocity *= Math.exp(-dt * 0.022);
      paint();
      if (!s.dragging && !s.reduced && (Math.abs(s.velocity) > 0.003 || Math.abs(s.target - s.angle) > 0.1)) {
        s.frame = requestAnimationFrame(tick);
      } else {
        s.angle = s.target;
        s.velocity = 0;
        s.frame = 0;
        paint();
      }
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
          if (e.button !== 0) return;
          s.travel = 0;
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
          const delta = (e.clientX - s.x) * 0.65;
          s.travel += Math.abs(e.clientX - s.x);
          s.angle += delta;
          s.velocity = s.velocity * 0.65 + Math.max(-0.35, Math.min(0.35, delta / Math.max(16, now - s.time))) * 0.35;
          s.x = e.clientX;
          s.time = now;
          paint();
        }}
        onPointerUp={(e) => {
          if (e.pointerId !== motion.current.pointer || !motion.current.dragging) return;
          motion.current.dragging = false;
          if (performance.now() - motion.current.time > 80) motion.current.velocity = 0;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          e.currentTarget.style.cursor = "grab";
          settle();
        }}
        onPointerCancel={(e) => {
          motion.current.dragging = false;
          motion.current.velocity = 0;
          e.currentTarget.style.cursor = "grab";
          settle();
        }}
        onClick={(e) => {
          if (e.detail === 0 || motion.current.travel < 4) {
            cancelAnimationFrame(motion.current.frame);
            motion.current.frame = 0;
            if (motion.current.reduced) {
              motion.current.angle += 45;
              paint();
            } else {
              motion.current.angle += 30;
              motion.current.velocity = 0.12;
              paint();
              settle();
            }
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            e.preventDefault();
            cancelAnimationFrame(motion.current.frame);
            motion.current.frame = 0;
            motion.current.velocity = 0;
            motion.current.angle += e.key === "ArrowLeft" ? -30 : 30;
            paint();
            settle();
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
