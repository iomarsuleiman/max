import { canAccessWorkspacePageFromServer, type WorkspaceAuthorizationStore } from "./workspaceAccessGateway";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";

/**
 * PR31: authorization contract for future workspace database readers.
 * This is not wired into legacy personal databases, Convex routes or MCP.
 * The store must read a SINGLE trusted server transaction/snapshot. Never let
 * a browser supply database bindings, candidate rows, or permission snapshots.
 */
export interface SharedDatabaseBinding {
  workspaceId: string;
  pageId: string;
  kind: "database";
  archivedAt: number | null;
}

export interface SharedRecordCandidate {
  workspaceId: string;
  pageId: string;
  databaseId: string;
  kind: "record";
  archivedAt: number | null;
  title: string;
  updatedAt: number;
  /** Not exposed by the preview: formulas, rollups and relations may leak restricted rows. */
  values?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SharedDatabaseReadStore extends WorkspaceAuthorizationStore {
  databaseBindings(workspaceId: string, databaseId: string): Promise<readonly SharedDatabaseBinding[]>;
  recordCandidates(workspaceId: string, databaseId: string): Promise<readonly SharedRecordCandidate[]>;
}

export interface SharedRecordPreview {
  pageId: string;
  title: string;
  updatedAt: number;
}

const MAX_SCAN = 100;
const MAX_RETURN = 50;

function validRequest(accountId: string | null, workspaceId: string, databaseId: string): accountId is string {
  return typeof accountId === "string" && validPrincipalId(accountId) &&
    validWorkspaceId(workspaceId) && validScopeId(databaseId);
}

function validBinding(rows: readonly SharedDatabaseBinding[], workspaceId: string, databaseId: string): boolean {
  return rows.length === 1 && rows[0].workspaceId === workspaceId &&
    rows[0].pageId === databaseId && rows[0].kind === "database" && rows[0].archivedAt === null;
}

function validCandidates(rows: readonly SharedRecordCandidate[], workspaceId: string, databaseId: string): boolean {
  if (rows.length > MAX_SCAN) return false;
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.workspaceId !== workspaceId || row.databaseId !== databaseId ||
      row.kind !== "record" || !validScopeId(row.pageId) || row.pageId === databaseId ||
      seen.has(row.pageId) || (row.archivedAt !== null && (!Number.isSafeInteger(row.archivedAt) || row.archivedAt < 0)) ||
      typeof row.title !== "string" || row.title.length > 512 ||
      !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0) return false;
    seen.add(row.pageId);
  }
  return true;
}

/**
 * A bounded, metadata-only authorization proof for a future shared database.
 *
 * Database view permission NEVER implicitly returns every record. Every record
 * needs its own live page authorization and a direct database parent binding.
 * Failures return the same empty result as an empty/inaccessible database; no
 * hidden totals, pagination cursors, calculated values or relation targets.
 *
 * Candidate reads MUST be bounded before this function is called (not an
 * unbounded .collect() in Convex). This contract makes no pagination promises.
 */
async function collectAuthorizedRecords(
  store: SharedDatabaseReadStore,
  verifiedAccountId: string | null,
  workspaceId: string,
  databaseId: string,
): Promise<SharedRecordPreview[]> {
  if (!validRequest(verifiedAccountId, workspaceId, databaseId)) return [];
  try {
    const bindings = await store.databaseBindings(workspaceId, databaseId);
    if (!validBinding(bindings, workspaceId, databaseId) ||
      !(await canAccessWorkspacePageFromServer(store, verifiedAccountId, workspaceId, databaseId, "view"))) return [];
    // The backend MUST apply an indexed take(101) in this same query snapshot.
    const candidates = await store.recordCandidates(workspaceId, databaseId);
    if (!validCandidates(candidates, workspaceId, databaseId)) return [];
    const visible: SharedRecordPreview[] = [];
    for (const record of candidates) {
      const scopes = await store.scopes(workspaceId, record.pageId);
      if (scopes.length !== 1 || scopes[0].workspaceId !== workspaceId ||
        scopes[0].pageId !== record.pageId || scopes[0].parentId !== databaseId) return [];
      if (record.archivedAt !== null) continue;
      if (await canAccessWorkspacePageFromServer(store, verifiedAccountId, workspaceId, record.pageId, "view")) {
        visible.push({ pageId: record.pageId, title: record.title, updatedAt: record.updatedAt });
      }
    }
    visible.sort((a, b) => a.pageId < b.pageId ? -1 : a.pageId > b.pageId ? 1 : 0);
    return visible;
  } catch {
    return []; // Never return partially authorized data after errors or revocation.
  }
}

/** PR31 compatibility: bounded authorization-only preview, no cursor. */
export async function previewAuthorizedSharedRecords(
  store: SharedDatabaseReadStore,
  verifiedAccountId: string | null,
  workspaceId: string,
  databaseId: string,
  limit = 25,
): Promise<readonly SharedRecordPreview[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RETURN) return [];
  return (await collectAuthorizedRecords(store, verifiedAccountId, workspaceId, databaseId)).slice(0, limit);
}

export interface AuthorizedSharedRecordPage {
  records: readonly SharedRecordPreview[];
  nextCursor: string | null;
}
const EMPTY_PAGE: AuthorizedSharedRecordPage = { records: [], nextCursor: null };

/**
 * PR32: incremental metadata paging with cursor equal to an ALREADY VISIBLE
 * record ID. It is reauthorized on each read. No hidden raw index cursor,
 * unfiltered offset, aggregate counts or relation expansion. Deliberately
 * limited to at most 100 registered metadata records per database.
 */
export async function pageAuthorizedSharedRecords(
  store: SharedDatabaseReadStore,
  verifiedAccountId: string | null,
  workspaceId: string,
  databaseId: string,
  limit = 20,
  afterVisiblePageId: string | null = null,
): Promise<AuthorizedSharedRecordPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25 ||
      (afterVisiblePageId !== null && !validScopeId(afterVisiblePageId))) return EMPTY_PAGE;
  const authorized = await collectAuthorizedRecords(store, verifiedAccountId, workspaceId, databaseId);
  let start = 0;
  if (afterVisiblePageId !== null) {
    const index = authorized.findIndex((row) => row.pageId === afterVisiblePageId);
    if (index < 0) return EMPTY_PAGE;
    start = index + 1;
  }
  const records = authorized.slice(start, start + limit);
  const nextCursor = records.length && start + limit < authorized.length
    ? records[records.length - 1].pageId : null;
  return { records, nextCursor };
}

/** Pure preflight for a future record write; no write API is enabled here. */
export async function canEditSharedRecord(
  store: SharedDatabaseReadStore,
  verifiedAccountId: string | null,
  workspaceId: string,
  databaseId: string,
  recordId: string,
): Promise<boolean> {
  if (!validRequest(verifiedAccountId, workspaceId, databaseId) ||
    !validScopeId(recordId) || recordId === databaseId) return false;
  try {
    const bindings = await store.databaseBindings(workspaceId, databaseId);
    if (!validBinding(bindings, workspaceId, databaseId)) return false;
    const scopes = await store.scopes(workspaceId, recordId);
    if (scopes.length !== 1 || scopes[0].workspaceId !== workspaceId ||
      scopes[0].pageId !== recordId || scopes[0].parentId !== databaseId) return false;
    return (await canAccessWorkspacePageFromServer(store, verifiedAccountId, workspaceId, databaseId, "edit_content")) &&
      (await canAccessWorkspacePageFromServer(store, verifiedAccountId, workspaceId, recordId, "edit_content"));
  } catch {
    return false;
  }
}
