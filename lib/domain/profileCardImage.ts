import qrcode from "qrcode-generator";
import { profileCardSchema, type ProfileCard } from "./profileCard";

// A tiny static tile is masked to colored artwork, never the paper or QR.
const ART_GRAIN = "data:image/png;base64,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";

const palettes = {
  sunset: { ink: "#ad3e10", first: "#ffb52d", second: "#ff7e94", dark: "#ee6c30", glow: "#ffe6a1" },
  ocean: { ink: "#27596e", first: "#42a9bc", second: "#82d4c3", dark: "#3762a2", glow: "#c5f2e5" },
  sage: { ink: "#3c5c3e", first: "#b8ce77", second: "#79a487", dark: "#4c7958", glow: "#e6ecab" },
  clay: { ink: "#854733", first: "#e6a46f", second: "#dc897a", dark: "#ba6047", glow: "#f9d5a1" },
  lilac: { ink: "#684778", first: "#bc9fda", second: "#eea4be", dark: "#8864b2", glow: "#f6d5eb" },
  rose: { ink: "#8b3d57", first: "#edafbf", second: "#f2b79d", dark: "#c86c91", glow: "#ffe2c5" },
  mint: { ink: "#236254", first: "#3dc6aa", second: "#c7e5d8", dark: "#299c90", glow: "#e3f3bd" },
  amber: { ink: "#885516", first: "#efc64e", second: "#e09b59", dark: "#bf7c28", glow: "#fff0b2" },
  midnight: { ink: "#344865", first: "#506f9b", second: "#8ba6bd", dark: "#253955", glow: "#ccdde7" },
  lagoon: { ink: "#245d6b", first: "#41b8bc", second: "#9fd6d1", dark: "#327f9f", glow: "#d2eee0" },
  plum: { ink: "#673c65", first: "#a96ba0", second: "#d9a7b9", dark: "#724f8c", glow: "#f4d9ca" },
  citrus: { ink: "#5e6520", first: "#c6d661", second: "#edcf7d", dark: "#89ac59", glow: "#f8f1b7" },
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
  const nameY = 330;
  const subtitleY = nameY + names.length * (nameSize + 4) + 2;
  const footerY = Math.max(480, subtitleY + subtitles.length * 18 + 64);
  const height = footerY + 54;
  const qr = qrcode(0, "M");
  qr.addData("https://max.chaos.fail");
  qr.make();
  const modules = qr.getModuleCount();
  const qrPath = Array.from({ length: modules }, (_, row) =>
    Array.from({ length: modules }, (_, col) => (qr.isDark(row, col) ? `M${col + 4} ${row + 4}h1v1h-1z` : "")).join(""),
  ).join("");
  const fill = card.pattern === "plain" ? palette.first : `url(#${gradientId})`;
  const arch = "M24 298V180A156 156 0 0 1 336 180V298Z";
  const leaf = "M24 298V180Q24 24 180 24H336V142Q336 298 180 298Z";
  const band = "M24 24H336V181Q180 126 24 181ZM24 213Q180 158 336 213V298H24Z";
  const paper = "#fffdf0";
  const shape = card.shape === "arch" ? `<path d="${arch}" fill="${fill}"/>`
    : card.shape === "leaf" ? `<path d="${leaf}" fill="${fill}"/>`
    : card.shape === "band" ? `<path d="${band}" fill="${fill}"/>`
    : `<circle cx="180" cy="164" r="120" fill="${fill}"/><circle cx="180" cy="164" r="65" fill="${palette.glow}" opacity=".35"/><ellipse cx="180" cy="173" rx="183" ry="44" transform="rotate(-24 180 173)" fill="none" stroke="${paper}" stroke-width="18"/><circle cx="273" cy="75" r="23" fill="${palette.dark}"/>`;
  const artMask = card.shape === "arch" ? `<path d="${arch}" fill="white"/>`
    : card.shape === "leaf" ? `<path d="${leaf}" fill="white"/>`
    : card.shape === "band" ? `<path d="${band}" fill="white"/>`
    : `<circle cx="180" cy="164" r="120" fill="white"/><ellipse cx="180" cy="173" rx="183" ry="44" transform="rotate(-24 180 173)" fill="none" stroke="black" stroke-width="18"/><circle cx="273" cy="75" r="23" fill="white"/>`;
  const date = card.createdAt === undefined ? "NEW CARD" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(card.createdAt);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}" viewBox="0 0 360 ${height}" role="img" aria-labelledby="${titleId}" style="font-family:Arial,sans-serif">
    <title id="${titleId}">${escapeXml(card.name)}'s Max workspace card</title>
    <desc>Membership artwork with a QR code that opens Max. No private workspace information is published.</desc>
    <defs>
      <linearGradient class="card-foil-gradient" id="${safePrefix}-foil" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#284b52"/><stop offset=".28" stop-color="#614269"/><stop offset=".48" stop-color="#7a592b"/><stop offset=".7" stop-color="#276355"/><stop offset="1" stop-color="#3b456d"/></linearGradient>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.first}"/><stop offset=".52" stop-color="${palette.dark}"/><stop offset="1" stop-color="${palette.second}"/></linearGradient>
      <radialGradient id="${glowId}"><stop stop-color="${palette.glow}" stop-opacity=".6"/><stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/></radialGradient>
      <pattern id="${dotsId}" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="#fff8ec" opacity=".5"/></pattern>
      <pattern id="${safePrefix}-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V3" stroke="${palette.ink}" stroke-width="1"/></pattern>
      <pattern id="${safePrefix}-grain" width="32" height="32" patternUnits="userSpaceOnUse"><image href="${ART_GRAIN}" width="32" height="32"/></pattern>
      <mask id="${safePrefix}-art-mask" maskUnits="userSpaceOnUse" x="24" y="24" width="312" height="274">${artMask}</mask>
      <clipPath id="${clipId}"><rect x="24" y="24" width="312" height="274" rx="3"/></clipPath>
    </defs>
    <rect width="360" height="${height}" rx="10" fill="#fffdf0" stroke="${palette.ink}" stroke-opacity=".18" stroke-width="1"/>
    <g clip-path="url(#${clipId})">
      ${shape}
      ${card.pattern !== "plain" ? `<ellipse cx="100" cy="112" rx="150" ry="138" fill="url(#${glowId})" mask="url(#${safePrefix}-art-mask)"/>` : ""}
      ${card.pattern === "dots" ? `<rect x="24" y="24" width="312" height="280" fill="url(#${dotsId})" mask="url(#${safePrefix}-art-mask)"/>` : ""}
      <rect class="card-art-grain" x="24" y="24" width="312" height="274" fill="url(#${safePrefix}-grain)" mask="url(#${safePrefix}-art-mask)"/>
    </g>
    ${textLines(names, nameY, nameSize, palette.ink, 700, nameSize + 4)}
    <g font-family="monospace">${textLines(subtitles, subtitleY, 14, palette.ink, 500, 18)}</g>
    <rect x="24" y="${footerY - 12}" width="188" height="25" rx="2" fill="none" stroke="${palette.ink}" stroke-width="1.4"/>
    <path d="M66 ${footerY - 12}v25M80 ${footerY - 12}v25" stroke="${palette.ink}" stroke-width="1"/>
    <rect x="66" y="${footerY - 12}" width="14" height="25" fill="url(#${safePrefix}-hatch)"/>
    <text x="35" y="${footerY + 5}" fill="${palette.ink}" font-size="11" font-weight="700">MAX</text>
    <text x="91" y="${footerY + 5}" fill="${palette.ink}" font-size="11" font-weight="600">${date}</text>
    <g class="card-qr" transform="translate(272 ${footerY - 32})">
      <rect width="64" height="64" rx="3" fill="#fffdf0"/>
      <svg width="64" height="64" viewBox="0 0 ${modules + 8} ${modules + 8}"><path class="card-qr-modules" d="${qrPath}" fill="url(#${safePrefix}-foil)" shape-rendering="crispEdges"/></svg>
    </g>
  </svg>`;
  return { svg, width: 360, height };
}
