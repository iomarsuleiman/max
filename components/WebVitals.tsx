"use client";

import { useReportWebVitals } from "next/web-vitals";

/** Sends Core Web Vitals (numbers only) to /api/vitals for the performance budgets in docs/PERFORMANCE.md. */
export function WebVitals() {
  useReportWebVitals((metric) => {
    if (!["LCP", "INP", "CLS", "TTFB", "FCP"].includes(metric.name)) return;
    const body = JSON.stringify({ name: metric.name, value: metric.value, rating: metric.rating, route: location.pathname });
    try {
      if (navigator.sendBeacon) navigator.sendBeacon("/api/vitals", new Blob([body], { type: "application/json" }));
      else void fetch("/api/vitals", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } });
    } catch {}
  });
  return null;
}
