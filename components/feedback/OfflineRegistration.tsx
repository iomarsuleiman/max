"use client";

import { useEffect } from "react";

/** Registers the offline service worker. Kept tiny: it's on every page, including the landing. */
export function OfflineRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
