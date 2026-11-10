import { profileCardSchema, type ProfileCard } from "./profileCard";

const palettes = {
  sunset: { ink: "#ad3e10", first: "#ffb52d", second: "#ff7e94", dark: "#ee6c30", glow: "#ffe6a1" },
  ocean: { ink: "#27596e", first: "#42a9bc", second: "#82d4c3", dark: "#3762a2", glow: "#c5f2e5" },
  sage: { ink: "#3c5c3e", first: "#b8ce77", second: "#79a487", dark: "#4c7958", glow: "#e6ecab" },
  clay: { ink: "#854733", first: "#e6a46f", second: "#dc897a", dark: "#ba6047", glow: "#f9d5a1" },
  lilac: { ink: "#684778", first: "#bc9fda", second: "#eea4be", dark: "#8864b2", glow: "#f6d5eb" },
} satisfies Record<ProfileCard["theme"], { ink: string; first: string; second: string; dark: string; glow: string }>;

const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);

/** Bounded wrapping keeps long names and unbroken words inside the paper. */
function wrap(text: string, limit: number): string[] {
  if (!text.trim()) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    if (line && Array.from(`${line} ${word}`).length > limit) {
      lines.push(line);
      line = "";
    }
    const characters = Array.from(word);
    while (characters.length > limit) lines.push(characters.splice(0, limit).join(""));
    if (characters.length) line = [line, characters.join("")].filter(Boolean).join(" ");
  }
  if (line) lines.push(line);
  return lines;
}

function textLines(lines: string[], y: number, size: number, color: string, weight: number, gap: number): string {
  return lines
    .map((line, index) => {
      const rtl = /^[^\p{L}]*\p{Script=Arabic}/u.test(line);
      return `<text x="${rtl ? 336 : 24}" y="${y + index * gap}" font-size="${size}" font-weight="${weight}" fill="${color}" direction="${rtl ? "rtl" : "ltr"}" unicode-bidi="plaintext">${escapeXml(line)}</text>`;
    })
    .join("");
}

/** Preview and download share this self-contained SVG, with no external URLs. */
export function profileCardSvg(input: ProfileCard, prefix = "card"): { svg: string; width: number; height: number } {
  const card = profileCardSchema.parse(input);
  const palette = palettes[card.theme];
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "");
  const gradientId = `${safePrefix}-gradient`;
  const glowId = `${safePrefix}-glow`;
  const dotsId = `${safePrefix}-dots`;
  const clipId = `${safePrefix}-clip`;
  const titleId = `${safePrefix}-title`;
  const nameSize = card.name.length > 32 ? 23 : 28;
  const names = wrap(card.name, nameSize === 28 ? 18 : 23);
  const subtitles = wrap(card.subtitle, 33);
  const bios = wrap(card.bio, 44);
  const nameY = 346;
  const subtitleY = nameY + names.length * (nameSize + 4) + 2;
  const bioY = subtitleY + subtitles.length * 21 + (bios.length ? 8 : 0);
  const footerY = Math.max(492, bioY + bios.length * 18 + 36);
  const height = footerY + 40;
  const fill = card.pattern === "plain" ? palette.first : `url(#${gradientId})`;
  const shape =
    card.shape === "arch"
      ? `<path d="M 38 304 L 38 158 A 142 142 0 0 1 322 158 L 322 304 Z" fill="${fill}"/><path d="M 126 304 L 126 185 A 98 98 0 0 1 322 185 L 322 304 Z" fill="${palette.glow}" opacity=".28"/>`
      : card.shape === "leaf"
        ? `<path d="M 46 282 C 16 122 142 27 314 49 C 341 218 228 322 46 282 Z" fill="${fill}"/><path d="M 49 279 Q 145 201 297 65" fill="none" stroke="${palette.glow}" stroke-width="15" opacity=".65"/><path d="M 122 217 Q 94 159 102 126 M 193 156 Q 251 166 281 146" fill="none" stroke="${palette.glow}" stroke-width="8" opacity=".45"/>`
        : `<circle cx="180" cy="164" r="120" fill="${fill}"/><circle cx="180" cy="164" r="65" fill="${palette.glow}" opacity=".35"/><ellipse cx="180" cy="173" rx="183" ry="44" transform="rotate(-24 180 173)" fill="none" stroke="#fff8ec" stroke-width="18"/><circle cx="273" cy="75" r="23" fill="${palette.dark}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}" viewBox="0 0 360 ${height}" role="img" aria-labelledby="${titleId}" style="font-family:Arial,sans-serif">
    <title id="${titleId}">${escapeXml(card.name)}'s Max workspace card</title>
    <defs>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.first}"/><stop offset=".52" stop-color="${palette.dark}"/><stop offset="1" stop-color="${palette.second}"/></linearGradient>
      <radialGradient id="${glowId}"><stop stop-color="${palette.glow}" stop-opacity=".6"/><stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/></radialGradient>
      <pattern id="${dotsId}" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="#fff8ec" opacity=".5"/></pattern>
      <clipPath id="${clipId}"><rect x="24" y="24" width="312" height="280" rx="16"/></clipPath>
    </defs>
    <rect width="360" height="${height}" rx="22" fill="#fff9f0"/>
    <g clip-path="url(#${clipId})">
      <rect x="24" y="24" width="312" height="280" rx="16" fill="${palette.glow}" opacity=".24"/>
      ${shape}
      ${card.pattern !== "plain" ? `<ellipse cx="100" cy="112" rx="150" ry="138" fill="url(#${glowId})"/>` : ""}
      ${card.pattern === "dots" ? `<rect x="24" y="24" width="312" height="280" fill="url(#${dotsId})"/>` : ""}
    </g>
    ${textLines(names, nameY, nameSize, palette.ink, 700, nameSize + 4)}
    ${textLines(subtitles, subtitleY, 16, palette.ink, 500, 21)}
    ${textLines(bios, bioY, 12, "#70645c", 400, 18)}
    <rect x="24" y="${footerY - 12}" width="223" height="25" rx="5" fill="none" stroke="${palette.ink}" stroke-width="1.4"/>
    <path d="M 71 ${footerY - 12} v 25" stroke="${palette.ink}" stroke-width="1"/>
    <text x="35" y="${footerY + 5}" fill="${palette.ink}" font-size="11" font-weight="700">MAX</text>
    <text x="81" y="${footerY + 4}" fill="${palette.ink}" font-size="9" letter-spacing=".6">YOUR WORKSPACE CARD</text>
    <text x="336" y="${footerY - 1}" text-anchor="end" fill="${palette.ink}" font-size="10" font-weight="700">PERSONAL</text>
    <text x="336" y="${footerY + 12}" text-anchor="end" fill="#70645c" font-size="8" letter-spacing="1">PRIVATE</text>
  </svg>`;
  return { svg, width: 360, height };
}
