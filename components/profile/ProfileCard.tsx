"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ProfileCard as Card } from "@/lib/domain/profileCard";
import { profileCardSvg } from "@/lib/client/profileCardExport";
import { Button } from "@/components/ui";

const subscribe = () => () => {};
const needsPermission = () => typeof DeviceOrientationEvent !== "undefined" && "requestPermission" in DeviceOrientationEvent;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));

function applyTilt(element: HTMLElement, x: number, y: number) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "on") return;
  element.querySelectorAll(".card-light-gradient, .card-foil-gradient, .card-shine-gradient").forEach((gradient) => {
    gradient.setAttribute("gradientTransform", `rotate(${x * 50 + y * 20} .5 .5)`);
  });
  element.querySelector(".card-shine-gradient")?.setAttribute("gradientTransform", `translate(${x * 0.85} 0)`);
  element.style.transform = `perspective(800px) rotateX(${-y * 5}deg) rotateY(${x * 6}deg)`;
}

export function ProfileCard({ card }: { card: Card }) {
  const id = useId();
  const preview = useRef<HTMLElement>(null);
  const permissionRequired = useSyncExternalStore(subscribe, needsPermission, () => false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const { svg } = profileCardSvg({ ...card, name: card.name.trim() || "Your name" }, id);
  useEffect(() => {
    let baseline: { beta: number; gamma: number } | null = null;
    const orient = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null || !preview.current) return;
      baseline ??= { beta: event.beta, gamma: event.gamma };
      const horizontal = clamp((event.gamma - baseline.gamma) / 25);
      const vertical = clamp((event.beta - baseline.beta) / 25);
      const angle = (screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI / 180;
      applyTilt(preview.current, horizontal * Math.cos(angle) + vertical * Math.sin(angle), vertical * Math.cos(angle) - horizontal * Math.sin(angle));
    };
    window.addEventListener("deviceorientation", orient);
    return () => window.removeEventListener("deviceorientation", orient);
  }, []);
  const reset = () => {
    preview.current?.style.removeProperty("transform");
    preview.current?.querySelectorAll(".card-light-gradient, .card-foil-gradient, .card-shine-gradient").forEach((gradient) => gradient.removeAttribute("gradientTransform"));
  };
  return (
    <>
      <article
        ref={preview}
        aria-label="Your profile card preview"
        className="profile-card"
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          const box = event.currentTarget.getBoundingClientRect();
          applyTilt(event.currentTarget, (event.clientX - box.left) / box.width * 2 - 1, (event.clientY - box.top) / box.height * 2 - 1);
        }}
        onPointerLeave={reset}
        onPointerCancel={reset}
        onPointerUp={reset}
      >
        <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      </article>
      {permissionRequired && !permissionGranted && (
        <Button size="sm" onClick={async () => {
          if ("requestPermission" in DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
            try {
              setPermissionGranted(await DeviceOrientationEvent.requestPermission() === "granted");
            } catch {
              // Leave the control available if the browser cannot grant sensor access yet.
            }
          }
        }}>Enable phone tilt</Button>
      )}
    </>
  );
}
