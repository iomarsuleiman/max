"use client";

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

/** A short air pop with a soft low end, synthesized from a filtered burst and a falling tone. */
export function playTrash() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  const end = t + 0.26;
  const buffer = a.createBuffer(1, Math.ceil(a.sampleRate * 0.26), a.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

  const air = a.createBufferSource();
  air.buffer = buffer;
  const color = a.createBiquadFilter();
  color.type = "lowpass";
  color.frequency.setValueAtTime(2200, t);
  color.frequency.exponentialRampToValueAtTime(400, end);
  const breath = a.createGain();
  breath.gain.setValueAtTime(0.001, t);
  breath.gain.exponentialRampToValueAtTime(0.42, t + 0.016);
  breath.gain.exponentialRampToValueAtTime(0.001, end);
  air.connect(color).connect(breath).connect(a.destination);

  const pop = a.createOscillator();
  pop.frequency.setValueAtTime(158, t);
  pop.frequency.exponentialRampToValueAtTime(62, t + 0.1);
  const body = a.createGain();
  body.gain.setValueAtTime(0.001, t);
  body.gain.exponentialRampToValueAtTime(0.12, t + 0.009);
  body.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  pop.connect(body).connect(a.destination);
  pop.start(t);
  pop.stop(t + 0.11);
  air.start(t);
}

/**
 * The page's row in the sidebar goes "poof" (like dragging something off the macOS Dock): it
 * shrinks away under a puff of smoke. The caller clears the row animation after the mutation.
 */
export function poof(pageId: string): Promise<() => void> {
  const rows = [...document.querySelectorAll<HTMLElement>(`[data-page-id="${CSS.escape(pageId)}"]`)];
  const restore = () => rows.forEach((row) => row.classList.remove("max-poofing"));
  if (!rows.length || matchMedia("(prefers-reduced-motion: reduce)").matches || document.documentElement.dataset.reduceMotion === "on") return Promise.resolve(restore);
  for (const row of rows) {
    const box = row.getBoundingClientRect();
    // The Dock's poof: a little cartoon cloud bursts where the item was, billows out and is gone.
    const puff = document.createElement("span");
    puff.className = "max-poof";
    puff.setAttribute("aria-hidden", "true");
    puff.style.left = `${box.left + Math.min(box.width, 160) / 2}px`;
    puff.style.top = `${box.top + box.height / 2}px`;
    const count = 7;
    for (let i = 0; i < count; i++) {
      const cloud = document.createElement("i");
      const angle = (i / count) * Math.PI * 2;
      const reach = 17 + (i % 3) * 4;
      const size = 21 + (i % 3) * 4;
      cloud.style.width = cloud.style.height = `${size}px`;
      cloud.style.marginLeft = cloud.style.marginTop = `${-size / 2}px`;
      cloud.style.setProperty("--dx", `${Math.cos(angle) * reach}px`);
      cloud.style.setProperty("--dy", `${Math.sin(angle) * reach * 0.7 - 8}px`);
      cloud.style.animationDelay = `${(i % 3) * 13}ms`;
      puff.appendChild(cloud);
    }
    // A brighter core that pops first, like the first frame of the Mac's cloud.
    const core = document.createElement("b");
    puff.appendChild(core);
    document.body.appendChild(puff);
    window.setTimeout(() => puff.remove(), 490);
    row.classList.add("max-poofing");
  }
  return new Promise((resolve) => window.setTimeout(() => resolve(restore), 115));
}
