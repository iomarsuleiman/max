/** Turns a share link from a known service into a safe embed URL (allow-list only). */
export interface Embed {
  src: string;
  provider: string;
  aspect: number; // height / width
}

export function toEmbed(raw: string): Embed | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;
  const m = (re: RegExp) => re.exec(path);
  if (host === "vimeo.com" && m(/^\/(\d+)/)) return { src: `https://player.vimeo.com/video/${m(/^\/(\d+)/)![1]}`, provider: "Vimeo", aspect: 9 / 16 };
  if (host === "loom.com" && m(/^\/share\/([\w-]+)/)) return { src: `https://www.loom.com/embed/${m(/^\/share\/([\w-]+)/)![1]}`, provider: "Loom", aspect: 9 / 16 };
  if (host === "figma.com" && /^\/(file|design|proto|board)\//.test(path)) return { src: `https://www.figma.com/embed?embed_host=max&url=${encodeURIComponent(url.href)}`, provider: "Figma", aspect: 0.6 };
  if ((host === "google.com" || host === "maps.google.com") && (path.startsWith("/maps") || host === "maps.google.com")) {
    const q = url.searchParams.get("q") ?? decodeURIComponent(path.split("/place/")[1]?.split("/")[0] ?? "").replace(/\+/g, " ");
    if (q) return { src: `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`, provider: "Google Maps", aspect: 0.6 };
  }
  if (host === "docs.google.com" && m(/^\/(document|spreadsheets|presentation|forms)\/d\/([\w-]+)/)) {
    const [, kind, id] = m(/^\/(document|spreadsheets|presentation|forms)\/d\/([\w-]+)/)!;
    return { src: `https://docs.google.com/${kind}/d/${id}/${kind === "forms" ? "viewform?embedded=true" : "preview"}`, provider: "Google Docs", aspect: kind === "presentation" ? 0.6 : 1 };
  }
  if (host === "codepen.io" && m(/^\/([\w-]+)\/pen\/(\w+)/)) {
    const [, user, id] = m(/^\/([\w-]+)\/pen\/(\w+)/)!;
    return { src: `https://codepen.io/${user}/embed/${id}?default-tab=result`, provider: "CodePen", aspect: 0.6 };
  }
  if (host === "open.spotify.com" && m(/^\/(track|album|playlist|episode|show)\/(\w+)/)) {
    const [, kind, id] = m(/^\/(track|album|playlist|episode|show)\/(\w+)/)!;
    return { src: `https://open.spotify.com/embed/${kind}/${id}`, provider: "Spotify", aspect: kind === "track" || kind === "episode" ? 0.25 : 0.5 };
  }
  if (host === "soundcloud.com") return { src: `https://w.soundcloud.com/player/?url=${encodeURIComponent(url.href)}`, provider: "SoundCloud", aspect: 0.3 };
  if (host === "miro.com" && m(/^\/app\/board\/([\w=-]+)/)) return { src: `https://miro.com/app/live-embed/${m(/^\/app\/board\/([\w=-]+)/)![1]}/`, provider: "Miro", aspect: 0.6 };
  if (host === "airtable.com" && m(/^\/(shr\w+)/)) return { src: `https://airtable.com/embed/${m(/^\/(shr\w+)/)![1]}`, provider: "Airtable", aspect: 0.6 };
  if (host.endsWith("typeform.com") && m(/^\/to\/(\w+)/)) return { src: url.href, provider: "Typeform", aspect: 0.7 };
  return null;
}

export const EMBED_PROVIDERS = "Figma, Vimeo, Loom, Google Maps, Docs, Sheets and Slides, CodePen, Spotify, SoundCloud, Miro, Airtable and Typeform";
