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

/**
 * The Mac's move-to-trash sound is a sheet of paper being crumpled: hundreds of tiny crackles in two
 * quick squeezes, bright and dry, no tone. Made here from short noise grains, each its own little
 * snap, shaped into those two squeezes and filtered like paper (no low hum, a crisp top).
 */
export function playTrash() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const rate = a.sampleRate;
  const seconds = 0.5;
  const length = Math.floor(rate * seconds);
  const buffer = a.createBuffer(2, length, rate);
  // Two squeezes of the hand: the first loud and dense, the second shorter and softer.
  const squeezes = [
    { at: 0.0, len: 0.2, peak: 1, grains: 170 },
    { at: 0.21, len: 0.17, peak: 0.6, grains: 95 },
  ];
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (const sq of squeezes) {
      for (let g = 0; g < sq.grains; g++) {
        // Crackles bunch up early in each squeeze, then thin out.
        const when = sq.at + sq.len * Math.pow(Math.random(), 1.6);
        const start = Math.floor(when * rate);
        const dur = Math.floor(rate * (0.0015 + Math.random() * Math.random() * 0.012));
        const swell = Math.sin(Math.PI * Math.min(1, (when - sq.at) / sq.len)) ** 0.6;
        const amp = sq.peak * swell * (0.15 + Math.pow(Math.random(), 3) * 0.85);
        // Each grain: a snap (sharp attack, quick decay) with its own brightness.
        let last = 0;
        const bright = 0.25 + Math.random() * 0.7;
        for (let i = 0; i < dur && start + i < length; i++) {
          const n = Math.random() * 2 - 1;
          last = last + bright * (n - last);
          data[start + i] += last * amp * Math.exp((-6 * i) / dur);
        }
      }
    }
  }
  const src = a.createBufferSource();
  src.buffer = buffer;
  // Paper: nothing below the rustle, a lift where crinkles live, and soft at the very top.
  const low = a.createBiquadFilter();
  low.type = "highpass";
  low.frequency.value = 700;
  const crinkle = a.createBiquadFilter();
  crinkle.type = "peaking";
  crinkle.frequency.value = 4200;
  crinkle.Q.value = 0.8;
  crinkle.gain.value = 5;
  const air = a.createBiquadFilter();
  air.type = "lowpass";
  air.frequency.value = 11000;
  const gain = a.createGain();
  gain.gain.value = 0.26;
  src.connect(low).connect(crinkle).connect(air).connect(gain).connect(a.destination);
  src.start(t);
  src.stop(t + seconds);
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
    // The Dock's poof: a little cartoon cloud bursts where the item was, billows out and is gone.
    const puff = document.createElement("span");
    puff.className = "max-poof";
    puff.setAttribute("aria-hidden", "true");
    puff.style.left = `${box.left + Math.min(box.width, 160) / 2}px`;
    puff.style.top = `${box.top + box.height / 2}px`;
    const count = 11;
    for (let i = 0; i < count; i++) {
      const cloud = document.createElement("i");
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const reach = 10 + Math.random() * 16;
      const size = 12 + Math.random() * 14;
      cloud.style.width = cloud.style.height = `${size}px`;
      cloud.style.marginLeft = cloud.style.marginTop = `${-size / 2}px`;
      cloud.style.setProperty("--dx", `${Math.cos(angle) * reach}px`);
      cloud.style.setProperty("--dy", `${Math.sin(angle) * reach * 0.7 - 8}px`);
      cloud.style.setProperty("--spin", `${Math.round(Math.random() * 120 - 60)}deg`);
      cloud.style.animationDelay = `${Math.random() * 40}ms`;
      puff.appendChild(cloud);
    }
    // A brighter core that pops first, like the first frame of the Mac's cloud.
    const core = document.createElement("b");
    puff.appendChild(core);
    document.body.appendChild(puff);
    window.setTimeout(() => puff.remove(), 720);
    row.classList.add("max-poofing");
  }
  return new Promise((resolve) => window.setTimeout(resolve, 170));
}
