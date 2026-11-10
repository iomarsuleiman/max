/**
 * Artwork gallery fetched from open collections (see scripts/fetch-covers.mjs).
 * Stored values: "cover:<id>", legacy "color:<name>" and "gradient:<n>", an https URL,
 * or "max-asset://<id>" for uploads.
 */
export interface CoverCollection {
  name: string;
  items: { value: string; label: string }[];
}

import manifest from "./cover-manifest.json";

export interface CoverCredit {
  value: string;
  label: string;
  creator?: string;
  source?: string;
  license?: string;
  /** Average color, painted while the image loads. */
  color?: string;
}

export const SOLID_COLORS: Record<string, string> = {
  red: "oklch(0.62 0.17 25)",
  orange: "oklch(0.72 0.15 55)",
  yellow: "oklch(0.86 0.13 92)",
  green: "oklch(0.66 0.12 155)",
  teal: "oklch(0.64 0.09 195)",
  blue: "oklch(0.58 0.12 250)",
  purple: "oklch(0.56 0.13 300)",
  pink: "oklch(0.72 0.12 355)",
  sand: "oklch(0.86 0.04 80)",
  graphite: "oklch(0.32 0.01 260)",
};

/** Public-domain artwork and photography fetched by scripts/fetch-covers.mjs (The Met, NASA, Webb). */
const fetched = (manifest as { collections: { name: string; items: CoverCredit[] }[] }).collections;

export const COVER_COLLECTIONS: CoverCollection[] = fetched.map((c) => ({ name: c.name, items: c.items.map((i) => ({ value: i.value, label: [i.label, i.creator].filter(Boolean).join(" · ") })) }));

export function coverCredit(value: string): CoverCredit | undefined {
  for (const c of fetched) for (const i of c.items) if (i.value === value) return i;
  return undefined;
}

const colors = new Map(fetched.flatMap((c) => c.items.map((i) => [i.value, i.color] as const)));

/** The average color of a built-in cover, or of a solid color cover. */
export function coverColor(cover: string | null | undefined): string | undefined {
  if (!cover) return undefined;
  if (cover.startsWith("color:")) return SOLID_COLORS[cover.slice(6)];
  return colors.get(cover) ?? undefined;
}

/** Built-in covers are local files, so Next can resize them and serve AVIF/WebP. */
export function isLocalCover(cover: string | null | undefined): boolean {
  return !!cover?.startsWith("cover:");
}

export const ALL_COVERS = COVER_COLLECTIONS.flatMap((c) => c.items.map((i) => i.value));

export function coverImageUrl(cover: string | null | undefined): string | null {
  if (cover?.startsWith("cover:")) return `/covers/${cover.slice(6).replace(/[^a-z0-9-]/g, "")}.jpg`;
  if (cover?.startsWith("https://")) return cover;
  return null;
}

/** CSS background for built-in covers, or null when it's an image URL to load. */
export function coverStyle(cover: string | null | undefined): React.CSSProperties | null {
  if (!cover) return null;
  if (cover.startsWith("color:")) return { background: SOLID_COLORS[cover.slice(6)] ?? SOLID_COLORS.sand };
  if (cover.startsWith("cover:")) return { backgroundImage: `url(/covers/${cover.slice(6).replace(/[^a-z0-9-]/g, "")}.jpg)`, backgroundSize: "cover", backgroundPosition: "center" };
  return null;
}
