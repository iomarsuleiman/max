/** PR30: defense-in-depth deadline fence for the experimental read surfaces.
 * The server's current Clerk identity, room grants and lease checks remain
 * authoritative; this only clears browser-held read data on time.
 */
const MAX_TIMER_DELAY = 2_147_483_647;
export class LocalReadLeaseDeadline {
  constructor({ now = () => Date.now(), schedule = (fn, ms) => setTimeout(fn, ms),
    cancel = handle => clearTimeout(handle), onExpire }) {
    if (typeof now !== "function" || typeof schedule !== "function" ||
        typeof cancel !== "function" || typeof onExpire !== "function")
      throw Error("INVALID_LEASE_DEADLINE_OPTIONS");
    this.now = now;
    this.schedule = schedule;
    this.cancel = cancel;
    this.onExpire = onExpire;
    this.handle = null;
    this.generation = 0;
  }
  clear() {
    ++this.generation;
    if (this.handle !== null) this.cancel(this.handle);
    this.handle = null;
  }
  arm(expiresAt) {
    this.clear();
    if (!Number.isSafeInteger(expiresAt) || expiresAt < 0)
      throw Error("INVALID_READ_LEASE_DEADLINE");
    const generation = this.generation;
    const check = () => {
      if (generation !== this.generation) return; // cancelled callback
      this.handle = null;
      const remaining = expiresAt - this.now();
      if (!Number.isFinite(remaining) || remaining <= 0) {
        this.clear();
        this.onExpire();
        return;
      }
      // Browser timers clamp enormous delays; recheck rather than expiring early.
      this.handle = this.schedule(check, Math.max(1, Math.min(remaining, MAX_TIMER_DELAY)));
    };
    check();
  }
}
