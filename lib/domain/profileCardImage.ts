import qrcode from "qrcode-generator";
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
  const nameY = 330;
  const subtitleY = nameY + names.length * (nameSize + 4) + 2;
  const bioY = subtitleY + subtitles.length * 21 + (bios.length ? 8 : 0);
  const footerY = Math.max(480, bioY + bios.length * 18 + 42);
  const height = footerY + 54;
  const qr = qrcode(0, "M");
  qr.addData("https://max.chaos.fail");
  qr.make();
  const modules = qr.getModuleCount();
  const qrPath = Array.from({ length: modules }, (_, row) =>
    Array.from({ length: modules }, (_, col) => (qr.isDark(row, col) ? `M${col + 4} ${row + 4}h1v1h-1z` : "")).join(""),
  ).join("");
  const fill = card.pattern === "plain" ? palette.first : `url(#${gradientId})`;
  const shape =
    card.shape === "arch"
      ? `<path d="M 24 298 L 24 180 A 156 156 0 0 1 336 180 L 336 298 Z" fill="${fill}"/>`
      : card.shape === "leaf"
        ? `<path d="M24 298 V180 Q24 24 180 24 H336 V142 Q336 298 180 298 Z" fill="${fill}"/>`
        : `<circle cx="180" cy="164" r="120" fill="${fill}"/><circle cx="180" cy="164" r="65" fill="${palette.glow}" opacity=".35"/><ellipse cx="180" cy="173" rx="183" ry="44" transform="rotate(-24 180 173)" fill="none" stroke="#fff8ec" stroke-width="18"/><circle cx="273" cy="75" r="23" fill="${palette.dark}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="${height}" viewBox="0 0 360 ${height}" role="img" aria-labelledby="${titleId}" style="font-family:Arial,sans-serif">
    <title id="${titleId}">${escapeXml(card.name)}'s Max workspace card</title>
    <desc>Membership artwork with a QR code that opens Max. No private workspace information is published.</desc>
    <defs>
      <linearGradient class="card-foil-gradient" id="${safePrefix}-foil" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#69ccd4"/><stop offset=".3" stop-color="#bd80d5"/><stop offset=".5" stop-color="#fff8c4"/><stop offset=".7" stop-color="#82d8b9"/><stop offset="1" stop-color="#aca1ec"/></linearGradient>
      <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.first}"/><stop offset=".52" stop-color="${palette.dark}"/><stop offset="1" stop-color="${palette.second}"/></linearGradient>
      <radialGradient id="${glowId}"><stop stop-color="${palette.glow}" stop-opacity=".6"/><stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/></radialGradient>
      <pattern id="${dotsId}" width="9" height="9" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r=".8" fill="#fff8ec" opacity=".5"/></pattern>
      <clipPath id="${clipId}"><rect x="24" y="24" width="312" height="274" rx="3"/></clipPath>
    </defs>
    <rect width="360" height="${height}" rx="10" fill="#fffdf0" stroke="${palette.ink}" stroke-opacity=".18" stroke-width="1"/>
    <g clip-path="url(#${clipId})">
      <rect x="24" y="24" width="312" height="274" rx="3" fill="${palette.glow}" opacity=".24"/>
      ${shape}
      ${card.pattern !== "plain" ? `<ellipse cx="100" cy="112" rx="150" ry="138" fill="url(#${glowId})"/>` : ""}
      ${card.pattern === "dots" ? `<rect x="24" y="24" width="312" height="280" fill="url(#${dotsId})"/>` : ""}
    </g>
    ${textLines(names, nameY, nameSize, palette.ink, 700, nameSize + 4)}
    ${textLines(subtitles, subtitleY, 16, palette.ink, 500, 21)}
    ${textLines(bios, bioY, 12, "#70645c", 400, 18)}
    <rect x="24" y="${footerY - 12}" width="219" height="25" rx="2" fill="none" stroke="${palette.ink}" stroke-width="1.4"/>
    <path d="M 71 ${footerY - 12} v 25" stroke="${palette.ink}" stroke-width="1"/>
    <text x="35" y="${footerY + 5}" fill="${palette.ink}" font-size="11" font-weight="700">MAX</text>
    <text x="81" y="${footerY + 4}" fill="${palette.ink}" font-size="9" letter-spacing=".6">YOUR WORKSPACE CARD</text>
    <g class="card-qr" transform="translate(272 ${footerY - 32})">
      <rect width="64" height="64" rx="3" fill="#fffdf0"/>
      <svg width="64" height="64" viewBox="0 0 ${modules + 8} ${modules + 8}"><path d="${qrPath}" fill="#24282a" shape-rendering="crispEdges"/></svg>
      <rect class="card-qr-foil" width="64" height="64" rx="3" fill="url(#${safePrefix}-foil)" opacity=".16" pointer-events="none"/>
    </g>
  </svg>`;
  return { svg, width: 360, height };
}
