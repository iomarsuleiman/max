const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

export function timeAgo(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "";
  const s = Math.round((ts - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["minute", 60], ["hour", 3600], ["day", 86400], ["week", 604800], ["month", 2629800], ["year", 31557600]];
  let unit: Intl.RelativeTimeFormatUnit = "minute";
  let value = s / 60;
  for (const [u, sec] of units) {
    if (abs >= sec) {
      unit = u;
      value = s / sec;
    }
  }
  return rtf ? rtf.format(Math.round(value), unit) : new Date(ts).toLocaleString();
}

export function fullDate(ts: number | string | null | undefined): string {
  if (ts === null || ts === undefined || ts === "") return "";
  const d = new Date(typeof ts === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ts) ? `${ts}T00:00:00` : ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const pageTitle = (t: string | null | undefined) => (t && t.trim() ? t : "Untitled");

export function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
