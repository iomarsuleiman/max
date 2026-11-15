/** PR28: opt-in sandbox inbox. Never queues, replays or persists inbox data.
 * All subscriptions and acknowledgments are session-fenced and server-authorized.
 */
const kinds = new Set(["mention", "thread_reply", "suggestion_decision"]);
export function normalizeInbox(value) {
  if (!value || !Array.isArray(value.notifications) || value.notifications.length > 64 ||
      !Number.isSafeInteger(value.unreadCount) || value.unreadCount < 0)
    throw Error("INVALID_INBOX");
  const seen = new Set();
  const notifications = value.notifications.map(row => {
    if (!row || typeof row.notificationId !== "string" || !row.notificationId ||
        seen.has(row.notificationId) || !kinds.has(row.kind) ||
        typeof row.targetId !== "string" || !row.targetId ||
        !(row.actorId === null || (typeof row.actorId === "string" && row.actorId.length > 0)) ||
        !Number.isSafeInteger(row.createdAt) ||
        !(row.readAt === null || Number.isSafeInteger(row.readAt)))
      throw Error("INVALID_INBOX_ITEM");
    seen.add(row.notificationId);
    return { notificationId: row.notificationId, kind: row.kind, actorId: row.actorId,
      targetId: row.targetId, createdAt: row.createdAt, readAt: row.readAt };
  });
  if (notifications.filter(row => row.readAt === null).length !== value.unreadCount)
    throw Error("INVALID_UNREAD_COUNT");
  return { unreadCount: value.unreadCount, notifications };
}

export class LabInboxClient {
  constructor({ provider, onChange = () => {}, onError = () => {}, now = () => Date.now() }) {
    if (!provider?.transport || typeof provider.on !== "function" || typeof provider.off !== "function")
      throw Error("SANDBOX_PROVIDER_REQUIRED");
    this.provider = provider;
    this.transport = provider.transport;
    this.onChange = onChange;
    this.onError = onError;
    this.now = now;
    this.started = false;
    this.generation = 0;
    this.sessionId = null;
    this.offInbox = null;
    this.inbox = { unreadCount: 0, notifications: [] };
    this._status = () => this.reconcile();
  }
  _live() {
    const p = this.provider;
    return p.state === "online" && !!p.session?.sessionId &&
      p.accountId === p.session.accountId &&
      Number.isFinite(p.session.expiresAt) && p.session.expiresAt > this.now();
  }
  _snapshot() {
    this.onChange({ connected: this._live() && !!this.sessionId,
      unreadCount: this.inbox.unreadCount,
      notifications: this.inbox.notifications.slice() });
  }
  _clear() {
    this.generation++;
    this.offInbox?.();
    this.offInbox = null;
    this.sessionId = null;
    this.inbox = { unreadCount: 0, notifications: [] };
    this._snapshot();
  }
  _fail(error, gen) {
    if (gen !== this.generation) return;
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
    if (!this._live()) { if (this.sessionId) this._clear(); return; }
    const sessionId = this.provider.session.sessionId;
    if (this.sessionId === sessionId) return;
    this._clear();
    this.sessionId = sessionId;
    const gen = this.generation;
    if (typeof this.transport.watchInbox !== "function" ||
        typeof this.transport.markInboxRead !== "function") {
      this._fail(Error("INBOX_TRANSPORT_UNAVAILABLE"), gen);
      return;
    }
    const valid = () => this.started && gen === this.generation &&
      this._live() && this.sessionId === sessionId;
    try {
      this.offInbox = this.transport.watchInbox({ sessionId }, payload => {
        if (!valid()) return;
        try { this.inbox = normalizeInbox(payload); this._snapshot(); }
        catch (err) { this._fail(err, gen); }
      }, err => this._fail(err, gen));
    } catch (err) { this._fail(err, gen); }
    this._snapshot();
  }
  async markRead(notificationId) {
    if (!this.started || !this._live() || !this.sessionId ||
        !this.inbox.notifications.some(row => row.notificationId === notificationId))
      throw Error("INBOX_SESSION_OR_EVENT_UNAVAILABLE");
    const gen = this.generation, sessionId = this.sessionId;
    const result = await this.transport.markInboxRead({ sessionId, notificationId });
    if (gen !== this.generation || sessionId !== this.sessionId || !this._live())
      throw Error("INBOX_SESSION_CHANGED_AFTER_WRITE");
    if (!result || !Number.isSafeInteger(result.readAt) ||
        typeof result.duplicate !== "boolean")
      throw Error("INVALID_INBOX_ACK");
    return result;
  }
  stop() {
    if (!this.started) return;
    this.started = false;
    this.provider.off("status", this._status);
    this._clear();
  }
}
