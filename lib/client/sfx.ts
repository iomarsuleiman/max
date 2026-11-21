"use client";

let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundsEnabled(on: boolean) {
  enabled = on;
  if (on) preloadSounds();
  preloadPoof();
}

function audio(): AudioContext | null {
  if (!enabled || typeof window === "undefined" || document.hidden) return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

// A warm recorded air whoosh (public/sfx/poof.wav, CC0, see public/sfx/CREDITS.md).
const TRASH_SOUND = "/sfx/poof.wav";
let trashBytes: Promise<ArrayBuffer | null> | null = null;
let trashBuffer: Promise<AudioBuffer | null> | null = null;

/** Fetch the sound files ahead of time so the first delete plays without a gap. */
export function preloadSounds() {
  if (typeof window === "undefined") return;
  trashBytes ??= fetch(TRASH_SOUND)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .catch(() => null);
}

function trashSound(a: AudioContext): Promise<AudioBuffer | null> {
  preloadSounds();
  trashBuffer ??= trashBytes!.then((bytes) => (bytes ? a.decodeAudioData(bytes.slice(0)) : null)).catch(() => null);
  return trashBuffer;
}

/** The poof of a page going to the trash. */
export function playTrash() {
  const a = audio();
  if (!a) return;
  void trashSound(a).then((buffer) => {
    if (!buffer) return;
    const source = a.createBufferSource();
    source.buffer = buffer;
    const volume = a.createGain();
    volume.gain.value = 0.75;
    source.connect(volume).connect(a.destination);
    source.start();
  });
}

const POOF_FRAMES = 5;
const POOF_FRAME_MS = 80;
const POOF_SPRITE = "/sfx/poof.svg";
let poofSprite: HTMLImageElement | null = null;

/** Decode the cloud sprite up front so the first poof doesn't flash empty frames. */
function preloadPoof() {
  if (typeof window === "undefined" || poofSprite) return;
  poofSprite = new Image();
  poofSprite.src = POOF_SPRITE;
}

/**
 * The page's row in the sidebar goes "poof", cloned from dragging an item off the macOS Dock:
 * the row vanishes at once and a cartoon smoke cloud plays where it was, as five hand-drawn
 * frames stepped through without tweening (public/sfx/poof.svg, made by
 * scripts/generate-poof-sprite.mjs). The caller clears the row animation after the mutation.
 */
export function poof(pageId: string): Promise<() => void> {
  const rows = [...document.querySelectorAll<HTMLElement>(`[data-page-id="${CSS.escape(pageId)}"]`)];
  const restore = () => rows.forEach((row) => row.classList.remove("max-poofing"));
  if (!rows.length || matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "on") return Promise.resolve(restore);
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    if (!box.width && !box.height) continue;
    const puff = document.createElement("span");
    puff.className = "max-poof";
    puff.setAttribute("aria-hidden", "true");
    puff.style.left = `${box.left + Math.min(box.width, 160) / 2}px`;
    puff.style.top = `${box.top + box.height / 2}px`;
    puff.style.setProperty("--poof-frames", String(POOF_FRAMES));
    puff.style.animationDuration = `${POOF_FRAMES * POOF_FRAME_MS}ms`;
    document.body.appendChild(puff);
    window.setTimeout(() => puff.remove(), POOF_FRAMES * POOF_FRAME_MS + 50);
    row.classList.add("max-poofing");
  }
  return new Promise((resolve) => window.setTimeout(() => resolve(restore), 60));
}
