/**
 * Fractional rank keys. Keys sort lexicographically (ASCII), so inserting between
 * two siblings never requires rewriting the others.
 */
const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`rank: ${a} >= ${b}`);
  if (a.endsWith("0") || (b && b.endsWith("0"))) throw new Error("rank: trailing zero");
  if (b !== null) {
    let n = 0;
    while ((a[n] ?? "0") === b[n]) n++;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }
  const digitA = a ? DIGITS.indexOf(a[0]) : 0;
  const digitB = b !== null ? DIGITS.indexOf(b[0]) : DIGITS.length;
  if (digitB - digitA > 1) {
    return DIGITS[Math.round(0.5 * (digitA + digitB))];
  }
  if (b && b.length > 1) return b.slice(0, 1);
  return DIGITS[digitA] + midpoint(a.slice(1), null);
}

/** Returns a key strictly between `before` and `after` (either may be null for open ends). */
export function rankBetween(before: string | null, after: string | null): string {
  return midpoint(before ?? "", after);
}

export function compareRank(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Produces `count` evenly spread keys after `start` (used for bulk inserts). */
export function ranksAfter(start: string | null, count: number): string[] {
  const out: string[] = [];
  let prev = start;
  for (let i = 0; i < count; i++) {
    prev = rankBetween(prev, null);
    out.push(prev);
  }
  return out;
}
