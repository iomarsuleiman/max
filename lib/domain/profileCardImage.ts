import qrcode from "qrcode-generator";
import { cardPalettes as palettes, profileCardSchema, type ProfileCard } from "./profileCard";
import { MARK_PATH } from "../brand";


const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);

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
type Palette = (typeof palettes)[keyof typeof palettes];

/**
 * The card's artwork, drawn in the art window (x 24–336, y 24–298). Plain gradients and shapes only:
 * no filters, so the card stays smooth while it tilts and flips. Shape names are kept for saved cards.
 */
function artwork(shape: ProfileCard["shape"], plain: boolean, p: Palette, id: string): { defs: string; art: string } {
  const r = (gid: string, color: string) => `<radialGradient id="${id}-${gid}"><stop stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
  if (shape === "arch") {
    // Aurora: soft glows of the palette drifting over each other.
    return {
      defs: r("a1", p.first) + r("a2", p.second) + r("a3", p.dark) + r("a4", "#ffffff"),
      art: `<rect x="24" y="24" width="312" height="274" fill="${p.glow}"/>
        <circle cx="96" cy="86" r="190" fill="url(#${id}-a1)"/>
        <circle cx="300" cy="120" r="190" fill="url(#${id}-a2)"/>
        <circle cx="200" cy="300" r="${plain ? 150 : 200}" fill="url(#${id}-a3)" opacity=".9"/>
        <circle cx="150" cy="140" r="90" fill="url(#${id}-a4)" opacity=".45"/>`,
    };
  }
  if (shape === "leaf") {
    // Wings: the Max butterfly, large, catching the light.
    return {
      defs: `<linearGradient id="${id}-w" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${p.first}"/><stop offset=".55" stop-color="${p.dark}"/><stop offset="1" stop-color="${p.second}"/></linearGradient>` + r("wg", "#ffffff"),
      art: `<rect x="24" y="24" width="312" height="274" fill="${p.glow}"/>
        <circle cx="180" cy="150" r="170" fill="url(#${id}-wg)" opacity=".7"/>
        <path d="${MARK_PATH}" transform="translate(48 30) scale(2.64)" fill="${p.second}" opacity=".35"/>
        <path d="${MARK_PATH}" transform="translate(40 18) scale(2.8)" fill="${plain ? p.first : `url(#${id}-w)`}"/>`,
    };
  }
  if (shape === "orbit") {
    // Rings: orbits around a small moon.
    const rings = [36, 66, 96, 126, 156, 186].map((rad, i) => `<circle cx="180" cy="175" r="${rad}" fill="none" stroke="${i % 2 ? p.glow : p.second}" stroke-opacity="${0.85 - i * 0.1}" stroke-width="${14 - i * 1.5}"/>`).join("");
    return {
      defs: `<linearGradient id="${id}-o" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${p.dark}"/><stop offset="1" stop-color="${p.ink}"/></linearGradient>`,
      art: `<rect x="24" y="24" width="312" height="274" fill="${plain ? p.dark : `url(#${id}-o)`}"/>${rings}
        <circle cx="180" cy="175" r="20" fill="${p.first}"/>
        <circle cx="286" cy="70" r="16" fill="${p.glow}"/>`,
    };
  }
  // Waves: layered bands, like hills at dusk.
  const wave = (y: number, amp: number, color: string, op: number) =>
    `<path d="M24 ${y} C 90 ${y - amp}, 140 ${y + amp}, 200 ${y} S 300 ${y - amp}, 336 ${y} V298 H24 Z" fill="${color}" opacity="${op}"/>`;
  return {
    defs: `<linearGradient id="${id}-s" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${p.glow}"/><stop offset="1" stop-color="${p.first}"/></linearGradient>`,
    art: `<rect x="24" y="24" width="312" height="274" fill="${plain ? p.glow : `url(#${id}-s)`}"/>
      <circle cx="252" cy="96" r="34" fill="#fffdf0" opacity=".85"/>
      ${wave(150, 28, p.first, 0.9)}${wave(190, 24, p.second, 0.95)}${wave(228, 20, p.dark, 0.95)}${wave(262, 16, p.ink, 0.9)}`,
  };
}

export function profileCardSvg(input: ProfileCard, prefix = "card"): { svg: string; width: number; height: number } {
  const card = profileCardSchema.parse(input);
  const palette = palettes[card.theme];
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "");
  const clipId = `${safePrefix}-clip`;
  const titleId = `${safePrefix}-title`;
  const nameSize = card.name.length > 32 ? 23 : 28;
  const names = wrap(card.name, nameSize === 28 ? 18 : 23);
  const subtitles = wrap(card.subtitle, 30).map((line) => line.toLocaleUpperCase("en"));
  const nameY = 362;
  const subtitleY = nameY + names.length * (nameSize + 4) + 2;
  const footerY = Math.max(510, subtitleY + subtitles.length * 17 + 64);
  const height = footerY + 54;
  const { defs: artDefs, art } = artwork(card.shape, card.pattern === "plain", palette, safePrefix);
  const date = card.createdAt === undefined ? "NEW CARD" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(card.createdAt);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}" viewBox="0 0 360 ${height}" role="img" aria-labelledby="${titleId}" style="font-family:Arial,sans-serif">
    <title id="${titleId}">${escapeXml(card.name)}'s Max workspace card</title>
    <desc>Membership card artwork. No private workspace information is published.</desc>
    <defs>
      ${artDefs}
      <pattern id="${safePrefix}-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V3" stroke="${palette.ink}" stroke-width="1"/></pattern>
      <linearGradient class="card-light-gradient" id="${safePrefix}-art-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".36" stop-color="#fff" stop-opacity=".04"/><stop offset=".55" stop-color="#fff" stop-opacity=".24"/><stop offset=".76" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".06"/></linearGradient>
      <clipPath id="${clipId}"><rect x="24" y="24" width="312" height="274" rx="12"/></clipPath>
    </defs>
    <rect width="360" height="${height}" rx="20" fill="#fffdf0" stroke="${palette.ink}" stroke-opacity=".18" stroke-width="1"/>
    <g clip-path="url(#${clipId})">
      ${art}
      <rect class="card-art-light" x="24" y="24" width="312" height="274" fill="url(#${safePrefix}-art-light)"/>
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
    <path d="${MARK_PATH}" transform="translate(300 ${footerY - 18}) scale(.36)" fill="${palette.ink}" opacity=".85"/>
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
  const qrSize = 150;
  const qrY = height - qrSize - 36;
  // In the app, the .card-hand class supplies the handwriting font; standalone files use these.
  const handFont = `font-family="'Caveat', 'Segoe Script', 'Bradley Hand', cursive"`;
  // Just the handwriting and the code: nothing printed, like the back of a real membership card.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}" viewBox="0 0 360 ${height}" role="img" aria-labelledby="${id}-back-title">
    <title id="${id}-back-title">Back of the card: member ${escapeXml(number)} of Max, joined ${escapeXml(date)}</title>
    <defs><pattern id="${id}-lines" width="360" height="30" patternUnits="userSpaceOnUse"><path d="M0 29.5H360" stroke="${palette.ink}" stroke-opacity=".08"/></pattern></defs>
    <rect width="360" height="${height}" rx="20" fill="#fffdf0" stroke="${palette.ink}" stroke-opacity=".18"/>
    <rect x="0" y="0" width="360" height="8" fill="${palette.first}"/><rect x="0" y="8" width="360" height="4" fill="${palette.second}"/>
    <rect x="24" y="64" width="312" height="210" fill="url(#${id}-lines)"/>
    <g ${handFont} fill="${palette.ink}">
      <text class="card-hand" x="24" y="150" font-size="84" transform="rotate(-4 24 150)">${escapeXml(number)}</text>
      <text class="card-hand" x="28" y="214" font-size="24" transform="rotate(-2 28 214)">${escapeXml(date)}</text>
      <text class="card-hand" x="32" y="254" font-size="26" transform="rotate(-1.5 32 254)">— ${escapeXml(first)}</text>
    </g>
    <g transform="translate(${(360 - qrSize) / 2} ${qrY})">
      <rect width="${qrSize}" height="${qrSize}" rx="10" fill="#fff" stroke="${palette.ink}" stroke-opacity=".12"/>
      <svg x="5" y="5" width="${qrSize - 10}" height="${qrSize - 10}" viewBox="0 0 ${modules + 8} ${modules + 8}"><path d="${path}" fill="${palette.ink}" shape-rendering="crispEdges"/></svg>
    </g>
  </svg>`;
}
