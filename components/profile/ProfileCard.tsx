"use client";

import { useId, useRef } from "react";
import type { ProfileCard as Card } from "@/lib/domain/profileCard";
import { profileCardSvg } from "@/lib/client/profileCardExport";

export function ProfileCard({ card }: { card: Card }) {
  const id = useId();
  const preview = useRef<HTMLElement>(null);
  const { svg } = profileCardSvg({ ...card, name: card.name.trim() || "Your name" }, id);
  const reset = () => {
    preview.current?.style.removeProperty("transform");
    preview.current?.querySelectorAll(".card-light-gradient").forEach((gradient) => gradient.removeAttribute("gradientTransform"));
  };
  return (
    <article
      ref={preview}
      aria-label="Your profile card preview"
      className="profile-card"
      onPointerMove={(event) => {
        if (matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "on") return;
        const box = event.currentTarget.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width - 0.5;
        const y = (event.clientY - box.top) / box.height - 0.5;
        event.currentTarget.querySelectorAll(".card-light-gradient").forEach((gradient) => {
          gradient.setAttribute("gradientTransform", `rotate(${x * 100 + y * 40} .5 .5)`);
        });
        event.currentTarget.style.transform = `perspective(800px) rotateX(${-y * 10}deg) rotateY(${x * 12}deg)`;
      }}
      onPointerLeave={reset}
      onPointerCancel={reset}
      onPointerUp={reset}
    >
      <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </article>
  );
}
