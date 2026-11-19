"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { RotateCw, Smartphone } from "lucide-react";
import type { ProfileCard as Card } from "@/lib/domain/profileCard";
import { profileCardBackSvg, profileCardSvg } from "@/lib/client/profileCardExport";
import { Button } from "@/components/ui";

const subscribe = () => () => {};
/** Only phones and tablets have a tilt sensor worth asking for (desktop Safari also exposes the API). */
const needsPermission = () =>
  typeof DeviceOrientationEvent !== "undefined" && "requestPermission" in DeviceOrientationEvent && matchMedia("(pointer: coarse)").matches && navigator.maxTouchPoints > 0;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "on";

/** Tilts the card toward (x, y) in -1…1 and moves the light across it. */
function applyTilt(element: HTMLElement, x: number, y: number) {
  if (reducedMotion()) return;
  element.style.setProperty("--rx", `${-y * 9}deg`);
  element.style.setProperty("--ry", `${x * 11}deg`);
  element.style.setProperty("--mx", `${50 + x * 50}%`);
  element.style.setProperty("--my", `${50 + y * 50}%`);
  element.dataset.active = "true";
}

/**
 * The membership card: artwork on the front, a handwritten member number, join date and an
 * invite QR on the back. Tilts toward the pointer (or the phone), flips on click.
 */
export function ProfileCard({ card }: { card: Card }) {
  const id = useId();
  const tilt = useRef<HTMLElement>(null);
  const permissionRequired = useSyncExternalStore(subscribe, needsPermission, () => false);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const named = { ...card, name: card.name.trim() || "Your name" };
  const front = profileCardSvg(named, id);
  const back = profileCardBackSvg(named, `${id}-b`, front.height);
  useEffect(() => {
    let baseline: { beta: number; gamma: number } | null = null;
    const orient = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null || !tilt.current) return;
      baseline ??= { beta: event.beta, gamma: event.gamma };
      const horizontal = clamp((event.gamma - baseline.gamma) / 25);
      const vertical = clamp((event.beta - baseline.beta) / 25);
      const angle = ((screen.orientation?.angle ?? window.orientation ?? 0) * Math.PI) / 180;
      applyTilt(tilt.current, horizontal * Math.cos(angle) + vertical * Math.sin(angle), vertical * Math.cos(angle) - horizontal * Math.sin(angle));
    };
    window.addEventListener("deviceorientation", orient);
    return () => window.removeEventListener("deviceorientation", orient);
  }, []);
  const reset = () => {
    const el = tilt.current;
    if (!el) return;
    for (const p of ["--rx", "--ry", "--mx", "--my"]) el.style.removeProperty(p);
    delete el.dataset.active;
  };
  return (
    <>
      <article
        ref={tilt}
        aria-label="Your profile card preview"
        className="profile-card"
        onPointerMove={(event) => {
          if (event.pointerType === "touch") return;
          const box = event.currentTarget.getBoundingClientRect();
          applyTilt(event.currentTarget, ((event.clientX - box.left) / box.width) * 2 - 1, ((event.clientY - box.top) / box.height) * 2 - 1);
        }}
        onPointerLeave={reset}
        onPointerCancel={reset}
      >
        <div className="profile-card-flip" data-flipped={flipped || undefined}>
          <span className="profile-card-inner">
            <span className="profile-card-face" aria-hidden dangerouslySetInnerHTML={{ __html: front.svg }} />
            <span className="profile-card-face profile-card-back" aria-hidden dangerouslySetInnerHTML={{ __html: back }} />
            <span className="profile-card-glare" aria-hidden />
          </span>
        </div>
        {/* An empty button over the card, so its name isn't mixed with the artwork's text. */}
        <button
          type="button"
          className="profile-card-hit"
          aria-pressed={flipped}
          aria-label={flipped ? "Show the front of the card" : "Show the back of the card"}
          onClick={() => setFlipped((f) => !f)}
        />
        <p className="sr-only" aria-live="polite">
          {flipped
            ? `Back: member ${card.memberNumber ? `number ${card.memberNumber}` : "number pending"}, joined Max${card.createdAt ? ` on ${new Date(card.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}` : ""}, with a QR code that invites people to Max.`
            : `Front: ${named.name}${card.subtitle ? `, ${card.subtitle}` : ""}.`}
        </p>
      </article>
      <div className="flex w-full flex-wrap justify-center gap-2 pt-1">
        <Button size="sm" variant="ghost" icon={<RotateCw className="size-3.5" />} onClick={() => setFlipped((f) => !f)}>
          {flipped ? "Show front" : "Flip card"}
        </Button>
        {permissionRequired && !permissionGranted && (
          <Button
            size="sm"
            variant="ghost"
            icon={<Smartphone className="size-3.5" />}
            onClick={async () => {
              if ("requestPermission" in DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
                try {
                  setPermissionGranted((await DeviceOrientationEvent.requestPermission()) === "granted");
                } catch {
                  // Leave the control available if the browser cannot grant sensor access yet.
                }
              }
            }}
          >
            Enable phone tilt
          </Button>
        )}
      </div>
    </>
  );
}
