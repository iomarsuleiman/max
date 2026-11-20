"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker. Kept tiny: it's on every page, including the landing.
 *
 * Also stops iOS from zooming into text fields when you tap them (it zooms into any field with
 * text under 16px and doesn't zoom back): on iPhone and iPad only, the viewport gets
 * maximum-scale=1. iOS still lets people pinch-zoom (it ignores that limit for zooming by hand),
 * and other devices keep the plain viewport.
 */
export function OfflineRegistration() {
  useEffect(() => {
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (ios && meta && !/maximum-scale/.test(meta.content)) meta.content = `${meta.content}, maximum-scale=1`;
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
