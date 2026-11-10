type Spring = { value: number; velocity: number; target: number };
type Rotation = { kind: "rest" } | { kind: "coast"; target: number; decay: number } | { kind: "settle"; target: number; velocity: number };

export type LogoMotion = { angle: number; x: Spring; y: Spring; press: Spring; rotation: Rotation };
const spring = (): Spring => ({ value: 0, velocity: 0, target: 0 });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
export const angularDelta = (from: number, to: number) => ((((to - from + 540) % 360) + 360) % 360) - 180;

export function createLogoMotion(): LogoMotion {
  return { angle: 0, x: spring(), y: spring(), press: spring(), rotation: { kind: "rest" } };
}

export function resetLogoMotion(motion: LogoMotion) {
  motion.angle = 0;
  motion.rotation = { kind: "rest" };
  for (const axis of [motion.x, motion.y, motion.press]) axis.value = axis.velocity = axis.target = 0;
}

/** Whole-turn targets let a fling slow down without a visible snap to the brand's upright pose. */
export function releaseLogoMotion(motion: LogoMotion, angularVelocity: number, speed: number, reduced: boolean) {
  motion.press.target = 0;
  motion.x.target = motion.y.target = 0;
  if (reduced) return resetLogoMotion(motion);
  if (Math.abs(angularVelocity) < 70 || speed < 70) {
    motion.rotation = { kind: "settle", target: Math.round(motion.angle / 360) * 360, velocity: clamp(angularVelocity, -2000, 2000) };
    return;
  }
  const direction = Math.sign(angularVelocity);
  const turns = clamp(Math.ceil(Math.max(speed / 550, Math.abs(angularVelocity) / 650)), 1, 8);
  let target = Math.round((motion.angle + turns * 360 * direction) / 360) * 360;
  if ((target - motion.angle) * direction <= 0) target += 360 * direction;
  motion.rotation = { kind: "coast", target, decay: clamp(Math.abs(target - motion.angle) / Math.max(Math.abs(angularVelocity), 500), 0.3, 0.7) };
}

function stepSpring(axis: Spring, dt: number, stiffness: number, damping: number) {
  axis.velocity += ((axis.target - axis.value) * stiffness - axis.velocity * damping) * dt;
  axis.value += axis.velocity * dt;
  if (Math.abs(axis.value - axis.target) < 0.001 && Math.abs(axis.velocity) < 0.01) {
    axis.value = axis.target;
    axis.velocity = 0;
  }
}

/** Small fixed substeps keep springs stable on both 60Hz and 120Hz phones. */
export function advanceLogoMotion(motion: LogoMotion, elapsed: number): boolean {
  let remaining = clamp(elapsed, 0, 0.05);
  while (remaining > 0) {
    const dt = Math.min(remaining, 1 / 240);
    remaining -= dt;
    stepSpring(motion.x, dt, 150, 17);
    stepSpring(motion.y, dt, 150, 17);
    stepSpring(motion.press, dt, 500, 38);
    const rotation = motion.rotation;
    if (rotation.kind === "coast") {
      motion.angle = rotation.target + (motion.angle - rotation.target) * Math.exp(-dt / rotation.decay);
      if (Math.abs(rotation.target - motion.angle) < 0.04) {
        motion.angle = 0;
        motion.rotation = { kind: "rest" };
      }
    } else if (rotation.kind === "settle") {
      rotation.velocity += ((rotation.target - motion.angle) * 140 - rotation.velocity * 25) * dt;
      motion.angle += rotation.velocity * dt;
      if (Math.abs(rotation.target - motion.angle) < 0.04 && Math.abs(rotation.velocity) < 0.08) {
        motion.angle = 0;
        motion.rotation = { kind: "rest" };
      }
    }
  }
  return motion.rotation.kind !== "rest" || [motion.x, motion.y, motion.press].some((axis) => axis.value !== axis.target || axis.velocity !== 0);
}
