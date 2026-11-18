import { canAccessWorkspacePageFromServer } from "./workspaceAccessGateway";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";
import type { SharedDatabaseReadStore } from "./sharedDatabasePolicy";

/**
 * PR33 shadow record semantics. Not a public task directory or shared document.
 * All values come from a trusted server snapshot; never use client-supplied ACLs.
 */
export type SemanticKind = "task" | "project" | "wiki";
export interface SemanticInput {
  kind: SemanticKind;
  state: string;
  assigneeId: string | null;
  projectId: string | null;
  dueAt: number | null;
}
export interface SemanticRow extends SemanticInput {
  workspaceId: string;
  databaseId: string;
  recordId: string;
  archivedAt: number | null;
  updatedAt: number;
}
export interface RegisteredRecord {
  workspaceId: string;
  databaseId: string;
  pageId: string;
  kind: "record";
  archivedAt: number | null;
  title: string;
  updatedAt: number;
}
export interface SharedSemanticStore extends SharedDatabaseReadStore {
  recordMetadata(recordId: string): Promise<readonly RegisteredRecord[]>;
  semanticRows(recordId: string): Promise<readonly SemanticRow[]>;
}

const STATES: Record<SemanticKind, readonly string[]> = {
  task: ["todo", "in_progress", "blocked", "done"],
  project: ["planned", "active", "paused", "completed"],
  wiki: ["draft", "in_review", "approved"],
};
const MAX_DUE_AT = 4102444800000; // 2100-01-01 UTC; deliberately bounded.

export function validSemanticInput(input: SemanticInput, recordId: string): boolean {
  if (!validScopeId(recordId) || !Object.prototype.hasOwnProperty.call(STATES, input.kind) ||
      !STATES[input.kind]?.includes(input.state)) return false;
  if (input.kind !== "task") {
    return input.assigneeId === null && input.projectId === null && input.dueAt === null;
  }
  return (input.assigneeId === null || validPrincipalId(input.assigneeId)) &&
    (input.projectId === null || (validScopeId(input.projectId) && input.projectId !== recordId)) &&
    (input.dueAt === null || (Number.isSafeInteger(input.dueAt) &&
      input.dueAt >= 0 && input.dueAt <= MAX_DUE_AT));
}

function validRegistration(rows: readonly RegisteredRecord[], workspaceId: string,
  databaseId: string, recordId: string): boolean {
  return rows.length === 1 && rows[0].workspaceId === workspaceId &&
    rows[0].databaseId === databaseId && rows[0].pageId === recordId &&
    rows[0].kind === "record" && rows[0].archivedAt === null &&
    typeof rows[0].title === "string" && rows[0].title.length <= 512 &&
    Number.isSafeInteger(rows[0].updatedAt) && rows[0].updatedAt >= 0;
}

function validSemanticRow(rows: readonly SemanticRow[], workspaceId: string,
  databaseId: string, recordId: string): rows is readonly SemanticRow[] {
  return rows.length === 1 && rows[0].workspaceId === workspaceId &&
    rows[0].databaseId === databaseId && rows[0].recordId === recordId &&
    rows[0].archivedAt === null && Number.isSafeInteger(rows[0].updatedAt) &&
    rows[0].updatedAt >= 0 && validSemanticInput(rows[0], recordId);
}

/**
 * A read requires database AND record permission. Linked projects require their
 * own record authorization; invisible links are omitted, never shown as IDs or
 * inferred through totals. Third-party assignee identities are not disclosed:
 * callers can tell only whether they themselves are assigned.
 */
export interface AuthorizedSemanticPreview {
  recordId: string;
  kind: SemanticKind;
  state: string;
  dueAt: number | null;
  assignedToMe: boolean;
  projectId: string | null;
  updatedAt: number;
}
export async function readAuthorizedRecordSemantics(
  store: SharedSemanticStore,
  verifiedAccountId: string | null,
  workspaceId: string,
  databaseId: string,
  recordId: string,
): Promise<AuthorizedSemanticPreview | null> {
  if (!verifiedAccountId || !validPrincipalId(verifiedAccountId) ||
      !validWorkspaceId(workspaceId) || !validScopeId(databaseId) ||
      !validScopeId(recordId) || recordId === databaseId) return null;
  try {
    const [bindings, scopes, registered, semantics] = await Promise.all([
      store.databaseBindings(workspaceId, databaseId),
      store.scopes(workspaceId, recordId),
      store.recordMetadata(recordId),
      store.semanticRows(recordId),
    ]);
    if (bindings.length !== 1 || bindings[0].workspaceId !== workspaceId ||
        bindings[0].pageId !== databaseId || bindings[0].kind !== "database" ||
        bindings[0].archivedAt !== null ||
        scopes.length !== 1 || scopes[0].workspaceId !== workspaceId ||
        scopes[0].pageId !== recordId || scopes[0].parentId !== databaseId ||
        !validRegistration(registered, workspaceId, databaseId, recordId) ||
        !validSemanticRow(semantics, workspaceId, databaseId, recordId)) return null;
    if (!(await canAccessWorkspacePageFromServer(store, verifiedAccountId, workspaceId, databaseId, "view")) ||
        !(await canAccessWorkspacePageFromServer(store, verifiedAccountId, workspaceId, recordId, "view"))) return null;

    const row = semantics[0];
    let projectId: string | null = null;
    if (row.projectId !== null) {
      const [projectScopes, projectRegistration, projectSemantics] = await Promise.all([
        store.scopes(workspaceId, row.projectId),
        store.recordMetadata(row.projectId),
        store.semanticRows(row.projectId),
      ]);
      // Broken foreign keys fail closed; a merely inaccessible valid project is redacted.
      if (projectScopes.length !== 1 || projectScopes[0].workspaceId !== workspaceId ||
          projectScopes[0].pageId !== row.projectId || projectScopes[0].parentId !== databaseId ||
          !validRegistration(projectRegistration, workspaceId, databaseId, row.projectId) ||
          !validSemanticRow(projectSemantics, workspaceId, databaseId, row.projectId) ||
          projectSemantics[0].kind !== "project") return null;
      if (await canAccessWorkspacePageFromServer(
        store, verifiedAccountId, workspaceId, row.projectId, "view"
      )) projectId = row.projectId;
    }
    return {
      recordId,
      kind: row.kind,
      state: row.state,
      dueAt: row.dueAt,
      assignedToMe: row.assigneeId === verifiedAccountId,
      projectId,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null; // Missing identity, revoked access and corrupt rows are indistinguishable.
  }
}
