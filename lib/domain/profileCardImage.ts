import qrcode from "qrcode-generator";
import { cardPalettes as palettes, profileCardSchema, type ProfileCard } from "./profileCard";
import { MARK_PATH } from "../brand";


const escapeXml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);

export const INVITE_ORIGIN = "https://max.chaos.fail";

/** The card's QR is an invite: the member's own page (max.chaos.fail/<username>), or the join page. */
export function inviteUrl(memberNumber?: number, username?: string | null) {
  if (username) return `${INVITE_ORIGIN}/${username}`;
  return `${INVITE_ORIGIN}/join${memberNumber ? `?from=${memberNumber}` : ""}`;
}

/** QR modules as one SVG path, with a 4-module quiet zone. */
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

/** The card's corner radius; the artwork window's corners follow it (outer radius minus the margin, kept soft). */
export const CARD_RADIUS = 24;
const ART_RADIUS = 13;

export const formatMemberNumber = (n?: number | null) => (n ? `NO. ${String(n).padStart(6, "0")}` : "NO. ——————");


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

export const CARD_WIDTH = 300;
export const CARD_HEIGHT = 380;

const PAPER = "#fffdf0";
const NOTE_INK = "#26407a";
const HAND = `font-family="'Caveat', 'Segoe Script', 'Bradley Hand', cursive"`;

/**
 * The front of the membership card: Max's rounded cream card with the artwork, your member number,
 * your name and the date you joined. Self-contained SVG (no external URLs or filters); the preview
 * and downloads share it.
 */
export function profileCardSvg(input: ProfileCard, prefix = "card"): { svg: string; width: number; height: number } {
  const card = profileCardSchema.parse(input);
  const palette = palettes[card.theme];
  const id = prefix.replace(/[^a-zA-Z0-9_-]/g, "");
  const { defs: artDefs, art } = artwork(card.shape, card.pattern === "plain", palette, id);
  const name = wrap(card.name.trim() || "Your name", 20)[0] ?? "";
  const subtitle = (wrap(card.subtitle, 30)[0] ?? "").toLocaleUpperCase("en");
  const date = card.createdAt === undefined ? "NEW CARD" : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(card.createdAt);
  const rtl = /^[^\p{L}]*\p{Script=Arabic}/u.test(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-labelledby="${id}-title" style="font-family:Arial,sans-serif">
    <title id="${id}-title">${escapeXml(card.name)}'s Max membership card</title>
    <desc>Membership card artwork. No private workspace information is published.</desc>
    <defs>
      ${artDefs}
      <clipPath id="${id}-art"><rect x="18" y="18" width="264" height="206" rx="${ART_RADIUS}"/></clipPath>
      <pattern id="${id}-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><path d="M0 0V3" stroke="${palette.ink}" stroke-width="1"/></pattern>
      <linearGradient class="card-light-gradient" id="${id}-art-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff" stop-opacity="0"/><stop offset=".45" stop-color="#fff" stop-opacity=".05"/><stop offset=".6" stop-color="#fff" stop-opacity=".22"/><stop offset=".78" stop-color="#fff" stop-opacity=".04"/><stop offset="1" stop-color="#000" stop-opacity=".06"/></linearGradient>
    </defs>
    <rect x=".5" y=".5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="${CARD_RADIUS}" fill="${PAPER}" stroke="${palette.ink}" stroke-opacity=".18"/>
    <g clip-path="url(#${id}-art)">
      <g transform="translate(18 18) scale(${264 / 312} ${206 / 274}) translate(-24 -24)">${art}</g>
      <rect class="card-art-light" x="18" y="18" width="264" height="206" fill="url(#${id}-art-light)"/>
    </g>
    <g font-family="monospace" font-size="8.5" font-weight="700" letter-spacing="1.4" fill="${palette.ink}">
      <text x="18" y="246">MAX MEMBER</text>
      <text x="282" y="246" text-anchor="end">${escapeXml(formatMemberNumber(card.memberNumber))}</text>
    </g>
    <path d="M18 253H282" stroke="${palette.ink}" stroke-opacity=".22" stroke-dasharray="2 3"/>
    <text x="${rtl ? 282 : 18}" y="282" font-size="23" font-weight="700" letter-spacing="-.4" fill="${palette.ink}" direction="${rtl ? "rtl" : "ltr"}" unicode-bidi="plaintext">${escapeXml(name)}</text>
    ${subtitle ? `<text x="18" y="301" font-family="monospace" font-size="9.5" font-weight="600" letter-spacing="1.4" fill="${palette.ink}">${escapeXml(subtitle)}</text>` : ""}
    <rect x="18" y="331" width="${Math.round(64 + date.length * 6.2)}" height="24" rx="2" fill="none" stroke="${palette.ink}" stroke-width="1.2"/>
    <path d="M54 331v24M66 331v24" stroke="${palette.ink}" stroke-width="1"/>
    <rect x="54" y="331" width="12" height="24" fill="url(#${id}-hatch)"/>
    <text x="27" y="347" fill="${palette.ink}" font-size="9.5" font-weight="700" letter-spacing=".4">MAX</text>
    <text x="74" y="347" fill="${palette.ink}" font-size="11.5" font-weight="700">${escapeXml(date)}</text>
    <path d="${MARK_PATH}" transform="translate(252 327) scale(.3)" fill="${palette.ink}" opacity=".85"/>
  </svg>`;
  return { svg, width: CARD_WIDTH, height: CARD_HEIGHT };
}

/** Breaks a note into short handwritten lines, keeping its own line breaks. */
function noteLines(text: string, limit = 28): string[] {
  return text.split("\n").flatMap((line) => (line.trim() ? wrap(line, limit) : [""])).slice(0, 9);
}

/**
 * The back of the card: a handwritten note, from whoever invited you or from Max's maker, with the
 * date you joined, sealed with the butterfly.
 */
export function profileCardBackSvg(input: ProfileCard, note: { text: string; from: string }, prefix = "card", invite?: string | null): string {
  const card = profileCardSchema.parse(input);
  const palette = palettes[card.theme];
  const id = prefix.replace(/[^a-zA-Z0-9_-]/g, "");
  const date = card.createdAt === undefined ? "" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(card.createdAt);
  // The front's own artwork, washed out behind the note, so both sides belong to the same card.
  const { defs: artDefs, art } = artwork(card.shape, card.pattern === "plain", palette, `${id}-w`);
  // Room for the invite QR in the bottom-left corner: up to seven lines of note.
  const lines = noteLines(note.text).slice(0, invite ? 7 : 9);
  const qr = invite ? qrPathFor(invite) : null;
  const first = lines[0] ?? "";
  const rest = lines.slice(1);
  const signY = 118 + rest.length * 27 + 22;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-labelledby="${id}-back-title">
    <title id="${id}-back-title">A handwritten note from ${escapeXml(note.from)}: ${escapeXml(note.text.replace(/\n/g, " "))}</title>
    <defs>${artDefs}<clipPath id="${id}-wash"><rect x=".5" y=".5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="${CARD_RADIUS}"/></clipPath></defs>
    <g>
      <rect x=".5" y=".5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="${CARD_RADIUS}" fill="${PAPER}"/>
      <g clip-path="url(#${id}-wash)" opacity=".26"><g transform="scale(${CARD_WIDTH / 312} ${CARD_HEIGHT / 274}) translate(-24 -24)">${art}</g></g>
      <rect x=".5" y=".5" width="${CARD_WIDTH - 1}" height="${CARD_HEIGHT - 1}" rx="${CARD_RADIUS}" fill="none" stroke="${palette.ink}" stroke-opacity=".18"/>
      ${
        qr
          ? `<g transform="translate(22 288)"><rect width="72" height="72" rx="10" fill="#fff" fill-opacity=".92"/><path d="${qr.path}" transform="scale(${72 / (qr.modules + 8)})" fill="${palette.ink}" shape-rendering="crispEdges"/></g>
             <text x="102" y="350" font-family="monospace" font-size="8" font-weight="700" letter-spacing="1.2" fill="${palette.ink}" opacity=".7">SCAN TO JOIN</text>`
          : `<path d="${MARK_PATH}" transform="translate(26 332) scale(.26)" fill="${palette.ink}" opacity=".5"/>`
      }
      <g ${HAND} fill="${NOTE_INK}">
        ${date ? `<text class="card-hand" x="262" y="52" text-anchor="end" font-size="17">${escapeXml(date)}</text>` : ""}
        <text class="card-hand" x="34" y="94" font-size="27" transform="rotate(-2 34 94)">${escapeXml(first)}</text>
        ${rest.map((l, i) => `<text class="card-hand" x="34" y="${126 + i * 27}" font-size="22" transform="rotate(-1.5 34 ${126 + i * 27})">${escapeXml(l)}</text>`).join("")}
        <text class="card-hand" x="262" y="${Math.min(signY + 12, 340)}" text-anchor="end" font-size="27" transform="rotate(-3 262 ${Math.min(signY + 12, 340)})">${escapeXml(note.from)}</text>
      </g>
    </g>
  </svg>`;
}
