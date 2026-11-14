import { MaxError, notFound } from "../errors";

export interface DocumentRef {
  workspaceId: string;
  pageId: string;
}

/** Server-owned counters. Restore must advance these, never reset them. */
export interface DocumentHead<T> {
  document: DocumentRef;
  generation: number;
  revision: number;
  snapshot: T;
}

export interface UpdateIdentity {
  document: DocumentRef;
  /** Verified actor, resolved by the server rather than trusted from JSON. */
  accountId: string;
  operationId: string;
  generation: number;
}

export interface AppliedReceipt extends UpdateIdentity {
  outcome: "applied";
  revision: number;
}

export type PendingDraft<T> = UpdateIdentity & {
  baseRevision: number;
  snapshot: T;
};

export type DraftSettlement<T> =
  | { state: "acknowledged"; receipt: AppliedReceipt }
  | { state: "conflict"; draft: PendingDraft<T>; reason: "generation" | "revision" }
  | { state: "revoked"; draft: PendingDraft<T> };

function sameDocument(a: DocumentRef, b: DocumentRef): boolean {
  return a.workspaceId === b.workspaceId && a.pageId === b.pageId;
}

function receiptFor(update: UpdateIdentity, revision: number): AppliedReceipt {
  return {
    document: { ...update.document },
    accountId: update.accountId,
    operationId: update.operationId,
    generation: update.generation,
    outcome: "applied",
    revision,
  };
}

function nextCounter(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value === Number.MAX_SAFE_INTEGER) {
    throw new MaxError("LIMIT", "This document needs maintenance before another update can be accepted.");
  }
  return value + 1;
}

function assertCurrentGeneration<T>(head: DocumentHead<T>, update: UpdateIdentity) {
  if (!sameDocument(head.document, update.document)) throw notFound();
  if (head.generation !== update.generation) {
    throw new MaxError("CONFLICT", "The document structure changed. Keep your local draft and load the current document before continuing.", {
      generation: head.generation,
      revision: head.revision,
    });
  }
}

/**
 * Reference protocol only, not connected to a provider or operation dispatcher.
 * The adapter must authorize and re-read this head in the same transaction.
 * mergeAndValidate must merge an engine update, not overwrite with client JSON.
 * It must reject structural edits, including deleted/recreated CRDT containers.
 */
export function commitContentUpdate<T>(
  head: DocumentHead<T>,
  update: UpdateIdentity,
  mergeAndValidate: (latest: T) => T,
): { head: DocumentHead<T>; receipt: AppliedReceipt } {
  assertCurrentGeneration(head, update);
  const revision = nextCounter(head.revision);
  const snapshot = mergeAndValidate(structuredClone(head.snapshot));
  return {
    head: { ...head, document: { ...head.document }, revision, snapshot },
    receipt: receiptFor(update, revision),
  };
}

/**
 * Moves, restores and other structural mutations require an exact acknowledged
 * head. applyAndValidate operates on fresh server content using semantic intent
 * such as block IDs; it must not install the sender's stale block snapshot.
 * Rotating the generation rejects every older disconnected writer into recovery.
 */
export function commitStructuralChange<T>(
  head: DocumentHead<T>,
  update: UpdateIdentity & { baseRevision: number },
  applyAndValidate: (latest: T) => T,
): { head: DocumentHead<T>; receipt: AppliedReceipt } {
  assertCurrentGeneration(head, update);
  if (head.revision !== update.baseRevision) {
    throw new MaxError("CONFLICT", "Another edit arrived before this structural change. Keep your local draft and review the current document.", {
      generation: head.generation,
      revision: head.revision,
    });
  }
  const revision = nextCounter(head.revision);
  const generation = nextCounter(head.generation);
  const snapshot = applyAndValidate(structuredClone(head.snapshot));
  return {
    head: { ...head, document: { ...head.document }, generation, revision, snapshot },
    // This receipt acknowledges the submitted generation. The returned head
    // carries the next one; conflating them would strand the mover's outbox.
    receipt: receiptFor(update, revision),
  };
}

/** A foreign/stale receipt must never clear a local recovery branch. */
export function settleDraft<T>(
  draft: PendingDraft<T>,
  result: AppliedReceipt | { outcome: "conflict"; reason: "generation" | "revision" } | { outcome: "revoked" },
): DraftSettlement<T> {
  if (result.outcome === "revoked") return { state: "revoked", draft: structuredClone(draft) };
  if (result.outcome === "conflict") return { state: "conflict", reason: result.reason, draft: structuredClone(draft) };
  if (!sameDocument(draft.document, result.document) || draft.accountId !== result.accountId || draft.operationId !== result.operationId) {
    throw new MaxError("CONFLICT", "This acknowledgement belongs to a different update. Your local draft has been retained.");
  }
  if (draft.generation !== result.generation) return { state: "conflict", reason: "generation", draft: structuredClone(draft) };
  if (!Number.isSafeInteger(result.revision) || result.revision <= draft.baseRevision)
    return { state: "conflict", reason: "revision", draft: structuredClone(draft) };
  return { state: "acknowledged", receipt: structuredClone(result) };
}
