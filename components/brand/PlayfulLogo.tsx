"use client";

import { useEffect, useRef } from "react";
import { advanceLogoMotion, angularDelta, createLogoMotion, releaseLogoMotion, resetLogoMotion } from "@/lib/client/logoMotion";
import { LogoMark } from "./Logo";

type Sample = { time: number; x: number; y: number; angle: number };
type Gesture =
  | { kind: "spin"; pointer: number; polar: number; travel: number; x: number; y: number }
  | { kind: "pull"; pointer: number; startX: number; startY: number; offsetX: number; offsetY: number; travel: number; x: number; y: number };

/** The edge turns around the finger; the center pulls. Animation sleeps as soon as it settles. */
export function PlayfulLogo() {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const button = buttonRef.current;
    const mark = markRef.current;
    if (!button || !mark) return;
    const motion = createLogoMotion();
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const controller = new AbortController();
    const { signal } = controller;
    let reduced = false;
    let gesture: Gesture | null = null;
    let samples: Sample[] = [];
    let frame = 0;
    let last = 0;
    let direction = 1;
    const paint = () => {
      mark.style.transform = `translate(${motion.x.value}px, ${motion.y.value}px) scale(${1 + motion.press.value * 0.12}) rotate(${motion.angle % 360}deg)`;
    };
    const tick = (now: number) => {
      frame = 0;
      const moving = advanceLogoMotion(motion, (now - last) / 1000);
      last = now;
      paint();
      if (moving && !reduced && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (frame || reduced || document.hidden) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    };
    const center = () => {
      const rect = button.getBoundingClientRect();
      return { x: rect.left + rect.width / 2 + motion.x.value, y: rect.top + rect.height / 2 + motion.y.value };
    };
    const sample = (event: PointerEvent) => {
      samples.push({ time: event.timeStamp, x: event.clientX, y: event.clientY, angle: motion.angle });
      while (samples.length > 2 && event.timeStamp - samples[0].time > 100) samples.shift();
    };
    const clearCapture = (pointer: number) => {
      if (button.hasPointerCapture(pointer)) button.releasePointerCapture(pointer);
      button.style.cursor = "grab";
    };
    const reset = () => {
      const pointer = gesture?.pointer;
      gesture = null;
      if (pointer !== undefined) clearCapture(pointer);
      cancelAnimationFrame(frame);
      frame = 0;
      resetLogoMotion(motion);
      paint();
    };
    const preferences = () => {
      reduced = media.matches || document.documentElement.dataset.reduceMotion === "on";
      if (reduced) reset();
    };
    const kick = (sign: number) => {
      direction = sign;
      releaseLogoMotion(motion, sign * 1450, 1200, reduced);
      paint();
      wake();
    };
    const release = (event?: PointerEvent, cancelled = false) => {
      const held = gesture;
      if (!held || (event && event.pointerId !== held.pointer)) return;
      if (event && !cancelled) sample(event);
      gesture = null;
      clearCapture(held.pointer);
      const first = samples[0];
      const final = samples.at(-1);
      const duration = first && final ? (final.time - first.time) / 1000 : 0;
      const vx = duration > 0 && first && final ? (final.x - first.x) / duration : 0;
      const vy = duration > 0 && first && final ? (final.y - first.y) / duration : 0;
      const angularVelocity = duration > 0 && first && final ? (final.angle - first.angle) / duration : 0;
      if (!cancelled && held.travel < 5) return kick(direction);
      if (held.kind === "pull") {
        motion.x.velocity = cancelled ? 0 : Math.max(-1800, Math.min(1800, vx));
        motion.y.velocity = cancelled ? 0 : Math.max(-1800, Math.min(1800, vy));
      }
      if (Math.abs(angularVelocity) > 70) direction = Math.sign(angularVelocity);
      releaseLogoMotion(motion, held.kind === "spin" && !cancelled ? angularVelocity : 0, cancelled ? 0 : Math.hypot(vx, vy), reduced);
      paint();
      wake();
    };
    button.addEventListener(
      "pointerdown",
      (event) => {
        if ((event.pointerType === "mouse" && event.button !== 0) || gesture || reduced) return;
        event.preventDefault();
        const origin = center();
        const x = event.clientX - origin.x;
        const y = event.clientY - origin.y;
        motion.rotation = { kind: "rest" };
        motion.press.target = 1;
        const common = { pointer: event.pointerId, travel: 0, x: event.clientX, y: event.clientY };
        gesture =
          Math.hypot(x, y) > button.offsetWidth * 0.24
            ? { ...common, kind: "spin", polar: (Math.atan2(y, x) * 180) / Math.PI }
            : { ...common, kind: "pull", startX: event.clientX, startY: event.clientY, offsetX: motion.x.value, offsetY: motion.y.value };
        if (gesture.kind === "pull") {
          motion.x.target = motion.x.value;
          motion.y.target = motion.y.value;
        }
        motion.x.velocity = motion.y.velocity = 0;
        samples = [];
        sample(event);
        button.setPointerCapture(event.pointerId);
        button.style.cursor = "grabbing";
        wake();
      },
      { signal },
    );
    button.addEventListener(
      "pointermove",
      (event) => {
        if (!gesture || gesture.pointer !== event.pointerId) return;
        if (event.pointerType === "mouse" && event.buttons === 0) return release(event, true);
        gesture.travel += Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y);
        gesture.x = event.clientX;
        gesture.y = event.clientY;
        if (gesture.kind === "spin") {
          const origin = center();
          const polar = (Math.atan2(event.clientY - origin.y, event.clientX - origin.x) * 180) / Math.PI;
          motion.angle += angularDelta(gesture.polar, polar);
          gesture.polar = polar;
        } else {
          motion.x.value = motion.x.target = gesture.offsetX + event.clientX - gesture.startX;
          motion.y.value = motion.y.target = gesture.offsetY + event.clientY - gesture.startY;
        }
        sample(event);
        paint();
        wake();
      },
      { signal },
    );
    button.addEventListener("pointerup", (event) => release(event), { signal });
    button.addEventListener("pointercancel", (event) => release(event, true), { signal });
    button.addEventListener("lostpointercapture", (event) => release(event, true), { signal });
    window.addEventListener("pointerup", (event) => release(event), { signal });
    window.addEventListener("blur", reset, { signal });
    document.addEventListener(
      "visibilitychange",
      () => {
        if (document.hidden) reset();
      },
      { signal },
    );
    // Pointer releases already act above. Only keyboard-generated clicks receive a second path.
    button.addEventListener(
      "click",
      (event) => {
        if (event.detail === 0) kick(direction);
      },
      { signal },
    );
    button.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        kick(event.key === "ArrowLeft" ? -1 : 1);
      },
      { signal },
    );
    preferences();
    media.addEventListener("change", preferences, { signal });
    const observer = new MutationObserver(preferences);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    return () => {
      controller.abort();
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="mb-7 flex flex-col items-center gap-3">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Spin the Max butterfly"
        aria-describedby="butterfly-help"
        className="text-fg focus-visible:ring-fg grid size-44 touch-none place-items-center rounded-[44px] outline-none select-none focus-visible:ring-2 focus-visible:ring-offset-8 sm:size-52"
        style={{ cursor: "grab" }}
      >
        <span ref={markRef} className="block size-40 sm:size-48">
          <LogoMark className="size-full" />
        </span>
      </button>
      <p id="butterfly-help" className="sr-only">
        Drag the edge to spin, or pull the middle. Tap or use the arrow keys to spin.
      </p>
    </div>
  );
}
