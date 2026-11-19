import type { ComponentType, SVGProps } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Max's hand-drawn icons: a regular icon whose lines get a slight ink wobble (the `#max-doodle`
 * filter from DoodleDefs), over a soft, lopsided blob of color.
 */
export function Doodle({ icon: Icon, color, className, size = 18 }: { icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number; strokeWidth?: number }>; color: string; className?: string; size?: number }) {
  return (
    <span className={cn("doodle", className)} style={{ "--doodle": color, width: size + 4, height: size + 4 } as React.CSSProperties} aria-hidden>
      <Icon className="doodle-glyph" size={size} strokeWidth={2.1} />
    </span>
  );
}

/** The ink-wobble filter, mounted once per page. */
export function DoodleDefs() {
  return (
    <svg width="0" height="0" aria-hidden focusable="false" style={{ position: "absolute" }}>
      <filter id="max-doodle" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="wobble" />
        <feDisplacementMap in="SourceGraphic" in2="wobble" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

/** The colors of Max's doodles, one per kind of thing. */
export const DOODLE = {
  pink: "#f06f8f",
  amber: "#f2a922",
  teal: "#2fa5b8",
  violet: "#8b6cf0",
  mint: "#2bb595",
  blue: "#4f8de6",
  orange: "#ef8a3c",
  sage: "#6f9c6f",
  lilac: "#b08ad6",
  red: "#e5594f",
  gray: "#8b8b8b",
} as const;
