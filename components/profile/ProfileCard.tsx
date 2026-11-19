"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { ProfileCard as Card } from "@/lib/domain/profileCard";
import { profileCardBackSvg, profileCardSvg } from "@/lib/client/profileCardExport";

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
 * The membership card: artwork on the front and a handwritten note on the back. Tilts toward the
 * pointer (or the phone); hovering turns it over to show the note, and a click or tap flips it.
 * No labels or hints around it: the card explains itself.
 */
export interface CardNote {
  text: string;
  from: string;
}

export function ProfileCard({ card, note }: { card: Card; note: CardNote }) {
  const id = useId();
  const tilt = useRef<HTMLElement>(null);
  const permissionRequired = useSyncExternalStore(subscribe, needsPermission, () => false);
  const permissionAsked = useRef(false);
  const [flipped, setFlipped] = useState(false);
  const named = { ...card, name: card.name.trim() || "Your name" };
  const front = profileCardSvg(named, id);
  const back = profileCardBackSvg(named, note, `${id}-b`);
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
        onPointerEnter={(event) => event.pointerType === "mouse" && setFlipped(true)}
        onPointerLeave={(event) => {
          reset();
          if (event.pointerType === "mouse") setFlipped(false);
        }}
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
          onClick={() => {
            setFlipped((f) => !f);
            // iPhones only allow tilt after a tap, so the first tap on the card asks for it.
            if (permissionRequired && !permissionAsked.current && "requestPermission" in DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === "function") {
              permissionAsked.current = true;
              DeviceOrientationEvent.requestPermission().catch(() => {});
            }
          }}
        />
        <p className="sr-only" aria-live="polite">
          {flipped
            ? `Back: a handwritten note from ${note.from}: ${note.text.replace(/\n/g, " ")}`
            : `Front: ${named.name}${card.subtitle ? `, ${card.subtitle}` : ""}.`}
        </p>
      </article>
    </>
  );
}
