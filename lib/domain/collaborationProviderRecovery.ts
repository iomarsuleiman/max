/**
 * Max 2.0 PR14 — provider experiment evidence and offline/reconnect safety.
 *
 * This is a pure, read-only evaluation and recovery planning layer. It never
 * opens a provider, writes Convex rows, replays operations, or authorizes users.
 * Caller-provided scope and observations are NOT authentication evidence.
 */
import {
  inspectLegacyContent,
  type CodecProbeResult,
  type TransportCandidate,
  type VerifiedLegacyContent,
  UnsafeCollaborationDocument,
} from "./collaborationCodec";

export const COLLAB_TRIAL_SCENARIOS = [
  "custom-block-codec",
  "two-client-concurrent-edits",
  "three-client-concurrent-edits",
  "offline-divergent-reconnect",
  "crash-and-tab-unmount",
  "arabic-ime-rtl-undo",
  "revoked-mid-session",
  "large-document-and-assets",
  "old-client-compatibility",
  "latency-and-payload-budgets",
] as const;
export type CollaborationTrialScenario = (typeof COLLAB_TRIAL_SCENARIOS)[number];
export type TrialOutcome = "pass" | "fail" | "not-run";
export type TrialEnvironment = "synthetic" | "real-editor-isolated";

export interface ProviderTrialEvidence {
  candidate: TransportCandidate;
  environment: TrialEnvironment;
  /** Never accept generic JSON round trips as evidence of a real editor adapter. */
  codec: CodecProbeResult;
  outcomes: Partial<Record<CollaborationTrialScenario, TrialOutcome>>;
  /** Human-readable run ID / isolated environment, not a permission token. */
  runId: string;
}

export interface TrialAssessment {
  candidate: TransportCandidate;
  status: "blocked" | "needs-live-evidence" | "candidate-for-independent-review";
  missing: CollaborationTrialScenario[];
  failing: CollaborationTrialScenario[];
  /** PR14 cannot activate a provider even with a fully passing trial. */
  canActivate: false;
}

const candidates: readonly TransportCandidate[] = ["convex-prosemirror-sync", "blocknote-yjs"];
const validId = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= 200;

/** Advisory experiment triage only; reported outcomes are not independently verified. */
export function assessProviderTrials(
  source: VerifiedLegacyContent,
  evidence: readonly ProviderTrialEvidence[],
): readonly TrialAssessment[] {
  // Re-verify the persisted source, never use an untrusted in-memory count alone.
  const verified = inspectLegacyContent(source.raw, source.schemaVersion);
  if (evidence.length > candidates.length || new Set(evidence.map((item) => item.candidate)).size !== evidence.length) {
    throw new UnsafeCollaborationDocument("Duplicate or excessive provider trials");
  }
  return candidates.map((candidate) => {
    const trial = evidence.find((item) => item.candidate === candidate);
    const missing = COLLAB_TRIAL_SCENARIOS.filter((scenario) =>
      !trial || trial.outcomes[scenario] === undefined || trial.outcomes[scenario] === "not-run");
    const failing = COLLAB_TRIAL_SCENARIOS.filter((scenario) => trial?.outcomes[scenario] === "fail");
    const invalid = !trial || !validId(trial.runId) ||
      (trial.environment !== "synthetic" && trial.environment !== "real-editor-isolated") ||
      !trial.codec || !trial.outcomes || trial.codec.candidate !== candidate || !trial.codec.compatible ||
      trial.codec.blockCount !== verified.blockIds.length ||
      trial.codec.reason !== null ||
      COLLAB_TRIAL_SCENARIOS.some((scenario) => {
        const value = trial.outcomes[scenario];
        return value !== undefined && value !== "pass" && value !== "fail" && value !== "not-run";
      });
    return {
      candidate,
      status: invalid || failing.length > 0
        ? "blocked" as const
        : trial.environment !== "real-editor-isolated" || missing.length > 0
          ? "needs-live-evidence" as const
          : "candidate-for-independent-review" as const,
      missing, failing, canActivate: false as const,
    };
  });
}

export const MAX_PENDING_COLLAB_DRAFTS = 16;
export const MAX_PENDING_COLLAB_BYTES = 2 * 1024 * 1024;

export interface DraftScope {
  /** Identity labels must be independently checked by the authenticated server. */
  accountId: string;
  workspaceId: string;
  pageId: string;
  candidate: TransportCandidate;
  sourceRevision: number;
  schemaVersion: number;
}
export interface PendingCollaborationDraft {
  key: string;
  sequence: number;
  /** Full local snapshot for explicit recovery; NOT an OT step or Yjs update. */
  raw: string;
}
export interface OfflineCollaborationJournal {
  scope: DraftScope;
  drafts: readonly PendingCollaborationDraft[];
}

function assertScope(scope: DraftScope): void {
  if (!scope || !validId(scope.accountId) || !validId(scope.workspaceId) || !validId(scope.pageId) ||
      !candidates.includes(scope.candidate) ||
      !Number.isSafeInteger(scope.sourceRevision) || scope.sourceRevision < 0 ||
      !Number.isSafeInteger(scope.schemaVersion)) {
    throw new UnsafeCollaborationDocument("Invalid offline journal scope");
  }
}

function equalScope(a: DraftScope, b: DraftScope): boolean {
  return a.accountId === b.accountId && a.workspaceId === b.workspaceId &&
    a.pageId === b.pageId && a.candidate === b.candidate &&
    a.sourceRevision === b.sourceRevision && a.schemaVersion === b.schemaVersion;
}

function assertJournal(journal: OfflineCollaborationJournal): void {
  assertScope(journal.scope);
  if (!Array.isArray(journal.drafts) || journal.drafts.length > MAX_PENDING_COLLAB_DRAFTS) {
    throw new UnsafeCollaborationDocument("Too many pending offline drafts");
  }
  let totalBytes = 0;
  const keys = new Set<string>();
  for (let i = 0; i < journal.drafts.length; i++) {
    const draft = journal.drafts[i];
    if (!draft || !validId(draft.key) || keys.has(draft.key) || draft.sequence !== i + 1) {
      throw new UnsafeCollaborationDocument("Malformed, duplicated or out-of-order offline draft");
    }
    keys.add(draft.key);
    const checked = inspectLegacyContent(draft.raw, journal.scope.schemaVersion);
    totalBytes += checked.sizeBytes;
    if (totalBytes > MAX_PENDING_COLLAB_BYTES) {
      throw new UnsafeCollaborationDocument("Offline journal exceeds bounded storage budget");
    }
  }
}

export function createOfflineCollaborationJournal(scope: DraftScope): OfflineCollaborationJournal {
  assertScope(scope);
  // Cloning prevents a caller from mutating the scope after validation.
  return { scope: { ...scope }, drafts: [] };
}

/**
 * Retain edits in order and never silently discard on offline/unmount errors.
 * No background sync is scheduled; a future trusted integration owns durable
 * encrypted storage, a real CRDT/OT update format and server acknowledgements.
 */
export function appendOfflineCollaborationDraft(
  journal: OfflineCollaborationJournal,
  key: string,
  raw: string,
): OfflineCollaborationJournal {
  assertJournal(journal);
  if (!validId(key)) throw new UnsafeCollaborationDocument("Invalid draft idempotency key");
  const verified = inspectLegacyContent(raw, journal.scope.schemaVersion);
  const prior = journal.drafts.find((draft) => draft.key === key);
  if (prior) {
    if (prior.raw === verified.raw) return journal;
    throw new UnsafeCollaborationDocument("Conflicting payload for an existing draft key");
  }
  const next = {
    scope: { ...journal.scope },
    drafts: [...journal.drafts.map((draft) => ({ ...draft })), {
      key, sequence: journal.drafts.length + 1, raw: verified.raw,
    }],
  };
  assertJournal(next);
  return next;
}

/** Safe after app reload only when the same authenticated account/page scope is verified. */
export function restoreOfflineCollaborationJournal(
  serialized: string,
  expected: DraftScope,
): OfflineCollaborationJournal {
  assertScope(expected);
  if (typeof serialized !== "string" || new TextEncoder().encode(serialized).byteLength > MAX_PENDING_COLLAB_BYTES + 8192) {
    throw new UnsafeCollaborationDocument("Invalid offline journal envelope");
  }
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch {
    throw new UnsafeCollaborationDocument("Corrupted offline journal");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UnsafeCollaborationDocument("Invalid offline journal");
  }
  const value = parsed as OfflineCollaborationJournal;
  assertJournal(value);
  if (!equalScope(value.scope, expected)) throw new UnsafeCollaborationDocument("Cross-account or stale-scope offline journal");
  return { scope: { ...value.scope }, drafts: value.drafts.map((draft) => ({ ...draft })) };
}

export interface ReconnectObservation {
  /** Information observed after server authorization; not itself a grant. */
  accountId: string;
  workspaceId: string;
  pageId: string;
  candidate: TransportCandidate;
  schemaVersion: number;
  remoteRevision: number;
  access: "verified" | "revoked" | "unknown";
}

export interface ReconnectAssessment {
  state: "no-local-work" | "needs-authorized-provider-merge" | "conflict" | "quarantine";
  pendingDrafts: number;
  /** No automatic replay, overwrite or content disclosure in PR14. */
  canReplay: false;
  preserveLocalCopy: true;
}

export function assessOfflineReconnect(
  journal: OfflineCollaborationJournal,
  observed: ReconnectObservation,
): ReconnectAssessment {
  assertJournal(journal);
  const sameScope = observed.accountId === journal.scope.accountId &&
    observed.workspaceId === journal.scope.workspaceId &&
    observed.pageId === journal.scope.pageId &&
    observed.candidate === journal.scope.candidate &&
    observed.schemaVersion === journal.scope.schemaVersion;
  const revisionValid = Number.isSafeInteger(observed.remoteRevision) && observed.remoteRevision >= 0;
  const state = !sameScope || !revisionValid || observed.access !== "verified"
    ? "quarantine" as const
    : journal.drafts.length === 0
      ? "no-local-work" as const
      : observed.remoteRevision !== journal.scope.sourceRevision
        ? "conflict" as const
        : "needs-authorized-provider-merge" as const;
  return { state, pendingDrafts: journal.drafts.length, canReplay: false, preserveLocalCopy: true };
}

/** Explicitly fail closed until provider-specific merge and authorization land in future PRs. */
export const COLLABORATION_TRANSPORT_ACTIVATED = false as const;
