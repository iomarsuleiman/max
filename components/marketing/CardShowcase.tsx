"use client";

import { useState } from "react";
import { Shuffle } from "lucide-react";
import { ProfileCard } from "@/components/profile/ProfileCard";
import { profileCardShapes, profileCardThemes, type ProfileCard as Card } from "@/lib/domain/profileCard";

const SUBTITLES = ["Curious explorer", "Quiet daydreamer", "Creative wanderer", "Thoughtful maker", "Bright observer", "Gentle trailblazer"];

/** A sample membership card on the landing page: tilt it, flip it, shuffle its artwork. */
export function CardShowcase() {
  const [card, setCard] = useState<Card>({ name: "Your name here", subtitle: "Curious explorer", bio: "", theme: "sunset", pattern: "gradient", shape: "arch", memberNumber: 1024, createdAt: Date.UTC(2026, 10, 19) });
  return (
    <div className="grid justify-items-center gap-3">
      <div className="w-[min(268px,72vw)]">
        <ProfileCard card={card} />
      </div>
      <button
        type="button"
        className="joy-press inline-flex h-9 items-center gap-2 rounded-full bg-fg/5 px-4 text-[13px] font-medium text-fg hover:bg-fg/10"
        onClick={() => {
          const r = crypto.getRandomValues(new Uint32Array(3));
          const themes = profileCardThemes.filter((t) => t !== card.theme);
          setCard({ ...card, theme: themes[r[0] % themes.length], shape: profileCardShapes[r[1] % profileCardShapes.length], subtitle: SUBTITLES[r[2] % SUBTITLES.length] });
        }}
      >
        <Shuffle className="size-4" aria-hidden /> Shuffle the artwork
      </button>
    </div>
  );
}
