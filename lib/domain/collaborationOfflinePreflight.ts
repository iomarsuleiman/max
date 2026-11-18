/**
 * Max 2.0 PR14 — immutable, bounded offline draft and reconnect preflight.
 * No storage, network provider, replay, or server authorization is implemented.
 * Never treat a client-supplied reconnect snapshot as an authorization proof.
 */
import { inspectLegacyContent, UnsafeCollaborationDocument } from "./collaborationCodec";

export const MAX_OFFLINE_DRAFT_COUNT = 16;
export const MAX_OFFLINE_DRAFT_BYTES = 512 * 1024;

export interface OfflineDocumentScope {
  ownerId: string;
  workspaceId: string;
  documentId: string;
  sessionId: string;
  baseRevision: number;
  schemaVersion: number;
}

export interface OfflineDraft {
  operationId: string;
  /** Original BlockNote JSON bytes, never normalized or auto-saved to cloud. */
  rawContent: string;
  baseRevision: number;
  schemaVersion: number;
}

export interface OfflineDraftLedger {
  readonly scope: Readonly<OfflineDocumentScope>;
  readonly state: "offline" | "quarantined";
  readonly drafts: readonly OfflineDraft[];
  readonly totalBytes: number;
}

export interface ReconnectSnapshot {
  ownerId: string;
  workspaceId: string;
  documentId: string;
  sessionId: string;
  remoteRevision: number;
  schemaVersion: number;
  /** This value is untrusted until verified at a server-authenticated boundary. */
  permission: "granted" | "revoked" | "unknown";
}

export type ReconnectDisposition =
  | "no-pending-changes" | "needs-provider-merge" | "revision-conflict" | "quarantine";

export interface ReconnectPreflight {
  disposition: ReconnectDisposition;
  pendingDrafts: number;
  /** Replaying full-document snapshots would overwrite concurrent CRDT edits. */
  canReplay: false;
  /** Production write permission must be checked inside every server operation. */
  canWrite: false;
}

function validId(value: string): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 200 &&
    value.trim() === value && !/[\u0000-\u001f]/.test(value);
}

function validRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function createOfflineDraftLedger(scope: OfflineDocumentScope): OfflineDraftLedger {
  if (!scope || !validId(scope.ownerId) || !validId(scope.workspaceId) ||
      !validId(scope.documentId) || !validId(scope.sessionId) ||
      !validRevision(scope.baseRevision) || !validRevision(scope.schemaVersion)) {
    throw new UnsafeCollaborationDocument("Invalid offline document scope");
  }
  return { scope: { ...scope }, state: "offline", drafts: [], totalBytes: 0 };
}

/**
 * Copy-on-write, idempotent local staging. Even a valid draft must not be
 * replayed until a real CRDT/OT provider and server authorization are proven.
 */
export function stageOfflineDraft(
  ledger: OfflineDraftLedger,
  draft: OfflineDraft,
): OfflineDraftLedger {
  if (ledger.state !== "offline") throw new UnsafeCollaborationDocument("Offline drafts are quarantined");
  if (!draft || !validId(draft.operationId) ||
      draft.baseRevision !== ledger.scope.baseRevision ||
      draft.schemaVersion !== ledger.scope.schemaVersion) {
    throw new UnsafeCollaborationDocument("Draft has invalid identity, version or base revision");
  }
  const existing = ledger.drafts.find((item) => item.operationId === draft.operationId);
  if (existing) {
    if (existing.rawContent === draft.rawContent &&
        existing.baseRevision === draft.baseRevision &&
        existing.schemaVersion === draft.schemaVersion) return ledger;
    throw new UnsafeCollaborationDocument("Conflicting reuse of an offline operation ID");
  }
  const inspected = inspectLegacyContent(draft.rawContent, draft.schemaVersion);
  if (ledger.drafts.length >= MAX_OFFLINE_DRAFT_COUNT ||
      ledger.totalBytes + inspected.sizeBytes > MAX_OFFLINE_DRAFT_BYTES) {
    throw new UnsafeCollaborationDocument("Offline draft queue limit reached");
  }
  return {
    scope: ledger.scope,
    state: ledger.state,
    drafts: [...ledger.drafts, { ...draft }],
    totalBytes: ledger.totalBytes + inspected.sizeBytes,
  };
}

/** Quarantining retains all local drafts for explicit recovery or export. */
export function quarantineOfflineDrafts(ledger: OfflineDraftLedger): OfflineDraftLedger {
  return { ...ledger, state: "quarantined" };
}

export function reviewOfflineReconnect(
  ledger: OfflineDraftLedger,
  remote: ReconnectSnapshot,
): ReconnectPreflight {
  const report = (disposition: ReconnectDisposition): ReconnectPreflight => ({
    disposition, pendingDrafts: ledger.drafts.length, canReplay: false, canWrite: false,
  });
  const scope = ledger.scope;
  if (ledger.state === "quarantined" || !remote ||
      remote.ownerId !== scope.ownerId || remote.workspaceId !== scope.workspaceId ||
      remote.documentId !== scope.documentId || remote.sessionId !== scope.sessionId ||
      remote.permission !== "granted" ||
      !validRevision(remote.remoteRevision) ||
      remote.schemaVersion !== scope.schemaVersion) {
    return report("quarantine");
  }
  if (ledger.drafts.length === 0) return report("no-pending-changes");
  if (remote.remoteRevision !== scope.baseRevision) return report("revision-conflict");
  return report("needs-provider-merge");
}
