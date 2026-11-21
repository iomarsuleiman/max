// Generates public/sfx/poof.svg: the five-frame cartoon smoke cloud played when a page is
// moved to the trash, drawn after the macOS Dock "poof" (a frame-stepped sprite, not a tween).
// Run: node scripts/generate-poof-sprite.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 128;
const C = SIZE / 2;

// Deterministic jitter so the sprite is stable between runs.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

/** A ring of puffs around the centre: count, distance, radius range, upward drift. */
function ring(count, dist, rMin, rMax, rise, squash = 0.86, twist = 0) {
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const a = twist + (i / count) * Math.PI * 2 + (rand() - 0.5) * 0.35;
    const d = dist * (0.9 + rand() * 0.2);
    const r = rMin + (i % 2 ? rand() : 0.6 + rand() * 0.4) * (rMax - rMin);
    puffs.push({ x: C + Math.cos(a) * d, y: C + Math.sin(a) * d * squash - rise, r });
  }
  return puffs;
}

const frames = [
  // 1: a tight, dense ball of smoke bursts where the item was.
  { opacity: 1, blur: 0, puffs: [{ x: C, y: C, r: 15 }, ...ring(6, 12, 10, 12.5, 0)] },
  // 2: it billows out into a full, round cartoon cloud.
  { opacity: 1, blur: 0, puffs: [{ x: C, y: C - 2, r: 23 }, ...ring(8, 24, 15, 18.5, 2)] },
  // 3: the cloud is at its biggest and starts to hollow out into a ring of puffs.
  { opacity: 1, blur: 0, puffs: [...ring(6, 20, 9, 12, 4, 0.86, 0.5), ...ring(9, 37, 14, 18.5, 4)] },
  // 4: the ring breaks apart into separate, thinning puffs.
  { opacity: 0.82, blur: 0.4, puffs: ring(9, 46, 9.5, 13, 7, 0.86, 0.15) },
  // 5: a few faint wisps are left, then nothing.
  { opacity: 0.5, blur: 0.9, puffs: ring(9, 53, 4.5, 7.5, 10, 0.86, 0.3) },
];

const fmt = (n) => Math.round(n * 10) / 10;
const circles = (puffs, map) =>
  puffs
    .map(map)
    .map(({ x, y, r }) => `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(r)}"/>`)
    .join("");

// Each frame is one merged cloud: a grey rim, a pale body, then a soft highlight on the
// upper left of every puff (clipped to the cloud), so the puffs read as bulges of one
// cloud rather than separate balls.
const body = frames
  .map(({ opacity, blur, puffs }, f) => {
    const id = `c${f}`;
    const rim = circles(puffs, (p) => p);
    const fill = circles(puffs, (p) => ({ ...p, r: p.r - 1.4 }));
    const shine = circles(puffs, (p) => ({ x: p.x - p.r * 0.2, y: p.y - p.r * 0.26, r: p.r * 0.68 }));
    return (
      `<clipPath id="${id}">${fill}</clipPath>` +
      `<g transform="translate(${f * SIZE} 0)" opacity="${opacity}"${blur ? ` filter="url(#b${f})"` : ""}>` +
      `<g fill="#b3b9c2" filter="url(#s)">${rim}</g>` +
      `<g fill="#d9dde3">${fill}</g>` +
      `<g clip-path="url(#${id})"><g fill="#fff" filter="url(#h)">${shine}</g></g>` +
      `</g>`
    );
  })
  .join("");

const blurs = frames
  .map(({ blur }, f) => (blur ? `<filter id="b${f}" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${blur}"/></filter>` : ""))
  .join("");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE * frames.length}" height="${SIZE}" viewBox="0 0 ${SIZE * frames.length} ${SIZE}">
<defs>
<filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.6" stdDeviation="1.6" flood-color="#1f252d" flood-opacity=".25"/></filter>
<filter id="h" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3.2"/></filter>
${blurs}
</defs>
${body}
</svg>
`;

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "sfx", "poof.svg");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`wrote ${out}`);
