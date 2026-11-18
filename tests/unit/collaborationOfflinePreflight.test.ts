import { describe, expect, it } from "vitest";
import fixture from "../fixtures/editor-document.json";
import { DOCUMENT_SCHEMA_VERSION, normalizeBlocks } from "@/lib/domain/blocks";
import { UnsafeCollaborationDocument } from "@/lib/domain/collaborationCodec";
import {
  MAX_OFFLINE_DRAFT_COUNT, createOfflineDraftLedger,
  quarantineOfflineDrafts, reviewOfflineReconnect, stageOfflineDraft,
} from "@/lib/domain/collaborationOfflinePreflight";

const scope = {
  ownerId: "alice", workspaceId: "ws-alpha", documentId: "doc-one",
  sessionId: "session-1", baseRevision: 7, schemaVersion: DOCUMENT_SCHEMA_VERSION,
};
const rawContent = JSON.stringify(normalizeBlocks(fixture));
const draft = (operationId: string) => ({
  operationId, rawContent, baseRevision: 7, schemaVersion: DOCUMENT_SCHEMA_VERSION,
});
const remote = {
  ownerId: scope.ownerId, workspaceId: scope.workspaceId,
  documentId: scope.documentId, sessionId: scope.sessionId,
  remoteRevision: 7, schemaVersion: DOCUMENT_SCHEMA_VERSION,
  permission: "granted" as const,
};

describe("PR14 offline/reconnect preflight (no replay, no persistence)", () => {
  it("preserves UTF-8 BlockNote bytes and returns immutable copy-on-write snapshots", () => {
    const first = createOfflineDraftLedger(scope);
    const second = stageOfflineDraft(first, draft("op1"));
    expect(first.drafts).toHaveLength(0);
    expect(second.drafts[0].rawContent).toBe(rawContent);
    expect(second.totalBytes).toBe(new TextEncoder().encode(rawContent).byteLength);
    expect(second.scope).toEqual(scope);
    expect(stageOfflineDraft(second, draft("op1"))).toBe(second);
  });
  it("rejects conflicting IDs rather than overwriting a prior draft", () => {
    const first = stageOfflineDraft(createOfflineDraftLedger(scope), draft("op1"));
    const altered = { ...draft("op1"), rawContent: "[]" };
    expect(() => stageOfflineDraft(first, altered)).toThrow(/Conflicting/);
    expect(first.drafts[0].rawContent).toBe(rawContent);
  });
  it("denies stale revisions, invalid schema and malformed content", () => {
    const ledger = createOfflineDraftLedger(scope);
    expect(() => stageOfflineDraft(ledger, { ...draft("x"), baseRevision: 8 })).toThrow(UnsafeCollaborationDocument);
    expect(() => stageOfflineDraft(ledger, { ...draft("x"), schemaVersion: 99 })).toThrow(UnsafeCollaborationDocument);
    expect(() => stageOfflineDraft(ledger, { ...draft("x"), rawContent: "invalid" })).toThrow(/JSON/);
    expect(() => createOfflineDraftLedger({ ...scope, ownerId: "" })).toThrow(/scope/);
  });
  it("bounds a queue and retains all queued drafts on overflow", () => {
    let ledger = createOfflineDraftLedger(scope);
    for (let i = 0; i < MAX_OFFLINE_DRAFT_COUNT; i++) {
      ledger = stageOfflineDraft(ledger, draft("id-" + i));
    }
    expect(ledger.drafts).toHaveLength(MAX_OFFLINE_DRAFT_COUNT);
    expect(() => stageOfflineDraft(ledger, draft("overflow"))).toThrow(/limit/);
    expect(ledger.drafts).toHaveLength(MAX_OFFLINE_DRAFT_COUNT);
  });
  it("does not replay even when a matching revision and claimed grant are presented", () => {
    const ledger = stageOfflineDraft(createOfflineDraftLedger(scope), draft("op1"));
    expect(reviewOfflineReconnect(ledger, remote)).toEqual({
      disposition: "needs-provider-merge", pendingDrafts: 1,
      canReplay: false, canWrite: false,
    });
  });
  it("detects concurrent remote changes and refuses snapshot overwrite", () => {
    const ledger = stageOfflineDraft(createOfflineDraftLedger(scope), draft("op1"));
    expect(reviewOfflineReconnect(ledger, { ...remote, remoteRevision: 8 })).toMatchObject({
      disposition: "revision-conflict", canReplay: false,
    });
  });
  it("quarantines revoked, unknown, cross-account and cross-workspace sessions", () => {
    const ledger = stageOfflineDraft(createOfflineDraftLedger(scope), draft("op1"));
    for (const snapshot of [
      { ...remote, permission: "revoked" as const },
      { ...remote, permission: "unknown" as const },
      { ...remote, ownerId: "bob" },
      { ...remote, workspaceId: "ws-other" },
      { ...remote, documentId: "doc-other" },
      { ...remote, sessionId: "session-stale" },
      { ...remote, schemaVersion: 99 },
    ]) {
      expect(reviewOfflineReconnect(ledger, snapshot)).toMatchObject({
        disposition: "quarantine", canReplay: false, canWrite: false,
      });
    }
  });
  it("keeps quarantined drafts available for explicit recovery, never clears them", () => {
    const staged = stageOfflineDraft(createOfflineDraftLedger(scope), draft("op1"));
    const isolated = quarantineOfflineDrafts(staged);
    expect(isolated.drafts).toEqual(staged.drafts);
    expect(reviewOfflineReconnect(isolated, remote).disposition).toBe("quarantine");
    expect(() => stageOfflineDraft(isolated, draft("op2"))).toThrow(/quarantined/);
  });
  it("reports empty offline changes without providing a write capability", () => {
    expect(reviewOfflineReconnect(createOfflineDraftLedger(scope), remote)).toMatchObject({
      disposition: "no-pending-changes", canReplay: false, canWrite: false,
    });
  });
});
