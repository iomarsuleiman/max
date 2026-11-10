"use client";

import { useEffect, useState } from "react";
import { cn } from "@/components/ui";
import { coverImageUrl, coverStyle } from "@/lib/client/covers";
import { useAssetResolver } from "@/lib/client/upload";

/** Renders any stored cover value: built-in color/gradient/artwork, uploaded image or link. */
export function CoverView({
  cover,
  className,
  position = 50,
  eager = false,
}: {
  cover: string | null | undefined;
  className?: string;
  position?: number;
  eager?: boolean;
}) {
  const resolve = useAssetResolver();
  const direct = coverImageUrl(cover);
  const style = direct ? null : coverStyle(cover);
  const gradient = cover?.startsWith("gradient:") ? `cover-gradient-${cover.split(":")[1]}` : null;
  const [resolved, setResolved] = useState<{ cover: string; src: string } | null>(null);
  useEffect(() => {
    let live = true;
    if (cover?.startsWith("max-asset://"))
      void resolve(cover)
        .then((u) => {
          if (live && u) setResolved({ cover, src: u });
        })
        .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [cover, resolve]);
  const src = direct ?? (resolved && resolved.cover === cover ? resolved.src : null);
  if (!cover) return <div className={cn("bg-surface-2", className)} />;
  if (style) return <div className={className} style={style} />;
  if (gradient) return <div className={cn(gradient, className)} />;
  return src ? (
    <img
      src={src}
      alt=""
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      style={{ objectPosition: `center ${position}%` }}
      className={cn("object-cover", className)}
    />
  ) : (
    <div className={cn("skeleton rounded-none", className)} />
  );
}
