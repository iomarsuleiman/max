"use client";

import { FileText, Sheet } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { cn } from "@/components/ui/cn";

/** Icon colors, matching Notion's icon palette (tokens --icon-*, tuned for light and dark). */
export const ICON_COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type IconColor = (typeof ICON_COLORS)[number] | "default";

/** "lucide:<name>:<color>" → parts, or null for an emoji. */
export function parseLucide(icon: string | null | undefined): { name: IconName; color: IconColor } | null {
  if (!icon?.startsWith("lucide:")) return null;
  const [, name, color = "default"] = icon.split(":");
  return { name: name as IconName, color: color as IconColor };
}

export const iconColorVar = (c: IconColor) => (c === "default" ? "var(--fg)" : `var(--icon-${c})`);
export const ICON_COLOR_LABEL: Record<IconColor, string> = { default: "Default", gray: "Gray", brown: "Brown", orange: "Orange", yellow: "Yellow", green: "Green", blue: "Blue", purple: "Purple", pink: "Pink", red: "Red" };

/** A page's emoji or Lucide icon, or a quiet document/database glyph. */
export function PageIcon({ icon, kind, className, size = 16 }: { icon: string | null | undefined; kind?: string; className?: string; size?: number }) {
  const lucide = parseLucide(icon);
  if (lucide) {
    return (
      <span className={cn("inline-grid shrink-0 place-items-center", className)} style={{ width: size + 2, height: size + 2 }} aria-hidden>
        <DynamicIcon name={lucide.name} size={size} strokeWidth={size > 30 ? 1.5 : 1.9} color={iconColorVar(lucide.color)} fallback={() => <span style={{ width: size, height: size }} />} />
      </span>
    );
  }
  if (icon) {
    return (
      <span className={cn("inline-grid shrink-0 place-items-center leading-none", className)} style={{ width: size + 2, height: size + 2, fontSize: size * 0.95 }} aria-hidden>
        {icon}
      </span>
    );
  }
  const Glyph = kind === "database" ? Sheet : FileText;
  return <Glyph className={cn("shrink-0 text-fg-3", className)} style={{ width: size, height: size }} strokeWidth={1.75} aria-hidden />;
}
