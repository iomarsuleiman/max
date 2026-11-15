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
export async function previewAuthorizedSharedRecords(
  store: SharedDatabaseReadStore,
  verifiedAccountId: string | null,
  workspaceId: string,
  databaseId: string,
  limit = 25,
): Promise<readonly SharedRecordPreview[]> {
  if (!validRequest(verifiedAccountId, workspaceId, databaseId) ||
    !Number.isInteger(limit) || limit < 1 || limit > MAX_RETURN) return [];

  try {
    const bindings = await store.databaseBindings(workspaceId, databaseId);
    if (!validBinding(bindings, workspaceId, databaseId) ||
      !(await canAccessWorkspacePageFromServer(store, verifiedAccountId, workspaceId, databaseId, "view"))) return [];

    const candidates = await store.recordCandidates(workspaceId, databaseId);
    // One corrupt, mismatched or duplicate record invalidates this batch; do
    // not return a partially trusted snapshot or accidentally aggregate it.
    if (!validCandidates(candidates, workspaceId, databaseId)) return [];

    const result: SharedRecordPreview[] = [];
    for (const record of candidates) {
      // Never return a row from a different page ancestry, even if a legacy
      // index or stale migration associates it with this database ID.
      const scopes = await store.scopes(workspaceId, record.pageId);
      if (scopes.length !== 1 || scopes[0].workspaceId !== workspaceId ||
        scopes[0].pageId !== record.pageId || scopes[0].parentId !== databaseId) return [];

      if (record.archivedAt !== null) continue;
      if (await canAccessWorkspacePageFromServer(store, verifiedAccountId, workspaceId, record.pageId, "view")) {
        if (result.length < limit) {
          // Explicit allowlist: never spread an untrusted row into a response.
          result.push({ pageId: record.pageId, title: record.title, updatedAt: record.updatedAt });
        }
      }
    }
    return result;
  } catch {
    // Invalid or unavailable trusted store fails closed, without partial rows.
    return [];
  }
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
