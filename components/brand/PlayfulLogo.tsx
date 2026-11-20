"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { advanceLogoMotion, angularDelta, createLogoMotion, releaseLogoMotion, resetLogoMotion } from "@/lib/client/logoMotion";
import { MARK_PATH } from "./Logo";

/**
 * The center carries the butterfly and its edges turn it. A flick gives it momentum,
 * while the wings flap independently on arrival, hover, and activation.
 */
export function PlayfulLogo() {
  const [flaps, setFlaps] = useState(0); // bumping the key restarts the flap animation
  const [still, setStill] = useState(false);
  const busy = useRef(false);
  const mover = useRef<HTMLSpanElement>(null);
  const motion = useRef(createLogoMotion());
  const frame = useRef(0);
  const reduced = useRef(false);
  const press = useRef<{
    id: number; mode: "carry" | "turn"; x: number; y: number; time: number;
    centerX: number; centerY: number; bearing: number; spin: number; vx: number; vy: number; distance: number;
  } | null>(null);
  const dragged = useRef(false);

  const paint = useCallback(() => {
    const { x, y, angle, press } = motion.current;
    if (!mover.current) return;
    mover.current.style.transform = `translate(${x.value}px, ${y.value}px) rotate(${angle}deg)`;
    mover.current.style.setProperty("--butterfly-press", String(1 - 0.045 * press.value));
  }, []);

  const reset = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    press.current = null;
    busy.current = false;
    resetLogoMotion(motion.current);
    paint();
  }, [paint]);

  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reduced.current = media.matches || document.documentElement.dataset.reduceMotion === "on";
      setStill(reduced.current);
      if (reduced.current) reset();
    };
    const hidden = () => { if (document.hidden) reset(); };
    update();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", hidden);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    const hello = window.setTimeout(() => setFlaps((n) => (n === 0 ? 1 : n)), 500);
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", hidden);
      observer.disconnect();
      window.clearTimeout(hello);
    };
  }, [reset]);

  const run = () => {
    if (reduced.current || frame.current || document.hidden) return;
    let last = performance.now();
    const tick = (now: number) => {
      const moving = advanceLogoMotion(motion.current, (now - last) / 1000);
      last = now;
      paint();
      frame.current = moving ? requestAnimationFrame(tick) : 0;
    };
    frame.current = requestAnimationFrame(tick);
  };

  const finish = (event: PointerEvent<HTMLButtonElement>, cancelled = false) => {
    const gesture = press.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    press.current = null;
    const shape = motion.current;
    const fresh = !cancelled && performance.now() - gesture.time < 100 && gesture.distance > 8;
    const speed = fresh ? Math.hypot(gesture.vx, gesture.vy) : 0;
    const swipe = Math.abs(gesture.vx) >= Math.abs(gesture.vy) ? gesture.vx : gesture.vy;
    const spin = fresh ? (gesture.mode === "turn" ? gesture.spin : speed > 430 ? swipe * 1.8 : 0) : 0;
    if (gesture.mode === "carry" && fresh) {
      shape.x.velocity = gesture.vx * 0.55;
      shape.y.velocity = gesture.vy * 0.55;
    }
    dragged.current = cancelled || gesture.distance > 8;
    releaseLogoMotion(shape, spin, speed, reduced.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.currentTarget.style.cursor = "grab";
    run();
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
        onPointerEnter={(e) => e.pointerType === "mouse" && !press.current && flap()}
        onPointerDown={(e) => {
          if (reduced.current || e.button !== 0 || press.current) return;
          const shape = motion.current;
          const box = e.currentTarget.getBoundingClientRect();
          const centerX = box.left + box.width / 2 + shape.x.value;
          const centerY = box.top + box.height / 2 + shape.y.value;
          const dx = e.clientX - centerX;
          const dy = e.clientY - centerY;
          press.current = {
            id: e.pointerId, mode: Math.hypot(dx, dy) > box.width * 0.25 ? "turn" : "carry",
            x: e.clientX, y: e.clientY, time: performance.now(), centerX, centerY,
            bearing: Math.atan2(dy, dx) * 180 / Math.PI, spin: 0, vx: 0, vy: 0, distance: 0,
          };
          dragged.current = false;
          shape.rotation = { kind: "rest" };
          shape.x.target = shape.x.value;
          shape.y.target = shape.y.value;
          shape.x.velocity = shape.y.velocity = 0;
          shape.press.target = 1;
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.style.cursor = "grabbing";
          run();
        }}
        onPointerMove={(e) => {
          const gesture = press.current;
          if (!gesture || gesture.id !== e.pointerId) return;
          const now = performance.now();
          const dt = Math.max(8, now - gesture.time) / 1000;
          const dx = e.clientX - gesture.x;
          const dy = e.clientY - gesture.y;
          const shape = motion.current;
          if (gesture.mode === "carry") {
            shape.x.value = shape.x.target += dx;
            shape.y.value = shape.y.target += dy;
          } else {
            const bearing = Math.atan2(e.clientY - gesture.centerY, e.clientX - gesture.centerX) * 180 / Math.PI;
            const rotation = angularDelta(gesture.bearing, bearing);
            shape.angle += rotation;
            gesture.spin = gesture.spin * 0.35 + rotation / dt * 0.65;
            gesture.bearing = bearing;
          }
          gesture.vx = gesture.vx * 0.35 + dx / dt * 0.65;
          gesture.vy = gesture.vy * 0.35 + dy / dt * 0.65;
          gesture.distance += Math.hypot(dx, dy);
          gesture.x = e.clientX;
          gesture.y = e.clientY;
          gesture.time = now;
          paint();
        }}
        onPointerUp={finish}
        onPointerCancel={(e) => finish(e, true)}
        onLostPointerCapture={(e) => finish(e, true)}
        onClick={(e) => {
          if (!dragged.current || e.detail === 0) flap();
          dragged.current = false;
        }}
        onKeyDown={(e) => {
          if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !reduced.current) {
            e.preventDefault();
            releaseLogoMotion(motion.current, e.key === "ArrowLeft" ? -680 : 680, 340, false);
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
        Tap to flap its wings. Drag the center to carry it or grab an edge to turn it. Flick or use the arrow keys to spin it.
      </p>
    </div>
  );
}
