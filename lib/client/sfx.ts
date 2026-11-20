"use client";

/**
 * Little sounds, made in the browser (no audio files to download): a soft paper crumple when you
 * move something to the trash, like emptying the Trash on a Mac. Off with Settings → Preferences →
 * Sounds, and silent while the tab is hidden.
 */
let ctx: AudioContext | null = null;
let enabled = true;

export function setSoundsEnabled(on: boolean) {
  enabled = on;
}

function audio(): AudioContext | null {
  if (!enabled || typeof window === "undefined" || document.hidden) return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
  return ctx;
}

/** A short crumple-and-whoosh: filtered noise falling in pitch, with a soft low thud at the end. */
export function playTrash() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const length = Math.floor(a.sampleRate * 0.42);
  const buffer = a.createBuffer(1, length, a.sampleRate);
  const data = buffer.getChannelData(0);
  // Crackly noise: random bursts, like paper.
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (Math.random() < 0.3 ? 1 : 0.25) * (1 - i / length);
  const noise = a.createBufferSource();
  noise.buffer = buffer;
  const band = a.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(3200, t);
  band.frequency.exponentialRampToValueAtTime(420, t + 0.38);
  const gain = a.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
  noise.connect(band).connect(gain).connect(a.destination);
  noise.start(t);
  noise.stop(t + 0.43);
  // The thud as it lands in the bin.
  const thud = a.createOscillator();
  thud.type = "sine";
  thud.frequency.setValueAtTime(150, t + 0.3);
  thud.frequency.exponentialRampToValueAtTime(60, t + 0.45);
  const tg = a.createGain();
  tg.gain.setValueAtTime(0.0001, t + 0.3);
  tg.gain.exponentialRampToValueAtTime(0.12, t + 0.32);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
  thud.connect(tg).connect(a.destination);
  thud.start(t + 0.3);
  thud.stop(t + 0.5);
}

/**
 * The page's row in the sidebar goes "poof" (like dragging something off the macOS Dock): it
 * shrinks and blurs away while a little puff of smoke appears where it was. Resolves when done.
 */
export function poof(pageId: string): Promise<void> {
  const rows = [...document.querySelectorAll<HTMLElement>(`[data-page-id="${CSS.escape(pageId)}"]`)];
  if (!rows.length || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    const puff = document.createElement("span");
    puff.className = "max-poof";
    puff.setAttribute("aria-hidden", "true");
    puff.style.left = `${box.left + Math.min(box.width, 140) / 2}px`;
    puff.style.top = `${box.top + box.height / 2}px`;
    for (let i = 0; i < 7; i++) {
      const cloud = document.createElement("i");
      const angle = (i / 7) * Math.PI * 2;
      cloud.style.setProperty("--dx", `${Math.cos(angle) * 22}px`);
      cloud.style.setProperty("--dy", `${Math.sin(angle) * 14 - 6}px`);
      cloud.style.animationDelay = `${i * 12}ms`;
      puff.appendChild(cloud);
    }
    document.body.appendChild(puff);
    window.setTimeout(() => puff.remove(), 700);
    row.classList.add("max-poofing");
  }
  return new Promise((resolve) => window.setTimeout(resolve, 260));
}
