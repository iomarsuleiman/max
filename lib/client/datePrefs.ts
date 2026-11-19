/**
 * How dates and times are written (Settings → Preferences → Date & time). Set once from your
 * settings and read by every date in the app.
 */
export type DateFormat = "medium" | "us" | "eu" | "iso";
export type TimeFormat = "12h" | "24h";
export type WeekStart = "monday" | "sunday";

const prefs: { dateFormat: DateFormat; timeFormat: TimeFormat; weekStart: WeekStart } = { dateFormat: "medium", timeFormat: "12h", weekStart: "monday" };

export function setDatePrefs(next: Partial<typeof prefs>) {
  for (const [k, v] of Object.entries(next)) if (v) (prefs as Record<string, string>)[k] = v;
}
export const datePrefs = () => prefs;

const pad = (n: number) => String(n).padStart(2, "0");

/** A calendar date in your chosen format. */
export function formatDay(d: Date): string {
  switch (prefs.dateFormat) {
    case "us":
      return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    case "eu":
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
    case "iso":
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    default:
      return d.toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" });
  }
}

/** A time of day on your chosen clock. */
export function formatTime(d: Date): string {
  return d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit", hour12: prefs.timeFormat === "12h" });
}

export const formatDayTime = (d: Date) => `${formatDay(d)}, ${formatTime(d)}`;

/** 0 for Sunday, 1 for Monday: where calendars start their weeks. */
export const firstDayOfWeek = () => (prefs.weekStart === "sunday" ? 0 : 1);
