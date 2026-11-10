import qrcode from "qrcode-generator";
import { profileCardSchema, type ProfileCard } from "./profileCard";

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

/** Foil needs the palette hue at a QR-safe luminance, so channel values are scaled toward black. */
const shade = (hex: string, factor: number) =>
  "#" + hex.replace(/^#/, "").replace(/[0-9a-fA-F]{2}/g, (pair) => Math.round(parseInt(pair, 16) * factor).toString(16).padStart(2, "0"));

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
      <linearGradient class="card-foil-gradient" id="${safePrefix}-qr-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.ink}"/><stop offset=".2" stop-color="${shade(palette.dark, .58)}"/><stop offset=".27" stop-color="${shade(palette.first, .42)}"/><stop offset=".32" stop-color="${palette.ink}"/><stop offset=".52" stop-color="${shade(palette.dark, .55)}"/><stop offset=".6" stop-color="${shade(palette.second, .42)}"/><stop offset=".65" stop-color="${palette.ink}"/><stop offset=".82" stop-color="${shade(palette.dark, .58)}"/><stop offset="1" stop-color="${palette.ink}"/></linearGradient>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.first}"/><stop offset=".52" stop-color="${palette.dark}"/><stop offset="1" stop-color="${palette.second}"/></linearGradient>
      <pattern id="${safePrefix}-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V3" stroke="${palette.ink}" stroke-width="1"/></pattern>
      <linearGradient class="card-light-gradient" id="${safePrefix}-art-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".36" stop-color="#fff" stop-opacity=".04"/><stop offset=".55" stop-color="#fff" stop-opacity=".24"/><stop offset=".76" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".06"/></linearGradient>
      <filter id="${safePrefix}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
      <mask id="${safePrefix}-art-mask" maskUnits="userSpaceOnUse" x="24" y="24" width="312" height="274">${artMask}</mask>
      <clipPath id="${clipId}"><rect x="24" y="24" width="312" height="274" rx="3"/></clipPath>
    </defs>
    <rect width="360" height="${height}" rx="10" fill="#fffdf0" stroke="${palette.ink}" stroke-opacity=".18" stroke-width="1"/>
    <g clip-path="url(#${clipId})">
      ${shape}
      <rect class="card-art-light" x="24" y="24" width="312" height="274" fill="url(#${safePrefix}-art-light)" mask="url(#${safePrefix}-art-mask)"/>
      <rect class="card-grain" x="24" y="24" width="312" height="274" filter="url(#${safePrefix}-grain)" mask="url(#${safePrefix}-art-mask)" opacity=".18"/>
    </g>
    ${textLines(names, nameY, nameSize, palette.ink, 700, nameSize + 4)}
    <g font-family="monospace">${textLines(subtitles, subtitleY, 14, palette.ink, 500, 18)}</g>
    <rect x="24" y="${footerY - 12}" width="${Math.round(79 + date.length * 6.8)}" height="25" rx="2" fill="none" stroke="${palette.ink}" stroke-width="1.4"/>
    <path d="M66 ${footerY - 12}v25M80 ${footerY - 12}v25" stroke="${palette.ink}" stroke-width="1"/>
    <rect x="66" y="${footerY - 12}" width="14" height="25" fill="url(#${safePrefix}-hatch)"/>
    <text x="35" y="${footerY + 5}" fill="${palette.ink}" font-size="11" font-weight="700">MAX</text>
    <text x="91" y="${footerY + 5}" fill="${palette.ink}" font-size="11" font-weight="600">${date}</text>
    <g class="card-qr" transform="translate(248 ${footerY - 44})">
      <rect width="88" height="88" rx="3" fill="#fffdf0"/>
      <svg width="88" height="88" viewBox="0 0 ${modules + 8} ${modules + 8}"><path class="card-qr-modules" d="${qrPath}" fill="url(#${safePrefix}-qr-light)" shape-rendering="crispEdges"/></svg>
    </g>
  </svg>`;
  return { svg, width: 360, height };
}
