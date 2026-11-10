import { describe, expect, it } from "vitest";
import { advanceLogoMotion, angularDelta, createLogoMotion, releaseLogoMotion } from "@/lib/client/logoMotion";

describe("logo gesture physics", () => {
  it("unwraps circular pointer motion in either direction without jumping across north", () => {
    expect(angularDelta(179, -179)).toBe(2);
    expect(angularDelta(-179, 179)).toBe(-2);
  });

  for (const direction of [-1, 1]) {
    it(`coasts through multiple turns in direction ${direction} then rests upright`, () => {
      const motion = createLogoMotion();
      motion.angle = direction * 130;
      releaseLogoMotion(motion, direction * 1700, 1400, false);
      for (let i = 0; i < 90; i++) advanceLogoMotion(motion, 1 / 60);
      expect(motion.angle * direction).toBeGreaterThan(720);
      for (let i = 0; i < 450; i++) advanceLogoMotion(motion, 1 / 60);
      expect(motion.angle).toBe(0);
      expect(motion.rotation.kind).toBe("rest");
      expect(advanceLogoMotion(motion, 1 / 60)).toBe(false);
    });
  }

  it("returns a center pull and held scale home without introducing spin", () => {
    const motion = createLogoMotion();
    motion.x.value = motion.x.target = 90;
    motion.y.value = motion.y.target = -40;
    motion.x.velocity = 700;
    motion.press.value = 1;
    releaseLogoMotion(motion, 0, 1000, false);
    for (let i = 0; i < 400; i++) advanceLogoMotion(motion, 1 / 120);
    expect(motion.x.value).toBe(0);
    expect(motion.y.value).toBe(0);
    expect(motion.press.value).toBe(0);
    expect(motion.angle).toBe(0);
    expect(advanceLogoMotion(motion, 1 / 120)).toBe(false);
  });

  it("settles a slow turn and disables inertia with reduced motion", () => {
    const motion = createLogoMotion();
    motion.angle = -85;
    releaseLogoMotion(motion, -15, 20, false);
    expect(motion.rotation.kind).toBe("settle");
    for (let i = 0; i < 240; i++) advanceLogoMotion(motion, 1 / 120);
    expect(motion.angle).toBe(0);
    motion.angle = 90;
    releaseLogoMotion(motion, 2000, 1200, true);
    expect(motion.angle).toBe(0);
    expect(advanceLogoMotion(motion, 1 / 60)).toBe(false);
  });
});
