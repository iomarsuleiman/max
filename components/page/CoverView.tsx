"use client";

import { useEffect, useState } from "react";
import { cn } from "@/components/ui";
import { coverStyle } from "@/lib/client/covers";
import { useAssetResolver } from "@/lib/client/upload";

/** Renders any stored cover value: built-in color/gradient/artwork, uploaded image or link. */
export function CoverView({ cover, className }: { cover: string | null | undefined; className?: string }) {
  const resolve = useAssetResolver();
  const style = coverStyle(cover);
  const gradient = cover?.startsWith("gradient:") ? `cover-gradient-${cover.split(":")[1]}` : null;
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (cover && !style && !gradient) void resolve(cover).then((u) => live && setSrc(u || null));
    return () => {
      live = false;
    };
  }, [cover, style, gradient, resolve]);
  if (!cover) return <div className={cn("bg-surface-2", className)} />;
  if (style) return <div className={className} style={style} />;
  if (gradient) return <div className={cn(gradient, className)} />;
  return src ? <img src={src} alt="" loading="lazy" className={cn("object-cover", className)} /> : <div className={cn("skeleton rounded-none", className)} />;
}
