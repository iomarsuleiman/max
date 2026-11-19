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

export const INVITE_ORIGIN = "https://max.chaos.fail";

/** The card's QR is an invite: it opens Max's join page, naming the member who shared it by number only. */
export function inviteUrl(memberNumber?: number) {
  return `${INVITE_ORIGIN}/join${memberNumber ? `?from=${memberNumber}` : ""}`;
}

export const formatMemberNumber = (n?: number | null) => (n ? `NO. ${String(n).padStart(6, "0")}` : "NO. ——————");

function qrPathFor(data: string) {
  const qr = qrcode(0, "M");
  qr.addData(data);
  qr.make();
  const modules = qr.getModuleCount();
  const path = Array.from({ length: modules }, (_, row) =>
    Array.from({ length: modules }, (_, col) => (qr.isDark(row, col) ? `M${col + 4} ${row + 4}h1v1h-1z` : "")).join(""),
  ).join("");
  return { modules, path };
}

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

function textLines(lines: string[], y: number, size: number, color: string, weight: number, gap: number, spacing = 0): string {
  return lines
    .map((line, index) => {
      const rtl = /^[^\p{L}]*\p{Script=Arabic}/u.test(line);
      const tracking = spacing && !rtl ? ` letter-spacing="${spacing}"` : "";
      return `<text x="${rtl ? 336 : 24}" y="${y + index * gap}" font-size="${size}" font-weight="${weight}"${tracking} fill="${color}" direction="${rtl ? "rtl" : "ltr"}" unicode-bidi="plaintext">${escapeXml(line)}</text>`;
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
  const subtitles = wrap(card.subtitle, 30).map((line) => line.toLocaleUpperCase("en"));
  const nameY = 362;
  const subtitleY = nameY + names.length * (nameSize + 4) + 2;
  const footerY = Math.max(510, subtitleY + subtitles.length * 17 + 64);
  const height = footerY + 54;
  const { modules, path: qrPath } = qrPathFor(inviteUrl(card.memberNumber));
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
    <desc>Membership artwork with a QR code that invites people to Max. No private workspace information is published.</desc>
    <defs>
      <linearGradient class="card-foil-gradient" id="${safePrefix}-qr-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.ink}"/><stop offset=".2" stop-color="${shade(palette.dark, .58)}"/><stop offset=".27" stop-color="${shade(palette.first, .42)}"/><stop offset=".32" stop-color="${palette.ink}"/><stop offset=".52" stop-color="${shade(palette.dark, .55)}"/><stop offset=".6" stop-color="${shade(palette.second, .42)}"/><stop offset=".65" stop-color="${palette.ink}"/><stop offset=".82" stop-color="${shade(palette.dark, .58)}"/><stop offset="1" stop-color="${palette.ink}"/></linearGradient>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.first}"/><stop offset=".52" stop-color="${palette.dark}"/><stop offset="1" stop-color="${palette.second}"/></linearGradient>
      <pattern id="${safePrefix}-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V3" stroke="${palette.ink}" stroke-width="1"/></pattern>
      <linearGradient class="card-light-gradient" id="${safePrefix}-art-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".36" stop-color="#fff" stop-opacity=".04"/><stop offset=".55" stop-color="#fff" stop-opacity=".24"/><stop offset=".76" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".06"/></linearGradient>
      <filter id="${safePrefix}-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
      <mask id="${safePrefix}-art-mask" maskUnits="userSpaceOnUse" x="24" y="24" width="312" height="274">${artMask}</mask>
      <clipPath id="${clipId}"><rect x="24" y="24" width="312" height="274" rx="12"/></clipPath>
    </defs>
    <rect width="360" height="${height}" rx="20" fill="#fffdf0" stroke="${palette.ink}" stroke-opacity=".18" stroke-width="1"/>
    <g clip-path="url(#${clipId})">
      ${shape}
      <rect class="card-art-light" x="24" y="24" width="312" height="274" fill="url(#${safePrefix}-art-light)" mask="url(#${safePrefix}-art-mask)"/>
      <rect class="card-grain" x="24" y="24" width="312" height="274" filter="url(#${safePrefix}-grain)" mask="url(#${safePrefix}-art-mask)" opacity=".18"/>
    </g>
    <g font-family="monospace" font-size="10.5" font-weight="700" letter-spacing="1.6" fill="${palette.ink}">
      <text x="24" y="${nameY - 40}">MAX MEMBER</text>
      <text x="336" y="${nameY - 40}" text-anchor="end">${escapeXml(formatMemberNumber(card.memberNumber))}</text>
    </g>
    <path d="M24 ${nameY - 31}H336" stroke="${palette.ink}" stroke-opacity=".22" stroke-dasharray="2 3"/>
    ${textLines(names, nameY, nameSize, palette.ink, 700, nameSize + 4, -.5)}
    <g font-family="monospace">${textLines(subtitles, subtitleY, 12, palette.ink, 600, 17, 1.7)}</g>
    <rect x="24" y="${footerY - 14}" width="${Math.round(77 + date.length * 7.4)}" height="28" rx="2" fill="none" stroke="${palette.ink}" stroke-width="1.4"/>
    <path d="M66 ${footerY - 14}v28M80 ${footerY - 14}v28" stroke="${palette.ink}" stroke-width="1"/>
    <rect x="66" y="${footerY - 14}" width="14" height="28" fill="url(#${safePrefix}-hatch)"/>
    <text x="35" y="${footerY + 5}" fill="${palette.ink}" font-size="11" font-weight="700" letter-spacing=".4">MAX</text>
    <text x="91" y="${footerY + 5}" fill="${palette.ink}" font-size="13.5" font-weight="700">${date}</text>
    <g class="card-qr" transform="translate(248 ${footerY - 44})">
      <rect width="88" height="88" rx="3" fill="#fffdf0"/>
      <svg width="88" height="88" viewBox="0 0 ${modules + 8} ${modules + 8}"><path class="card-qr-modules" d="${qrPath}" fill="url(#${safePrefix}-qr-light)" shape-rendering="crispEdges"/></svg>
    </g>
  </svg>`;
  return { svg, width: 360, height };
}

/**
 * The back of the card: a handwritten member number and join date, a signature, and the invite QR.
 */
export function profileCardBackSvg(input: ProfileCard, prefix = "card", height = 564): string {
  const card = profileCardSchema.parse(input);
  const palette = palettes[card.theme];
  const id = prefix.replace(/[^a-zA-Z0-9_-]/g, "");
  const { modules, path } = qrPathFor(inviteUrl(card.memberNumber));
  const date = card.createdAt === undefined ? "today" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(card.createdAt);
  const number = card.memberNumber ? `#${card.memberNumber.toLocaleString("en-US")}` : "#—";
  const first = (Array.from(card.name.trim().split(/\s+/u)[0] ?? "").slice(0, 18).join("")) || "Me";
  const qrSize = 132;
  const qrY = height - qrSize - 74;
  // In the app, the .card-hand class supplies the handwriting font; standalone files use these.
  const handFont = `font-family="'Caveat', 'Segoe Script', 'Bradley Hand', cursive"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}" viewBox="0 0 360 ${height}" role="img" aria-labelledby="${id}-back-title" style="font-family:Arial,sans-serif">
    <title id="${id}-back-title">Back of the card: member ${escapeXml(number)} of Max, joined ${escapeXml(date)}, with a QR invite to Max</title>
    <defs>
      <pattern id="${id}-lines" width="360" height="26" patternUnits="userSpaceOnUse"><path d="M0 25.5H360" stroke="${palette.ink}" stroke-opacity=".09"/></pattern>
      <filter id="${id}-back-grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
    </defs>
    <rect width="360" height="${height}" rx="20" fill="#fffdf0" stroke="${palette.ink}" stroke-opacity=".18"/>
    <rect x="1" y="1" width="358" height="${height - 2}" rx="19" filter="url(#${id}-back-grain)" opacity=".07"/>
    <rect x="0" y="0" width="360" height="10" fill="${palette.first}"/><rect x="0" y="10" width="360" height="5" fill="${palette.second}"/>
    <rect x="24" y="60" width="312" height="182" fill="url(#${id}-lines)"/>
    <g font-family="monospace" font-size="10.5" font-weight="700" letter-spacing="1.6" fill="${palette.ink}" opacity=".8">
      <text x="24" y="48">MEMBER NUMBER</text><text x="336" y="48" text-anchor="end">MAX</text>
    </g>
    <g ${handFont} fill="${palette.ink}">
      <text class="card-hand" x="22" y="140" font-size="76" transform="rotate(-4 22 140)">${escapeXml(number)}</text>
      <text class="card-hand" x="26" y="196" font-size="23" transform="rotate(-2 26 196)">joined Max on ${escapeXml(date)}</text>
      <text class="card-hand" x="30" y="232" font-size="23" transform="rotate(-1.5 30 232)">— ${escapeXml(first)}</text>
    </g>
    <path d="M28 ${qrY - 22}H332" stroke="${palette.ink}" stroke-opacity=".22" stroke-dasharray="2 3"/>
    <g transform="translate(24 ${qrY})">
      <rect width="${qrSize}" height="${qrSize}" rx="8" fill="#fff" stroke="${palette.ink}" stroke-opacity=".15"/>
      <svg x="4" y="4" width="${qrSize - 8}" height="${qrSize - 8}" viewBox="0 0 ${modules + 8} ${modules + 8}"><path d="${path}" fill="${palette.ink}" shape-rendering="crispEdges"/></svg>
    </g>
    <g fill="${palette.ink}">
      <text x="172" y="${qrY + 26}" font-size="15" font-weight="700">You're invited</text>
      <text x="172" y="${qrY + 48}" font-size="12" opacity=".75">Scan to join Max,</text>
      <text x="172" y="${qrY + 64}" font-size="12" opacity=".75">a calm home for notes,</text>
      <text x="172" y="${qrY + 80}" font-size="12" opacity=".75">pages and databases.</text>
      <text x="172" y="${qrY + 118}" font-family="monospace" font-size="10" letter-spacing="1" opacity=".7">MAX.CHAOS.FAIL/JOIN</text>
    </g>
    <text x="180" y="${height - 26}" text-anchor="middle" font-family="monospace" font-size="9" letter-spacing="1.4" fill="${palette.ink}" opacity=".5">NO PRIVATE WORKSPACE DATA ON THIS CARD</text>
  </svg>`;
}
