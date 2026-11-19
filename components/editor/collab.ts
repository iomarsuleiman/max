import * as Y from "yjs";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { BlockNoteEditor } from "@blocknote/core";
import { blocksToYXmlFragment, withCollaboration } from "@blocknote/core/yjs";
import type { CollabJoin, CollabPull, CollabTransport } from "@/lib/client/data";
import { maxSchema } from "./blocks";
import { toEditorCodeLanguages } from "./codeLanguages";

/**
 * One open editor in a shared page's live room (lib/domain/collab.ts). Holds the Yjs document the
 * editor is bound to, sends local edits and cursor moves, applies everyone else's, and saves the
 * merged page back every second or so. Loaded only for shared pages.
 */

export { withCollaboration };
export const FRAGMENT = "document-store";
const REMOTE = "max-remote";
const COMMIT_DELAY_MS = 1000;
const COMMIT_MAX_WAIT_MS = 5000;
const COMPACT_EVERY = 60;

const CURSOR_COLORS = ["#d9480f", "#2b8a3e", "#1971c2", "#9c36b5", "#c2255c", "#0c8599", "#e67700", "#5f3dc4"];
export function cursorColor(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CURSOR_COLORS[h % CURSOR_COLORS.length];
}

function toB64(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The Yjs client ids an awareness update describes (its header: count, then id/clock/state). */
function awarenessClients(update: Uint8Array): number[] {
  let pos = 0;
  const uint = () => {
    let n = 0;
    let mult = 1;
    for (;;) {
      const b = update[pos++];
      n += (b & 0x7f) * mult;
      if (b < 0x80 || pos >= update.length) return n;
      mult *= 128;
    }
  };
  const count = uint();
  const out: number[] = [];
  for (let i = 0; i < count && pos < update.length; i++) {
    out.push(uint());
    uint();
    pos += uint();
  }
  return out;
}

export type LiveStatus = "connecting" | "live" | "saving" | "offline" | "reset" | "error";

export interface CollabEvents {
  /** The page was changed outside the room (or the room ended): reopen it. */
  onReset: () => void;
  onStatus: (s: LiveStatus, message?: string) => void;
  onSaved: (at: number) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class CollabSession {
  readonly doc = new Y.Doc();
  readonly fragment = this.doc.getXmlFragment(FRAGMENT);
  readonly awareness = new Awareness(this.doc);
  readonly clientId = globalThis.crypto.randomUUID();
  join: CollabJoin | null = null;
  private applied = 0;
  private sinceCompact = 0;
  private pending: Uint8Array[] = [];
  private sending: Promise<void> | null = null;
  private stopWatch: (() => void) | null = null;
  private closed = false;
  private dirty = false;
  private latest: unknown[] | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | undefined;
  private firstDirtyAt = 0;
  private committing: Promise<void> | null = null;
  private awarenessTimer: ReturnType<typeof setTimeout> | undefined;
  private seenCursors = new Map<string, { data: string; clients: number[] }>();

  constructor(
    private t: CollabTransport,
    private pageId: string,
    private events: CollabEvents,
  ) {}

  /** Joins the room, seeding it from the saved page when this editor is first in. */
  async open(loadSaved: () => Promise<{ blocks: unknown[]; revision: number }>) {
    for (let attempt = 0; !this.closed; attempt++) {
      const j = await this.t.join({ pageId: this.pageId, clientId: this.clientId });
      this.join = j;
      if (j.seed) {
        const saved = await loadSaved();
        const editor = BlockNoteEditor.create({ schema: maxSchema });
        const blocks = toEditorCodeLanguages(saved.blocks).blocks;
        if (blocks.length) blocksToYXmlFragment(editor as never, blocks as never, this.fragment);
        try {
          const { seq } = await this.t.push({ roomId: j.roomId, epoch: j.epoch, clientId: this.clientId, data: toB64(Y.encodeStateAsUpdate(this.doc)), seedRevision: saved.revision });
          this.applied = seq;
          break;
        } catch (err) {
          // Someone else seeded first, or the page changed while loading: start over.
          if ((err as { code?: string }).code !== "CONFLICT" || attempt > 20) throw err;
          this.reset();
          continue;
        }
      }
      if (j.ready) {
        await this.catchUp();
        break;
      }
      if (attempt > 40) throw new Error("Live editing is taking too long to start. Reload the page.");
      await sleep(400);
    }
    if (this.closed || !this.join) return;
    this.doc.on("update", this.onLocalUpdate);
    this.awareness.on("update", this.onAwareness);
    this.stopWatch = this.t.watch(this.join.roomId, () => this.applied, this.onPull, (err) => {
      if (err.code === "NOT_FOUND" || err.code === "FORBIDDEN") this.events.onStatus("error", err.message);
      else this.events.onStatus("offline");
    });
    this.events.onStatus("live");
  }

  /** Clears the local copy before trying to join again. */
  private reset() {
    this.doc.transact(() => {
      if (this.fragment.length) this.fragment.delete(0, this.fragment.length);
    }, REMOTE);
    this.applied = 0;
  }

  private async catchUp() {
    for (let i = 0; i < 1000; i++) {
      const r = await this.t.pull({ roomId: this.join!.roomId, afterSeq: this.applied });
      if (r.epoch !== this.join!.epoch) throw Object.assign(new Error("The page changed. Reloading it."), { code: "CONFLICT" });
      this.apply(r);
      if (this.applied >= r.head || !r.updates.length) return;
    }
  }

  private apply(r: CollabPull) {
    if (r.updates.length) {
      Y.transact(this.doc, () => {
        for (const u of r.updates) {
          if (u.seq <= this.applied) continue;
          Y.applyUpdate(this.doc, fromB64(u.data), REMOTE);
          this.applied = u.seq;
          this.sinceCompact++;
        }
      }, REMOTE);
    }
    const live = new Set<string>();
    for (const row of r.awareness) {
      if (row.clientId === this.clientId) continue;
      live.add(row.clientId);
      const seen = this.seenCursors.get(row.clientId);
      if (seen?.data === row.data) continue;
      const bytes = fromB64(row.data);
      this.seenCursors.set(row.clientId, { data: row.data, clients: awarenessClients(bytes) });
      applyAwarenessUpdate(this.awareness, bytes, REMOTE);
    }
    // Someone closed the page: take their cursor away now rather than when it times out.
    for (const [id, seen] of this.seenCursors) {
      if (live.has(id)) continue;
      this.seenCursors.delete(id);
      removeAwarenessStates(this.awareness, seen.clients.filter((c) => c !== this.doc.clientID), REMOTE);
    }
  }

  private onPull = (r: CollabPull) => {
    if (this.closed) return;
    if (r.epoch !== this.join?.epoch) {
      this.closed = true;
      this.events.onReset();
      return;
    }
    this.apply(r);
  };

  private onLocalUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE || this.closed) return;
    this.pending.push(update);
    if (!this.dirty) this.firstDirtyAt = Date.now();
    this.dirty = true;
    void this.flushPush();
    this.scheduleCommit();
  };

  private async flushPush(): Promise<void> {
    if (this.sending) return this.sending;
    if (!this.pending.length || !this.join) return;
    const data = Y.mergeUpdates(this.pending);
    this.pending = [];
    this.sending = (async () => {
      try {
        await this.t.push({ roomId: this.join!.roomId, epoch: this.join!.epoch, clientId: this.clientId, data: toB64(data) });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "CONFLICT") {
          this.closed = true;
          this.events.onReset();
          return;
        }
        if (code === "FORBIDDEN" || code === "READ_ONLY") {
          this.events.onStatus("error", (err as Error).message);
          return;
        }
        // Offline or a hiccup: keep the change and try again.
        this.pending.unshift(data);
        this.events.onStatus("offline");
        await sleep(1500);
      } finally {
        this.sending = null;
      }
      if (this.pending.length && !this.closed) await this.flushPush();
    })();
    return this.sending;
  }

  private onAwareness = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === REMOTE || this.closed || !this.join) return;
    if (![...added, ...updated, ...removed].includes(this.doc.clientID)) return;
    clearTimeout(this.awarenessTimer);
    this.awarenessTimer = setTimeout(() => {
      if (this.closed || !this.join) return;
      const data = toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
      void this.t.awareness({ roomId: this.join.roomId, epoch: this.join.epoch, clientId: this.clientId, data }).catch(() => undefined);
    }, 60);
  };

  /** The editor's current blocks (stored form), saved to the page after local edits. */
  setBlocks(blocks: unknown[]) {
    this.latest = blocks;
  }

  private scheduleCommit() {
    clearTimeout(this.commitTimer);
    const wait = Math.max(0, Math.min(COMMIT_DELAY_MS, this.firstDirtyAt + COMMIT_MAX_WAIT_MS - Date.now()));
    this.commitTimer = setTimeout(() => void this.commit(), wait);
  }

  /** Saves the merged page if this editor changed it, folding old updates into a snapshot now and then. */
  async commit(): Promise<void> {
    clearTimeout(this.commitTimer);
    if (this.committing) {
      await this.committing;
      if (this.dirty) return this.commit();
      return;
    }
    if (!this.dirty || !this.join || !this.join.canEdit) return;
    this.committing = (async () => {
      await this.flushPush();
      // Let the editor publish its latest document before reading it.
      await sleep(0);
      const blocks = this.latest;
      if (!blocks || this.closed) return;
      this.dirty = false;
      this.events.onStatus("saving");
      const compact = this.sinceCompact >= COMPACT_EVERY && this.applied > 1;
      try {
        const r = await this.t.commit({
          roomId: this.join!.roomId,
          epoch: this.join!.epoch,
          clientId: this.clientId,
          blocks,
          ...(compact ? { state: toB64(Y.encodeStateAsUpdate(this.doc)), upTo: this.applied } : {}),
        });
        if (r.compacted) this.sinceCompact = 0;
        this.events.onSaved(Date.now());
        this.events.onStatus("live");
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === "CONFLICT") {
          this.closed = true;
          this.events.onReset();
          return;
        }
        this.dirty = true;
        this.events.onStatus(code === "FORBIDDEN" || code === "READ_ONLY" ? "error" : "offline", (err as Error).message);
        this.scheduleCommit();
      }
    })();
    try {
      await this.committing;
    } finally {
      this.committing = null;
    }
  }

  /** Sends what's left and leaves the room. */
  async close() {
    if (this.closed && !this.join) return;
    const join = this.join;
    const wasOpen = !this.closed;
    if (wasOpen) await this.commit().catch(() => undefined);
    this.closed = true;
    clearTimeout(this.commitTimer);
    clearTimeout(this.awarenessTimer);
    this.stopWatch?.();
    this.doc.off("update", this.onLocalUpdate);
    this.awareness.off("update", this.onAwareness);
    this.awareness.destroy();
    if (join) void this.t.leave({ roomId: join.roomId, clientId: this.clientId }).catch(() => undefined);
    this.join = null;
  }

  get hasUnsaved() {
    return this.dirty || this.pending.length > 0;
  }
}
