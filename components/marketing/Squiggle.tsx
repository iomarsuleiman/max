import type { ReactNode } from "react";

/** A hand-drawn wavy line that fills its width (Arc-style section ornament). */
export function Squiggle({ className }: { className?: string }) {
  return <span aria-hidden className={`squiggle ${className ?? ""}`} />;
}

/** A small uppercase label between two wavy lines, introducing a section. */
export function SquiggleLabel({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <p id={id} className="squiggle-label">
      <Squiggle />
      <span>{children}</span>
      <Squiggle />
    </p>
  );
}
