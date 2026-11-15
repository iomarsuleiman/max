/**
 * Max PR18: Yjs <-> server-authorized Convex update-log adapter.
 * This intentionally has NO browser storage, automatic offline replay, token
 * persistence, production import, or permission decisions on the client.
 */
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";

const REMOTE = Symbol("max-pr18-remote");
export const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
export const fromBase64 = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
const operationId = () => crypto.randomUUID().replaceAll("-", "");

export class AuthorizedYjsProvider {
  constructor({ doc, transport, workspaceId, pageId, onState = () => {}, journal = null, accountIdHint = null }) {
    if (!doc || !transport || !workspaceId || !pageId) throw Error("Explicit sandbox scope and transport required");
    this.doc = doc;
    this.transport = transport;
    this.scope = { workspaceId, pageId };
    if (journal && !accountIdHint) throw Error("Authenticated account ID required for durable journal");
    this.journal = journal;
    this.journalScope = journal ? { accountId: accountIdHint, workspaceId, pageId } : null;
    this.journalReady = !journal;
    this._restoring = null;
    this.persistBarrier = Promise.resolve();
    this.awareness = new Awareness(doc);
    this.onState = onState;
    this.state = "idle";
    this.lastError = null;
    this.pending = [];
    this.cursor = 0;
    this.accountId = accountIdHint;
    this.canEdit = false;
    this.lastAuthorizedCanEdit = false;
    this.session = null;
    this.unsubscribe = null;
    this.unsubscribeStatus = null;
    this.expiryTimer = null;
    this.poll = null;
    this.connectedOnce = false;
    this.listeners = new Map();
    this._connecting = null;
    this._pulling = null;
    this._flushing = null;
    this._onLocal = (update, origin) => {
      if (origin === REMOTE || this.state === "destroyed") return;
      if (update.byteLength > 16_384 || this.pending.length >= 16 ||
          this.pending.reduce((sum, x) => sum + x.size, 0) + update.byteLength > 131_072) {
        this._block(new Error("LOCAL_BUFFER_FULL: retain/export current Y.Doc; no edit silently discarded"));
        return;
      }
      if (!this.journalReady) {
        this._block(Error("JOURNAL_INITIALIZATION_REQUIRED: export current Y.Doc"));
        return;
      }
      const entry = { operationId: operationId(), base64: toBase64(update), size: update.byteLength };
      this.pending.push(entry);
      // Never transmit bytes before durable storage commits.
      if (this.journal) {
        this.persistBarrier = this.persistBarrier.then(() =>
          this.journal.append(this.journalScope, entry)).catch(error => {
            this._block(error);
            throw error;
          });
        void this.persistBarrier.catch(() => {});
      }
      this._emit();
      if (this.state === "online") void this.flush().catch(() => {});
    };
    doc.on("update", this._onLocal);
  }

  on(event, fn) {
    const subscribers = this.listeners.get(event) ?? new Set();
    subscribers.add(fn);
    this.listeners.set(event, subscribers);
  }
  off(event, fn) { this.listeners.get(event)?.delete(fn); }
  _emit() {
    this.onState({ state: this.state, pending: this.pending.length, canEdit: this.canEdit, error: this.lastError?.message ?? null });
    for (const fn of this.listeners.get("status") ?? []) fn({ status: this.state === "online" ? "connected" : "disconnected" });
  }
  _stopNetwork() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeStatus?.();
    this.unsubscribeStatus = null;
    if (this.expiryTimer !== null) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (this.poll !== null) clearInterval(this.poll);
    this.poll = null;
  }
  /** Subscribed, server-derived permission changes only REDUCE existing
   * capabilities. A re-upgrade requires an explicit fresh join/lease, never a
   * stale status notification. The server independently gates every append.
   */
  _applySessionStatus(next) {
    if (this.state !== "online" || !this.session) return;
    if (!next || next.accountId !== this.accountId ||
        next.expiresAt !== this.session.expiresAt ||
        typeof next.canEdit !== "boolean") {
      this._block(Error("SESSION_STATUS_MISMATCH"));
      return;
    }
    if (Date.now() >= this.session.expiresAt) {
      this._block(Error("LEASE_EXPIRED"));
      return;
    }
    if (this.canEdit && !next.canEdit) {
      this.canEdit = false;
      this.lastAuthorizedCanEdit = false;
      if (this.pending.length)
        this.lastError = Error("EDIT_ACCESS_DOWNGRADED: export unsent local edits; no automatic replay");
      this._emit();
    }
  }
  _block(error) {
    if (this.state === "destroyed") return;
    this._stopNetwork();
    this.canEdit = false;
    this.lastAuthorizedCanEdit = false;
    this.lastError = error instanceof Error ? error : new Error(String(error));
    this.state = "blocked";
    this._emit();
  }

  /** Call before mounting the editor. Restoration is local, never authorization. */
  async restorePending() {
    if (this.journalReady) return this.pending.length;
    if (this._restoring) return this._restoring;
    this._restoring = (async () => {
      if (this.pending.length) throw Error("JOURNAL_INIT_WITH_LOCAL_EDITS");
      const entries = await this.journal.load(this.journalScope);
      if (this.state === "destroyed") return 0;
      for (const entry of entries) Y.applyUpdate(this.doc, fromBase64(entry.base64), REMOTE);
      this.pending = entries;
      this.journalReady = true;
      if (entries.length) this.state = "offline";
      this._emit();
      return entries.length;
    })().catch(error => { this._block(error); throw error; })
      .finally(() => { this._restoring = null; });
    return this._restoring;
  }

  /** Never silently replay an offline/failed edit. UI requires a review action. */
  async connect({ reviewedPending = false } = {}) {
    if (this.state === "destroyed") throw Error("Provider destroyed");
    if (this.state === "online") return;
    if (this._connecting) return this._connecting;
    await this.restorePending();
    if (this.state === "destroyed") throw Error("Provider destroyed during recovery");
    if (this.pending.length && !reviewedPending) {
      throw Error("OFFLINE_REPLAY_REQUIRES_REVIEW: export or review local changes before reconnect");
    }
    this.state = "connecting";
    this.lastError = null;
    this._emit();
    this._connecting = (async () => {
      const lease = await this.transport.join(this.scope);
      if (this.state === "destroyed") throw Error("Provider destroyed during join");
      if (!lease.sessionId || !lease.accountId || !Number.isFinite(lease.expiresAt) ||
          lease.expiresAt <= Date.now()) throw Error("Invalid authenticated collaboration lease");
      if (this.accountId && this.accountId !== lease.accountId)
        throw Error("ACCOUNT_SWITCH: never replay another account's pending changes");
      this.accountId = lease.accountId;
      this.canEdit = lease.canEdit === true;
      this.lastAuthorizedCanEdit = this.canEdit;
      this.session = lease;
      this.cursor = 0; // rehydrate from server log; Y.applyUpdate is idempotent
      await this.pull();
      if (this.state === "destroyed") throw Error("Provider destroyed during sync");
      if (this.state === "blocked") throw this.lastError;
      this.state = "online";
      this.connectedOnce = true;
      this._emit();
      // The deadline is enforced locally, not dependent on a reactive
      // Date.now() query re-running after the five-minute lease expires.
      this.expiryTimer = setTimeout(() => this._block(Error("LEASE_EXPIRED")),
        Math.max(0, lease.expiresAt - Date.now()));
      if (typeof this.transport.watchStatus === "function") {
        this.unsubscribeStatus = this.transport.watchStatus(
          { sessionId: lease.sessionId },
          result => this._applySessionStatus(result),
          error => this._block(error),
        );
      }
      this.unsubscribe = this.transport.watch({
        sessionId: lease.sessionId, afterSeq: this.cursor,
      }, () => { void this.pull().catch(() => {}); }, (err) => this._block(err));
      this.poll = setInterval(() => {
        if (this.state !== "online") return;
        if (Date.now() >= lease.expiresAt) { this._block(Error("LEASE_EXPIRED")); return; }
        void this.pull().catch(() => {});
      }, 20_000);
      if (this.pending.length) {
        if (!this.canEdit) {
          this.lastError = Error("READ_ONLY_PENDING_EXPORT_REQUIRED: local edits are preserved, not uploaded");
          this._emit();
        } else await this.flush();
      }
    })().catch((error) => { this._block(error); throw error; }).finally(() => { this._connecting = null; });
    return this._connecting;
  }

  /** Every pull calls the server's live ACL/identity/lease-checked query. */
  async pull() {
    if (!this.session || this.state === "destroyed" || this.state === "blocked") return;
    if (this._pulling) return this._pulling;
    this._pulling = (async () => {
      try {
        for (let page = 0; page < 8; page++) {
          const result = await this.transport.readUpdates({
            sessionId: this.session.sessionId, afterSeq: this.cursor, limit: 64,
          });
          if (this.state === "destroyed" || this.state === "blocked") return;
          if (!Number.isSafeInteger(result.headSeq) || !Array.isArray(result.updates)) throw Error("Invalid update cursor");
          for (const item of result.updates) {
            if (item.seq <= this.cursor) continue;
            if (item.seq !== this.cursor + 1) throw Error("GAP_IN_SERVER_UPDATE_LOG");
            Y.applyUpdate(this.doc, fromBase64(item.base64), REMOTE);
            this.cursor = item.seq;
          }
          if (!result.hasMore) {
            if (this.cursor !== result.headSeq) throw Error("TRUNCATED_SERVER_LOG");
            return;
          }
          if (result.updates.length === 0) throw Error("EMPTY_SERVER_PAGE");
        }
        throw Error("SERVER_PAGINATION_EXCEEDED");
      } catch (error) { this._block(error); throw error; }
    })().finally(() => { this._pulling = null; });
    return this._pulling;
  }

  async flush() {
    if (this._flushing) return this._flushing;
    if (this.state !== "online" || !this.canEdit) return;
    this._flushing = (async () => {
      try {
        await this.persistBarrier;
        if (this.state !== "online") return;
        while (this.state === "online" && this.canEdit && this.pending.length) {
          const entry = this.pending[0];
          await this.transport.appendUpdate({
            sessionId: this.session.sessionId, operationId: entry.operationId, base64: entry.base64,
          });
          if (this.state !== "online") return;
          // If deletion fails, retain the op for idempotent retry on restart.
          if (this.journal) await this.journal.ack(this.journalScope, entry.operationId);
          this.pending.shift(); // server AND local journal acknowledged
          this._emit();
        }
      } catch (error) { this._block(error); throw error; }
    })().finally(() => { this._flushing = null; });
    return this._flushing;
  }

  disconnect() {
    if (this.state === "destroyed") return;
    this._stopNetwork();
    this.state = "offline";
    this.canEdit = false;
    this.session = null;
    this._emit();
  }
  async destroy() {
    if (this.state === "destroyed") return;
    this._stopNetwork();
    this.doc.off("update", this._onLocal);
    this.awareness.destroy();
    this.state = "destroyed";
    this._emit();
    await this.persistBarrier.catch(() => {});
    await this.transport.close?.();
  }
  /** Save/export the original Y.Doc first; never call without explicit UI consent. */
  exportSnapshot() { return Y.encodeStateAsUpdate(this.doc); }
}