/** Applies a custom space theme (also used live by the Space editor while you drag). */
export function applySpace(space: { colors: string[]; grain: number; intensity: number }) {
  const root = document.documentElement.style;
  const [a, b = a, c] = space.colors;
  root.setProperty("--tint-1", a);
  root.setProperty("--tint-2", b);
  if (c) root.setProperty("--tint-3", c);
  else root.removeProperty("--tint-3");
  root.setProperty("--tint-strength", `${Math.round(2 + space.intensity * 0.3)}%`);
  root.setProperty("--grain-strength", String(space.grain / 50));
}

export function clearSpace() {
  const root = document.documentElement.style;
  for (const p of ["--tint-3", "--tint-strength", "--grain-strength"]) root.removeProperty(p);
}
