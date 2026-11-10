"use client";

import { FileText, Sheet } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useEffect, useState } from "react";
import { cn } from "@/components/ui/cn";
import { useAssetResolver } from "@/lib/client/upload";

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

export const isImageIcon = (icon: string) => icon.startsWith("max-asset://") || icon.startsWith("https://");

const resolvedIcons = new Map<string, string>();

/** An uploaded or linked image used as an icon, cropped to a rounded square. */
function ImageIcon({ icon, size, className }: { icon: string; size: number; className?: string }) {
  const resolve = useAssetResolver();
  const [resolved, setResolved] = useState<{ icon: string; url: string } | null>(null);
  const linked = icon.startsWith("https://");
  useEffect(() => {
    if (linked || resolvedIcons.has(icon)) return;
    let live = true;
    void resolve(icon)
      .then((url) => {
        if (!url || !live) return;
        resolvedIcons.set(icon, url);
        setResolved({ icon, url });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [icon, linked, resolve]);
  const src = linked ? icon : (resolvedIcons.get(icon) ?? (resolved?.icon === icon ? resolved.url : null));
  return (
    <span className={cn("inline-grid shrink-0 place-items-center", className)} style={{ width: size + 2, height: size + 2 }} aria-hidden>
      {src ? <img src={src} alt="" width={size} height={size} decoding="async" className="size-full rounded-[3px] object-cover" draggable={false} /> : <span className="skeleton size-full rounded-[3px]" />}
    </span>
  );
}

/** A page's emoji, Lucide icon or image, or a quiet document/database glyph. */
export function PageIcon({ icon, kind, className, size = 16 }: { icon: string | null | undefined; kind?: string; className?: string; size?: number }) {
  const lucide = parseLucide(icon);
  if (lucide) {
    return (
      <span className={cn("inline-grid shrink-0 place-items-center", className)} style={{ width: size + 2, height: size + 2 }} aria-hidden>
        <DynamicIcon name={lucide.name} size={size} strokeWidth={size > 30 ? 1.5 : 1.9} color={iconColorVar(lucide.color)} fallback={() => <span style={{ width: size, height: size }} />} />
      </span>
    );
  }
  if (icon && isImageIcon(icon)) return <ImageIcon icon={icon} size={size} className={className} />;
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
