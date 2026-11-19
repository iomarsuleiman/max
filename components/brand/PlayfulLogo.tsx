"use client";

import { useEffect, useRef, useState } from "react";
import { MARK_PATH } from "./Logo";

/**
 * The landing butterfly. Instead of spinning (which never reads as a butterfly), its wings
 * fold toward each other in 3D and open again: once on arrival, on hover, and on tap, click,
 * Enter or Space. With reduced motion (system or Max setting) it stays still.
 */
export function PlayfulLogo() {
  const [flaps, setFlaps] = useState(0); // bumping the key restarts the animation
  const [still, setStill] = useState(false);
  const busy = useRef(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setStill(media.matches || document.documentElement.dataset.reduceMotion === "on");
    update();
    media.addEventListener("change", update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-reduce-motion"] });
    const hello = window.setTimeout(() => setFlaps((n) => (n === 0 ? 1 : n)), 500);
    return () => {
      media.removeEventListener("change", update);
      observer.disconnect();
      window.clearTimeout(hello);
    };
  }, []);
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
        className="butterfly text-fg focus-visible:ring-fg grid size-44 place-items-center rounded-[44px] outline-none select-none focus-visible:ring-2 focus-visible:ring-offset-8 sm:size-52"
        data-still={still || undefined}
        onClick={flap}
        onPointerEnter={(e) => e.pointerType === "mouse" && flap()}
      >
        <span
          key={flaps}
          className="butterfly-body flex size-40 sm:size-48"
          data-flapping={flaps > 0 && !still ? "" : undefined}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget.lastElementChild) busy.current = false;
          }}
        >
          <span className="butterfly-wing butterfly-wing--left">{wings("left")}</span>
          <span className="butterfly-wing butterfly-wing--right">{wings("right")}</span>
        </span>
      </button>
    </div>
  );
}
