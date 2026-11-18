import { LocalReadLeaseDeadline } from "./read-lease-deadline.mjs";
/** PR29: read-only room activity, never stored in browser or sent to production. */
const kinds = new Set(["thread_opened", "thread_replied", "thread_resolved",
  "thread_reopened", "suggestion_proposed", "suggestion_accepted", "suggestion_rejected"]);
export function normalizeRoomActivity(value) {
  if (!Array.isArray(value) || value.length > 40) throw Error("INVALID_ROOM_ACTIVITY");
  const seen = new Set();
  return value.map(row => {
    if (!row || typeof row.activityId !== "string" || !row.activityId ||
        seen.has(row.activityId) || !kinds.has(row.kind) ||
        !(row.actorId === null || (typeof row.actorId === "string" && !!row.actorId)) ||
        typeof row.targetId !== "string" || !row.targetId ||
        !Number.isSafeInteger(row.createdAt))
      throw Error("INVALID_ROOM_ACTIVITY_ITEM");
    seen.add(row.activityId);
    return { activityId: row.activityId, kind: row.kind, actorId: row.actorId,
      targetId: row.targetId, createdAt: row.createdAt };
  });
}
export class LabRoomActivityClient {
  constructor({provider, onChange = () => {}, onError = () => {}, now = () => Date.now(), scheduleExpiry = (fn, ms) => setTimeout(fn, ms), cancelExpiry = id => clearTimeout(id) }) {
    if (!provider?.transport || typeof provider.on !== "function" ||
        typeof provider.off !== "function") throw Error("SANDBOX_PROVIDER_REQUIRED");
    this.provider = provider;
    this.transport = provider.transport;
    this.onChange = onChange;
    this.onError = onError;
    this.now = now;
    this.started = false;
    this.generation = 0;
    this.sessionId = null;
    this.offActivity = null;
    this.items = [];
    this._status = () => this.reconcile();
    this._deadline = new LocalReadLeaseDeadline({
      now, schedule: scheduleExpiry, cancel: cancelExpiry,
      onExpire: () => this._fail(Error("READ_LEASE_EXPIRED"), this.generation),
    });
  }
  _live() {
    const p = this.provider;
    return p.state === "online" && !!p.session?.sessionId &&
      p.accountId === p.session.accountId &&
      Number.isFinite(p.session.expiresAt) && p.session.expiresAt > this.now();
  }
  _snapshot() {
    this.onChange({connected: this._live() && !!this.sessionId,
      activities: this.items.slice()});
  }
  _clear() {
    this._deadline.clear();
    this.generation++;
    this.offActivity?.();
    this.offActivity = null;
    this.sessionId = null;
    this.items = [];
    this._snapshot();
  }
  _fail(error, generation) {
    if (generation !== this.generation) return;
    this._clear();
    this.onError(error instanceof Error ? error : Error(String(error)));
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.provider.on("status", this._status);
    this.reconcile();
  }
  reconcile() {
    if (!this.started) return;
    if (!this._live()) {
      if (this.sessionId) this._clear();
      return;
    }
    const sessionId = this.provider.session.sessionId;
    if (sessionId === this.sessionId) return;
    this._clear();
    this.sessionId = sessionId;
    const generation = this.generation;
    try { this._deadline.arm(this.provider.session.expiresAt); }
    catch (error) { this._fail(error, this.generation); return; }
    if (!this.started || !this.sessionId) return;
    if (typeof this.transport.watchRoomActivity !== "function") {
      this._fail(Error("ACTIVITY_TRANSPORT_UNAVAILABLE"), generation);
      return;
    }
    const valid = () => this.started && generation === this.generation &&
      this._live() && this.sessionId === sessionId;
    try {
      this.offActivity = this.transport.watchRoomActivity({sessionId}, value => {
        if (!valid()) return;
        try { this.items = normalizeRoomActivity(value); this._snapshot(); }
        catch (error) { this._fail(error, generation); }
      }, error => this._fail(error, generation));
    } catch (error) { this._fail(error, generation); }
    this._snapshot();
  }
  stop() {
    if (!this.started) return;
    this.started = false;
    this.provider.off("status", this._status);
    this._clear();
  }
}
