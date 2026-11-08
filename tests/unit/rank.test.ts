import { describe, expect, it } from "vitest";
import { rankBetween } from "@/lib/domain/rank";

describe("rank keys", () => {
  it("orders keys between neighbours", () => {
    const a = rankBetween(null, null);
    const b = rankBetween(a, null);
    const mid = rankBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
    const first = rankBetween(null, a);
    expect(first < a).toBe(true);
  });
  it("survives many inserts at the same spot", () => {
    let lo = rankBetween(null, null);
    const hi = rankBetween(lo, null);
    const keys = [lo, hi];
    for (let i = 0; i < 200; i++) {
      const k = rankBetween(lo, hi);
      expect(k > lo && k < hi).toBe(true);
      keys.push(k);
      lo = k;
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});
