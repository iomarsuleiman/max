"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { cn } from "@/components/ui";
import { coverColor, coverImageUrl, coverStyle, isLocalCover } from "@/lib/client/covers";
import { useAssetResolver } from "@/lib/client/upload";

/** Renders any stored cover value: built-in color/gradient/artwork, uploaded image or link. */
export function CoverView({
  cover,
  className,
  position = 50,
  eager = false,
  sizes = "100vw",
}: {
  cover: string | null | undefined;
  className?: string;
  position?: number;
  /** The page's own cover: load it first (it's usually the largest paint). */
  eager?: boolean;
  /** How wide the cover renders, so the browser picks a small file for thumbnails. */
  sizes?: string;
}) {
  const [loaded, setLoaded] = useState<string | null>(null);
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
  const color = coverColor(cover);
  if (src && isLocalCover(cover)) {
    // Built-in artwork: resized AVIF/WebP from Next's image optimizer, over its average color.
    return (
      <div className={cn("relative overflow-hidden", className)} style={{ background: color ?? "var(--surface-2)" }}>
        <Image
          src={src}
          alt=""
          fill
          sizes={sizes}
          quality={72}
          preload={eager}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          onLoad={() => setLoaded(cover)}
          style={{ objectFit: "cover", objectPosition: `center ${position}%` }}
          className={cn("transition-opacity duration-300 motion-reduce:transition-none", loaded === cover || eager ? "opacity-100" : "opacity-0")}
        />
      </div>
    );
  }
  return src ? (
    <img
      fetchPriority={eager ? "high" : "auto"}
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
