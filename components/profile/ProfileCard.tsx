"use client";

import { useId } from "react";
import type { ProfileCard as Card } from "@/lib/domain/profileCard";
import { profileCardSvg } from "@/lib/client/profileCardExport";

export function ProfileCard({ card }: { card: Card }) {
  const id = useId();
  const { svg } = profileCardSvg({ ...card, name: card.name.trim() || "Your name" }, id);
  return (
    <article aria-label="Your profile card preview" className="shadow-pop mx-auto w-full max-w-[360px] overflow-hidden rounded-[22px]">
      <div className="[&>svg]:block [&>svg]:h-auto [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
    </article>
  );
}
