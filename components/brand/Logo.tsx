import type { SVGProps } from "react";

/** The Max butterfly mark. Inherits the current text colour. */
import { MARK_PATH } from "@/lib/brand";
export { MARK_PATH };

export function LogoMark({ title, ...props }: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" role={title ? "img" : undefined} aria-hidden={title ? undefined : true} {...props}>
      {title && <title>{title}</title>}
      <path d={MARK_PATH} />
    </svg>
  );
}

/** The mark on its tile, as used for the app icon. */
export function LogoTile({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={className} style={{ width: size, height: size, display: "inline-grid", placeItems: "center", borderRadius: size * 0.24, background: "var(--fg)", color: "var(--canvas)", flex: "none" }} aria-hidden>
      <LogoMark style={{ width: size * 0.72, height: size * 0.72 }} />
    </span>
  );
}
