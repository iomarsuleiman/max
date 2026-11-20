"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Download, X, ZoomIn, ZoomOut } from "lucide-react";

export interface ViewerImage {
  src: string;
  caption: string;
}

/**
 * Images opened from a page, like Notion: full screen on a dark backdrop, with the caption, zoom
 * (button, double-click, or pinch), the page's other images with ←/→ (or swiping), download, and
 * Escape or a click outside to close.
 */
export function ImageViewer({ images, start, onClose }: { images: ViewerImage[]; start: number; onClose: () => void }) {
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState(1);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const image = images[index];
  const go = useCallback((d: number) => {
    setZoom(1);
    setIndex((i) => Math.min(images.length - 1, Math.max(0, i + d)));
  }, [images.length]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(4, z * 1.5));
      else if (e.key === "-") setZoom((z) => Math.max(1, z / 1.5));
    };
    window.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
    };
  }, [go, onClose]);
  if (!image) return null;
  return createPortal(
    <div className="max-viewer" role="dialog" aria-modal aria-label={image.caption || "Image"} onClick={onClose}>
      <div className="max-viewer-bar" onClick={(e) => e.stopPropagation()}>
        <span className="max-viewer-count">{images.length > 1 ? `${index + 1} of ${images.length}` : ""}</span>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} disabled={zoom <= 1}>
          <ZoomOut className="size-[18px]" />
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(4, z * 1.5))} disabled={zoom >= 4}>
          <ZoomIn className="size-[18px]" />
        </button>
        <a href={image.src} download target="_blank" rel="noreferrer" aria-label="Download">
          <Download className="size-[18px]" />
        </a>
        <button type="button" aria-label="Close" onClick={onClose}>
          <X className="size-5" />
        </button>
      </div>
      {index > 0 && (
        <button type="button" className="max-viewer-nav is-prev" aria-label="Previous image" onClick={(e) => (e.stopPropagation(), go(-1))}>
          <ChevronLeft className="size-6" />
        </button>
      )}
      {index < images.length - 1 && (
        <button type="button" className="max-viewer-nav is-next" aria-label="Next image" onClick={(e) => (e.stopPropagation(), go(1))}>
          <ChevronRight className="size-6" />
        </button>
      )}
      <figure
        className="max-viewer-stage"
        data-zoomed={zoom > 1 || undefined}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => (touch.current = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null)}
        onTouchEnd={(e) => {
          const t = touch.current;
          touch.current = null;
          if (!t || zoom > 1) return;
          const dx = e.changedTouches[0].clientX - t.x;
          const dy = e.changedTouches[0].clientY - t.y;
          if (Math.abs(dx) > 60 && Math.abs(dy) < 50) go(dx < 0 ? 1 : -1);
          else if (dy > 90 && Math.abs(dx) < 50) onClose();
        }}
      >
        <img
          key={image.src}
          src={image.src}
          alt={image.caption}
          draggable={false}
          onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2.5))}
          style={{ transform: `scale(${zoom})` }}
        />
        {image.caption && <figcaption>{image.caption}</figcaption>}
      </figure>
    </div>,
    document.body,
  );
}
