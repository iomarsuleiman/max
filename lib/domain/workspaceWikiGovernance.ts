import { canAccessWorkspacePageFromServer } from "./workspaceAccessGateway";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";
import { readAuthorizedRecordSemantics, validSemanticInput, type SharedSemanticStore } from "./workspaceRecordSemantics";

/**
 * PR36: independent, shadow-only wiki governance. Verification attests ONLY
 * the registered metadata revisions; it must not be described as a review of
 * document contents or a public publishing/signature mechanism.
 */
export interface WikiGovernanceRow {
  workspaceId: string;
  databaseId: string;
  recordId: string;
  ownerId: string;
  reviewerId: string | null;
  verifiedAt: number | null;
  verifiedSemanticUpdatedAt: number | null;
  verifiedMetadataUpdatedAt: number | null;
  expiresAt: number;
  archivedAt: number | null;
  updatedAt: number;
}
export interface WikiGovernanceStore extends SharedSemanticStore {
  wikiGovernance(recordId: string): Promise<readonly WikiGovernanceRow[]>;
}
export type WikiVerificationStatus = "unverified" | "verified" | "stale" | "expired";
export interface AuthorizedWikiGovernance {
  recordId: string;
  ownedByMe: boolean;
  verification: WikiVerificationStatus;
  expiresAt: number;
  updatedAt: number;
}
const DAY = 86400000;
export const MAX_WIKI_VERIFICATION_AGE_MS = 366 * DAY;
const MAX_TIMESTAMP = 4102444800000;

const timestamp = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIMESTAMP;

/** Ownership expiry must be finite and no more than 366 days away. */
export function validWikiExpiry(expiresAt: number, now: number): boolean {
  return timestamp(now) && timestamp(expiresAt) &&
    expiresAt > now && expiresAt - now <= MAX_WIKI_VERIFICATION_AGE_MS;
}

export function validWikiGovernanceRow(
  row: WikiGovernanceRow, workspaceId: string, databaseId: string, recordId: string,
): boolean {
  if (!row || !validWorkspaceId(workspaceId) || !validScopeId(databaseId) ||
      !validScopeId(recordId) || row.workspaceId !== workspaceId ||
      row.databaseId !== databaseId || row.recordId !== recordId ||
      !validPrincipalId(row.ownerId) || row.archivedAt !== null ||
      !timestamp(row.expiresAt) || !timestamp(row.updatedAt)) return false;
  const values = [row.reviewerId, row.verifiedAt,
    row.verifiedSemanticUpdatedAt, row.verifiedMetadataUpdatedAt];
  if (values.every((v) => v === null)) return true;
  if (values.some((v) => v === null)) return false;
  return typeof row.reviewerId === "string" &&
    validPrincipalId(row.reviewerId) && row.reviewerId !== row.ownerId &&
    timestamp(row.verifiedAt!) && row.verifiedAt! <= row.updatedAt &&
    timestamp(row.verifiedSemanticUpdatedAt!) &&
    timestamp(row.verifiedMetadataUpdatedAt!);
}

export async function activeWikiMember(
  store: WikiGovernanceStore, workspaceId: string, accountId: string,
): Promise<boolean> {
  if (!validPrincipalId(accountId) || !validWorkspaceId(workspaceId)) return false;
  try {
    const rows = await store.memberships(workspaceId, accountId);
    return rows.length === 1 && rows[0].workspaceId === workspaceId &&
      rows[0].accountId === accountId && rows[0].status === "active";
  } catch { return false; }
}

/** Requires a live direct child, uniquely typed as a wiki, and both ACL checks. */
export async function canReadWikiRecord(
  store: WikiGovernanceStore, accountId: string | null,
  workspaceId: string, databaseId: string, recordId: string,
): Promise<boolean> {
  if (!accountId || !validPrincipalId(accountId)) return false;
  return (await readAuthorizedRecordSemantics(
    store, accountId, workspaceId, databaseId, recordId
  ))?.kind === "wiki";
}

/** All data is fetched in the same trusted Convex query snapshot. */
export async function readAuthorizedWikiGovernance(
  store: WikiGovernanceStore, accountId: string | null,
  workspaceId: string, databaseId: string, recordId: string, now: number,
): Promise<AuthorizedWikiGovernance | null> {
  if (!timestamp(now) || !(await canReadWikiRecord(
    store, accountId, workspaceId, databaseId, recordId
  ))) return null;
  try {
    const [rows, semantics, metadata] = await Promise.all([
      store.wikiGovernance(recordId), store.semanticRows(recordId),
      store.recordMetadata(recordId),
    ]);
    if (rows.length !== 1 || !validWikiGovernanceRow(rows[0], workspaceId, databaseId, recordId) ||
        semantics.length !== 1 || semantics[0].kind !== "wiki" ||
        semantics[0].workspaceId !== workspaceId || semantics[0].databaseId !== databaseId ||
        semantics[0].recordId !== recordId || semantics[0].archivedAt !== null ||
        !validSemanticInput(semantics[0], recordId) ||
        metadata.length !== 1 || metadata[0].workspaceId !== workspaceId ||
        metadata[0].databaseId !== databaseId || metadata[0].pageId !== recordId ||
        metadata[0].kind !== "record" || metadata[0].archivedAt !== null) return null;
    const row = rows[0];
    const ownerValid = await activeWikiMember(store, workspaceId, row.ownerId) &&
      await canReadWikiRecord(store, row.ownerId, workspaceId, databaseId, recordId);
    let verification: WikiVerificationStatus = "unverified";
    if (row.reviewerId !== null) {
      const reviewerValid = await activeWikiMember(store, workspaceId, row.reviewerId) &&
        await canAccessWorkspacePageFromServer(store, row.reviewerId, workspaceId, databaseId, "manage") &&
        await canAccessWorkspacePageFromServer(store, row.reviewerId, workspaceId, recordId, "manage");
      verification = !ownerValid || !reviewerValid ||
        row.verifiedSemanticUpdatedAt !== semantics[0].updatedAt ||
        row.verifiedMetadataUpdatedAt !== metadata[0].updatedAt ||
        semantics[0].state !== "approved"
        ? "stale" : now >= row.expiresAt ? "expired" : "verified";
    }
    return {
      recordId,
      ownedByMe: ownerValid && row.ownerId === accountId,
      verification,
      expiresAt: row.expiresAt,
      updatedAt: row.updatedAt,
    };
  } catch { return null; }
}
