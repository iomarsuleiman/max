/**
 * Max 2.0 PR13 — deterministic, non-writing shadow migration rehearsal.
 *
 * This module never provisions a collaboration document or grants access.
 * Callers MUST load and authorize owner-scoped rows on the trusted server
 * before using these data-only helpers. An equal shadow is NOT a cutover flag.
 */
import type { DocumentRow } from "./types";
import { inspectLegacyContent, UnsafeCollaborationDocument } from "./collaborationCodec";

export const MAX_SHADOW_BATCH_SIZE = 25;

export interface ShadowDocumentCandidate {
  workspaceId: string;
  ownerId: string;
  documentId: string;
  pageId: string;
  sourceRevision: number;
  schemaVersion: number;
  /** Original bytes preserved for complete rollback; do not replace them. */
  originalContent: string;
  /** Canonical JSON for candidate transport evaluation, not a live document. */
  shadowContent: string;
  sourceSizeBytes: number;
  blockCount: number;
}

export interface ShadowMigrationPlan {
  readonly dryRun: true;
  readonly workspaceId: string;
  readonly ownerId: string;
  readonly candidates: readonly ShadowDocumentCandidate[];
  readonly originalBytes: number;
}

export interface ShadowParityReport {
  readonly equal: boolean;
  readonly reason: string | null;
  readonly sourceRevision: number;
  readonly canCutOver: false;
}

function requireIdentity(ownerId: string, workspaceId: string): void {
  if (typeof ownerId !== "string" || !ownerId.trim() || ownerId.length > 200 ||
      typeof workspaceId !== "string" || !workspaceId.trim() || workspaceId.length > 200) {
    throw new UnsafeCollaborationDocument("Missing or invalid trusted owner/workspace identity");
  }
}

function validateRow(doc: DocumentRow, ownerId: string): void {
  if (!doc || !doc._id || !doc.pageId || doc.ownerId !== ownerId ||
      !Number.isSafeInteger(doc.revision) || doc.revision < 0 ||
      !Number.isSafeInteger(doc.schemaVersion)) {
    throw new UnsafeCollaborationDocument("Invalid, cross-owner or stale source document metadata");
  }
}

/**
 * Planning is all-or-nothing; it never mutates the input records, destination
 * workspace or original version history. IDs and revisions are retained.
 */
export function rehearseShadowDocumentMigration(
  documents: readonly DocumentRow[],
  trustedOwnerId: string,
  targetWorkspaceId: string,
): ShadowMigrationPlan {
  requireIdentity(trustedOwnerId, targetWorkspaceId);
  if (!Array.isArray(documents) || documents.length > MAX_SHADOW_BATCH_SIZE) {
    throw new UnsafeCollaborationDocument("Shadow rehearsal batch exceeds limit");
  }
  const seenPages = new Set<string>();
  const seenDocs = new Set<string>();
  const candidates = documents.map((doc) => {
    validateRow(doc, trustedOwnerId);
    if (seenDocs.has(doc._id) || seenPages.has(doc.pageId)) {
      throw new UnsafeCollaborationDocument("Duplicated source document or page");
    }
    seenDocs.add(doc._id);
    seenPages.add(doc.pageId);
    const verified = inspectLegacyContent(doc.content, doc.schemaVersion);
    return {
      workspaceId: targetWorkspaceId,
      ownerId: trustedOwnerId,
      documentId: doc._id,
      pageId: doc.pageId,
      sourceRevision: doc.revision,
      schemaVersion: doc.schemaVersion,
      originalContent: doc.content,
      shadowContent: verified.canonical,
      sourceSizeBytes: verified.sizeBytes,
      blockCount: verified.blockIds.length,
    } satisfies ShadowDocumentCandidate;
  }).sort((a, b) => a.pageId.localeCompare(b.pageId) || a.documentId.localeCompare(b.documentId));
  return {
    dryRun: true, workspaceId: targetWorkspaceId, ownerId: trustedOwnerId,
    candidates, originalBytes: candidates.reduce((sum, candidate) => sum + candidate.sourceSizeBytes, 0),
  };
}

/**
 * Fail-closed compare immediately before any future cutover. A mismatch must
 * not be auto-repaired by overwriting the original document. The report never
 * exposes protected document content.
 */
export function compareShadowDocument(
  source: DocumentRow,
  candidate: ShadowDocumentCandidate,
  trustedOwnerId: string,
  targetWorkspaceId: string,
): ShadowParityReport {
  const failed = (reason: string): ShadowParityReport => ({
    equal: false, reason, sourceRevision: source?.revision ?? -1, canCutOver: false,
  });
  try {
    requireIdentity(trustedOwnerId, targetWorkspaceId);
    validateRow(source, trustedOwnerId);
    if (!candidate || candidate.workspaceId !== targetWorkspaceId || candidate.ownerId !== trustedOwnerId ||
        candidate.documentId !== source._id || candidate.pageId !== source.pageId) return failed("Identity or page scope mismatch");
    if (candidate.sourceRevision !== source.revision || candidate.schemaVersion !== source.schemaVersion) {
      return failed("Source revision or schema changed");
    }
    const original = inspectLegacyContent(source.content, source.schemaVersion);
    const shadow = inspectLegacyContent(candidate.shadowContent, candidate.schemaVersion);
    if (candidate.originalContent !== source.content ||
        candidate.sourceSizeBytes !== original.sizeBytes || candidate.blockCount !== original.blockIds.length) {
      return failed("Source bytes or migration metadata changed");
    }
    if (original.canonical !== shadow.canonical) return failed("Shadow content is not lossless");
    return { equal: true, reason: null, sourceRevision: source.revision, canCutOver: false };
  } catch {
    return failed("Invalid source or candidate content");
  }
}

/** A complete batch must have exactly one equal candidate per original. */
export function compareShadowBatch(
  sources: readonly DocumentRow[],
  candidates: readonly ShadowDocumentCandidate[],
  trustedOwnerId: string,
  targetWorkspaceId: string,
): boolean {
  try {
    if (sources.length !== candidates.length || sources.length > MAX_SHADOW_BATCH_SIZE) return false;
    const sourceIds = new Set<string>();
    const candidateIds = new Set<string>();
    const sourcePages = new Set<string>();
    const candidatePages = new Set<string>();
    const byId = new Map(sources.map((source) => [source._id, source]));
    if (byId.size !== sources.length) return false;
    for (const source of sources) {
      if (sourcePages.has(source.pageId)) return false;
      sourcePages.add(source.pageId);
      sourceIds.add(source._id);
    }
    for (const candidate of candidates) {
      if (candidateIds.has(candidate.documentId) || candidatePages.has(candidate.pageId)) return false;
      candidateIds.add(candidate.documentId);
      candidatePages.add(candidate.pageId);
      const source = byId.get(candidate.documentId);
      if (!source || !compareShadowDocument(source, candidate, trustedOwnerId, targetWorkspaceId).equal) return false;
    }
    return sourceIds.size === candidateIds.size && sourcePages.size === candidatePages.size;
  } catch {
    return false;
  }
}
