/** PR25: optional presence only for the disposable PR17/18 collaboration lab.
 * Presence is neither Yjs document state nor an authorization capability.
 * Every watch/write is scoped to the server-issued authenticated session.
 */
const BLOCK_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const HEARTBEAT_MS = 8_000;
const CLOCK_MS = 1_000;
const MAX_PEERS = 64;

function safeBlock(blockId) {
  return typeof blockId === "string" && BLOCK_ID.test(blockId) ? blockId : null;
}
function safeRows(rows, self, now) {
  if (!Array.isArray(rows) || rows.length > MAX_PEERS) throw Error("INVALID_PRESENCE_RESPONSE");
  const seen = new Set();
  return rows.filter(row => {
    if (!row || typeof row.accountId !== "string" || !row.accountId ||
        row.accountId === self || seen.has(row.accountId) ||
        !["editing", "viewing"].includes(row.state) ||
        !Number.isFinite(row.expiresAt) || row.expiresAt <= now) return false;
    if (row.blockId !== null && safeBlock(row.blockId) === null) return false;
    if (row.blockId !== null && (![row.anchor,row.head].every(n =>
        Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000))) return false;
    seen.add(row.accountId);
    return true;
  }).map(row => ({
    accountId: row.accountId, state: row.state,
    blockId: row.blockId, expiresAt: row.expiresAt,
  })).sort((a,b) => a.accountId.localeCompare(b.accountId));
}

export class LabPresenceClient {
  constructor({provider, onChange = () => {}, onError = () => {},
    now = () => Date.now(), intervals = {set: setInterval, clear: clearInterval}}) {
    if (!provider?.transport || typeof provider.on !== "function" ||
        typeof provider.off !== "function") throw Error("Authorized sandbox provider required");
    this.provider = provider;
    this.transport = provider.transport;
    this.onChange = onChange;
    this.onError = onError;
    this.now = now;
    this.intervals = intervals;
    this.visible = true;
    this.focusBlock = null;
    this.peers = [];
    this.sessionId = null;
    this.generation = 0;
    this.unsubscribe = null;
    this.clock = null;
    this.heartbeat = null;
    this.started = false;
    this.queue = Promise.resolve();
    this._onProvider = () => this.reconcile();
  }
  _notify() { this.onChange(this.peers.slice()); }
  _clear() {
    this.generation++;
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.clock !== null) this.intervals.clear(this.clock);
    if (this.heartbeat !== null) this.intervals.clear(this.heartbeat);
    this.clock = this.heartbeat = null;
    this.sessionId = null;
    this.focusBlock = null; // never carry stale focus across leases/offline/account changes
    this.peers = [];
    this._notify();
  }
  _live() {
    const p = this.provider;
    return p.state === "online" && !!p.session?.sessionId &&
      p.accountId === p.session.accountId && p.session.expiresAt > this.now();
  }
  start() {
    if (this.started) return;
    this.started = true;
    this.provider.on("status", this._onProvider);
    this.reconcile();
  }
  reconcile() {
    if (!this.started) return;
    if (!this._live()) { if (this.sessionId) this._clear(); return; }
    const next = this.provider.session.sessionId;
    if (next === this.sessionId) {
      // A server permission downgrade is reflected immediately on the next
      // provider status event; never reuse a previously editing focus.
      this._publish();
      return;
    }
    this._clear();
    this.sessionId = next;
    const generation = this.generation;
    if (typeof this.transport.watchPresence !== "function" ||
        typeof this.transport.publishPresence !== "function")
      throw Error("PR25 presence transport not configured");
    this.unsubscribe = this.transport.watchPresence({sessionId: next}, rows => {
      if (generation !== this.generation || !this._live()) return;
      try { this.peers = safeRows(rows,this.provider.accountId,this.now()); this._notify(); }
      catch(e) { this._fail(e,generation); }
    }, err => this._fail(err,generation));
    this.clock = this.intervals.set(() => this.tick(),CLOCK_MS);
    this.heartbeat = this.intervals.set(() => this._publish(),HEARTBEAT_MS);
    this._publish();
  }
  _fail(error,generation) {
    if (generation !== this.generation) return;
    this._clear(); // never leave stale identities visible after watch/auth errors
    this.onError(error instanceof Error ? error : Error(String(error)));
  }
  _publish() {
    if (!this.started || !this.sessionId || !this._live()) return;
    const generation = this.generation;
    const sessionId = this.sessionId;
    const selection = this.provider.canEdit && this.focusBlock
      ? {blockId:this.focusBlock,anchor:0,head:0} : null;
    const args = {sessionId,visible:this.visible,
      state:selection ? "editing" : "viewing", selection:this.visible ? selection : null};
    // Serialize to ensure invisible mode cannot be overwritten by a slower
    // previous editing heartbeat. Do not replay queued writes after disconnect.
    this.queue = this.queue.catch(() => {}).then(async () => {
      if (generation !== this.generation || !this._live()) return;
      await this.transport.publishPresence(args);
    }).catch(e => this._fail(e,generation));
  }
  setVisible(visible) {
    if (typeof visible !== "boolean") throw Error("Visibility must be boolean");
    if (this.visible === visible) return;
    this.visible = visible;
    this._publish();
  }
  setFocusBlock(blockId) {
    const next = safeBlock(blockId);
    if (this.focusBlock === next) return;
    this.focusBlock = next;
    this._publish();
  }
  tick() {
    if (!this.started) return;
    if (!this._live()) { if (this.sessionId) this._clear(); return; }
    const fresh = this.peers.filter(row => row.expiresAt > this.now());
    if (fresh.length !== this.peers.length) {
      this.peers = fresh;
      this._notify();
    }
  }
  async whenIdle() { await this.queue; }
  stop() {
    if (!this.started) return;
    const sessionId = this.sessionId;
    const mayStop = this._live();
    this.started = false;
    this.provider.off("status",this._onProvider);
    this._clear();
    if (sessionId && mayStop && typeof this.transport.stopPresence === "function") {
      this.queue = this.queue.catch(() => {}).then(() =>
        this.transport.stopPresence({sessionId})).catch(() => {});
    }
  }
}
