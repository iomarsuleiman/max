import { describe, expect, it } from "vitest";
import fixture from "../fixtures/editor-document.json";
import { DOCUMENT_SCHEMA_VERSION, normalizeBlocks } from "@/lib/domain/blocks";
import { inspectLegacyContent, type TransportCandidate } from "@/lib/domain/collaborationCodec";
import {
  COLLAB_TRIAL_SCENARIOS, COLLABORATION_TRANSPORT_ACTIVATED,
  MAX_PENDING_COLLAB_DRAFTS, appendOfflineCollaborationDraft,
  assessOfflineReconnect, assessProviderTrials, createOfflineCollaborationJournal,
  restoreOfflineCollaborationJournal, type DraftScope, type ProviderTrialEvidence,
  type ReconnectObservation,
} from "@/lib/domain/collaborationProviderRecovery";

const raw = JSON.stringify(normalizeBlocks(fixture));
const source = inspectLegacyContent(raw, DOCUMENT_SCHEMA_VERSION);
const scope: DraftScope = {
  accountId: "clerk-alice", workspaceId: "org-a", pageId: "page-a",
  candidate: "blocknote-yjs", sourceRevision: 9, schemaVersion: DOCUMENT_SCHEMA_VERSION,
};
const observation: ReconnectObservation = {
  accountId: scope.accountId, workspaceId: scope.workspaceId, pageId: scope.pageId,
  candidate: scope.candidate, schemaVersion: scope.schemaVersion, remoteRevision: scope.sourceRevision,
  access: "verified",
};
const makeEvidence = (candidate: TransportCandidate, environment: ProviderTrialEvidence["environment"]): ProviderTrialEvidence => ({
  candidate, environment, runId: "isolated-run-1",
  codec: { candidate, compatible: true, blockCount: source.blockIds.length, reason: null },
  outcomes: Object.fromEntries(COLLAB_TRIAL_SCENARIOS.map((scenario) => [scenario, "pass"])),
});

describe("Max 2.0 provider experiment evidence contract", () => {
  it("does not pretend a provider is compatible when no real trials exist", () => {
    const results = assessProviderTrials(source, []);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "blocked" && result.canActivate === false)).toBe(true);
    expect(results[0].missing).toHaveLength(COLLAB_TRIAL_SCENARIOS.length);
  });

  it("does not promote synthetic codec checks into evidence of real editor transport", () => {
    const [first] = assessProviderTrials(source, [makeEvidence("blocknote-yjs", "synthetic")]);
    expect(first.canActivate).toBe(false);
    const yjs = assessProviderTrials(source, [makeEvidence("blocknote-yjs", "synthetic")])[1];
    expect(yjs.status).toBe("needs-live-evidence");
  });

  it("requires independent review even for self-reported all-pass real-editor experiments", () => {
    const result = assessProviderTrials(source, [makeEvidence("blocknote-yjs", "real-editor-isolated")])[1];
    expect(result.status).toBe("candidate-for-independent-review");
    expect(result.canActivate).toBe(false);
    expect(COLLABORATION_TRANSPORT_ACTIVATED).toBe(false);
  });

  it("rejects codec loss, wrong candidate and block-count mismatches", () => {
    const trial = makeEvidence("convex-prosemirror-sync", "real-editor-isolated");
    expect(assessProviderTrials(source, [{ ...trial, codec: { ...trial.codec, compatible: false, reason: "Lost custom block" } }])[0].status).toBe("blocked");
    expect(assessProviderTrials(source, [{ ...trial, codec: { ...trial.codec, candidate: "blocknote-yjs" } }])[0].status).toBe("blocked");
    expect(assessProviderTrials(source, [{ ...trial, codec: { ...trial.codec, blockCount: 2 } }])[0].status).toBe("blocked");
  });

  it("records failed and missing adversarial scenarios rather than selecting a winner", () => {
    const trial = makeEvidence("blocknote-yjs", "real-editor-isolated");
    const altered = { ...trial, outcomes: { ...trial.outcomes,
      "revoked-mid-session": "fail" as const, "crash-and-tab-unmount": "not-run" as const } };
    const yjs = assessProviderTrials(source, [altered])[1];
    expect(yjs.failing).toContain("revoked-mid-session");
    expect(yjs.missing).toContain("crash-and-tab-unmount");
    expect(yjs.status).toBe("blocked");
  });

  it("rejects duplicate provider evidence", () => {
    const trial = makeEvidence("blocknote-yjs", "synthetic");
    expect(() => assessProviderTrials(source, [trial, trial])).toThrow(/Duplicate/i);
  });
});

describe("Max 2.0 offline draft retention and reconnect preflight", () => {
  it("preserves exact BlockNote custom content, Arabic text, IDs and source scope", () => {
    const created = createOfflineCollaborationJournal(scope);
    const updated = appendOfflineCollaborationDraft(created, "local-edit-1", raw);
    expect(created.drafts).toHaveLength(0);
    expect(updated.drafts).toEqual([{ key: "local-edit-1", sequence: 1, raw }]);
    expect(restoreOfflineCollaborationJournal(JSON.stringify(updated), scope)).toEqual(updated);
    expect(updated.drafts[0].raw).toContain("gold-table");
  });

  it("treats same-key retries as idempotent but refuses mismatched payloads", () => {
    const journal = appendOfflineCollaborationDraft(createOfflineCollaborationJournal(scope), "edit-1", raw);
    expect(appendOfflineCollaborationDraft(journal, "edit-1", raw)).toBe(journal);
    expect(() => appendOfflineCollaborationDraft(journal, "edit-1", "[]")).toThrow(/Conflicting/i);
  });

  it("rejects corrupt local data and unsupported schema without repairing IDs", () => {
    const journal = createOfflineCollaborationJournal(scope);
    expect(() => appendOfflineCollaborationDraft(journal, "bad", "{\"oops\"")).toThrow(/JSON/i);
    const blocks = JSON.parse(raw) as Array<{ id: string }>;
    blocks[1].id = blocks[0].id;
    expect(() => appendOfflineCollaborationDraft(journal, "bad", JSON.stringify(blocks))).toThrow(/Duplicate/i);
    expect(() => createOfflineCollaborationJournal({ ...scope, schemaVersion: 999 })).not.toThrow();
    expect(() => appendOfflineCollaborationDraft(createOfflineCollaborationJournal({ ...scope, schemaVersion: 999 }), "bad", raw)).toThrow(/schema/i);
  });

  it("quarantines cross-account, cross-workspace, cross-page and wrong provider restores", () => {
    const journal = appendOfflineCollaborationDraft(createOfflineCollaborationJournal(scope), "edit-1", raw);
    const saved = JSON.stringify(journal);
    expect(() => restoreOfflineCollaborationJournal(saved, { ...scope, accountId: "bob" })).toThrow(/scope/i);
    expect(() => restoreOfflineCollaborationJournal(saved, { ...scope, workspaceId: "org-b" })).toThrow(/scope/i);
    expect(() => restoreOfflineCollaborationJournal(saved, { ...scope, pageId: "elsewhere" })).toThrow(/scope/i);
    expect(() => restoreOfflineCollaborationJournal(saved, { ...scope, candidate: "convex-prosemirror-sync" })).toThrow(/scope/i);
  });

  it("fails closed on duplicate, missing and out-of-order draft sequences", () => {
    const journal = appendOfflineCollaborationDraft(createOfflineCollaborationJournal(scope), "edit-1", raw);
    const duplicate = { ...journal, drafts: [...journal.drafts, journal.drafts[0]] };
    expect(() => restoreOfflineCollaborationJournal(JSON.stringify(duplicate), scope)).toThrow(/order|duplicated/i);
    const outOfOrder = { ...journal, drafts: [{ ...journal.drafts[0], sequence: 4 }] };
    expect(() => restoreOfflineCollaborationJournal(JSON.stringify(outOfOrder), scope)).toThrow(/order/i);
  });

  it("enforces an all-or-nothing bounded local journal", () => {
    let journal = createOfflineCollaborationJournal(scope);
    for (let i = 0; i < MAX_PENDING_COLLAB_DRAFTS; i++) {
      journal = appendOfflineCollaborationDraft(journal, "edit-" + i, "[]");
    }
    expect(journal.drafts).toHaveLength(MAX_PENDING_COLLAB_DRAFTS);
    expect(() => appendOfflineCollaborationDraft(journal, "overflow", "[]")).toThrow(/Too many/i);
  });

  it("refuses automatic replay even after matching remote revision and access observation", () => {
    const journal = appendOfflineCollaborationDraft(createOfflineCollaborationJournal(scope), "edit-1", raw);
    expect(assessOfflineReconnect(journal, observation)).toEqual({
      state: "needs-authorized-provider-merge", pendingDrafts: 1,
      canReplay: false, preserveLocalCopy: true,
    });
    expect(journal.drafts).toHaveLength(1);
  });

  it("preserves local edits rather than overwriting remote updates on divergence", () => {
    const journal = appendOfflineCollaborationDraft(createOfflineCollaborationJournal(scope), "edit-1", raw);
    expect(assessOfflineReconnect(journal, { ...observation, remoteRevision: 10 }).state).toBe("conflict");
    expect(assessOfflineReconnect(journal, { ...observation, remoteRevision: 8 }).state).toBe("conflict");
    expect(journal.drafts).toHaveLength(1);
  });

  it("quarantines revoked, unknown, malformed and cross-scope reconnect observations", () => {
    const journal = appendOfflineCollaborationDraft(createOfflineCollaborationJournal(scope), "edit-1", raw);
    for (const altered of [
      { access: "revoked" as const },
      { access: "unknown" as const },
      { accountId: "another-account" },
      { workspaceId: "org-b" },
      { pageId: "page-b" },
      { candidate: "convex-prosemirror-sync" as const },
      { remoteRevision: Number.NaN },
      { schemaVersion: 2 },
    ]) {
      const result = assessOfflineReconnect(journal, { ...observation, ...altered });
      expect(result.state).toBe("quarantine");
      expect(result.canReplay).toBe(false);
      expect(result.preserveLocalCopy).toBe(true);
    }
  });

  it("recognizes an empty local queue without granting permission to connect", () => {
    const result = assessOfflineReconnect(createOfflineCollaborationJournal(scope), observation);
    expect(result.state).toBe("no-local-work");
    expect(result.canReplay).toBe(false);
  });
});
