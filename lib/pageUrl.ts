/**
 * Page URLs read like Notion's: /p/<title-words>-<id>, e.g. /p/video-pipeline-q3ffxm4ea001.
 * The id is everything after the last hyphen (ids never contain one), so a renamed page's
 * old links keep working, and the bare /p/<id> form still resolves.
 */

const MAX_SLUG = 60;

/** Lowercase words from the title, joined by hyphens. Letters in any script are kept. */
export function pageSlug(title: string | null | undefined): string {
  const words = (title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  let slug = "";
  for (const w of words) {
    const next = slug ? `${slug}-${w}` : w;
    if (next.length > MAX_SLUG) break;
    slug = next;
  }
  return slug || "untitled";
}

export function pageHref(id: string, title?: string | null): string {
  return title === undefined ? `/p/${id}` : `/p/${encodeURI(pageSlug(title))}-${id}`;
}

/** The page id in a /p/ route segment, with or without the title words. */
export function pageIdFromParam(segment: string): string {
  const decoded = (() => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  })();
  return decoded.slice(decoded.lastIndexOf("-") + 1);
}

/** The page id in a pathname like /p/video-pipeline-abc123, or null. */
export function pageIdFromPath(pathname: string | null | undefined): string | null {
  const m = /^\/p\/([^/?#]+)/.exec(pathname ?? "");
  return m ? pageIdFromParam(m[1]) : null;
}

/** Matches internal page links in stored content: /p/<id> or /p/<slug>-<id>. Group 1 is the id. */
export const PAGE_LINK_RE = /\/p\/(?:[^/?#\s"']*-)?([A-Za-z0-9_]+)(?=[/?#\s"')]|$)/;
