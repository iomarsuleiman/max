import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";
import { readAuthorizedRecordSemantics, validSemanticInput, type SharedSemanticStore } from "./workspaceRecordSemantics";

/** PR34 shadow-only relationships for existing registered task records. */
export interface TaskRelationInput {
  parentTaskId: string | null;
  dependsOn: readonly string[];
}
export interface TaskRelationRow extends TaskRelationInput {
  workspaceId: string;
  databaseId: string;
  recordId: string;
  archivedAt: number | null;
  updatedAt: number;
}
export interface TaskRelationStore extends SharedSemanticStore {
  taskRelations(recordId: string): Promise<readonly TaskRelationRow[]>;
}
export interface AuthorizedTaskRelations {
  recordId: string;
  parentTaskId: string | null;
  dependsOn: string[];
  updatedAt: number;
}
export const MAX_TASK_DEPENDENCIES = 8;
export const MAX_TASK_RELATION_ROWS = 100;

export function validTaskRelationInput(input: TaskRelationInput, recordId: string): boolean {
  return validScopeId(recordId) &&
    (input.parentTaskId === null ||
      (typeof input.parentTaskId === "string" && validScopeId(input.parentTaskId) &&
       input.parentTaskId !== recordId)) &&
    Array.isArray(input.dependsOn) && input.dependsOn.length <= MAX_TASK_DEPENDENCIES &&
    new Set(input.dependsOn).size === input.dependsOn.length &&
    input.dependsOn.every((id) => typeof id === "string" && validScopeId(id) &&
      id !== recordId && id !== input.parentTaskId);
}

/**
 * Checks every existing edge in the bounded snapshot, then the proposed CAS
 * replacement. No partial graph writes; any malformed or cyclic graph denies.
 * The mutation separately verifies every NEW target is a live, authorized task.
 */
export function validTaskRelationGraph(
  existing: readonly TaskRelationRow[], proposed: TaskRelationRow,
  workspaceId: string, databaseId: string,
): boolean {
  if (!validWorkspaceId(workspaceId) || !validScopeId(databaseId) ||
      existing.length > MAX_TASK_RELATION_ROWS ||
      !validTaskRelationInput(proposed, proposed.recordId) ||
      proposed.workspaceId !== workspaceId || proposed.databaseId !== databaseId ||
      proposed.archivedAt !== null || !Number.isSafeInteger(proposed.updatedAt) ||
      proposed.updatedAt < 0) return false;

  const nodes = new Map<string, TaskRelationRow>();
  for (const row of existing) {
    if (!validTaskRelationInput(row, row.recordId) || row.workspaceId !== workspaceId ||
        row.databaseId !== databaseId || row.archivedAt !== null ||
        !Number.isSafeInteger(row.updatedAt) || row.updatedAt < 0 ||
        nodes.has(row.recordId)) return false;
    nodes.set(row.recordId, row);
  }
  if (!nodes.has(proposed.recordId) && nodes.size >= MAX_TASK_RELATION_ROWS) return false;
  nodes.set(proposed.recordId, proposed);

  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return false;
    if (visited.has(id)) return true;
    const node = nodes.get(id);
    if (!node) return true; // A target without relation metadata has no outgoing edges.
    visiting.add(id);
    const next = [...(node.parentTaskId === null ? [] : [node.parentTaskId]), ...node.dependsOn];
    for (const target of next) if (!visit(target)) return false;
    visiting.delete(id);
    visited.add(id);
    return true;
  };
  return [...nodes.keys()].every(visit);
}

/** Strict identity and same-database task registration; no ACLs from the browser. */
async function targetIsLiveTask(store: TaskRelationStore, workspaceId: string,
  databaseId: string, recordId: string): Promise<boolean> {
  const [scopes, metadata, semantic] = await Promise.all([
    store.scopes(workspaceId, recordId),
    store.recordMetadata(recordId),
    store.semanticRows(recordId),
  ]);
  return scopes.length === 1 && scopes[0].workspaceId === workspaceId &&
    scopes[0].pageId === recordId && scopes[0].parentId === databaseId &&
    metadata.length === 1 && metadata[0].workspaceId === workspaceId &&
    metadata[0].databaseId === databaseId && metadata[0].pageId === recordId &&
    metadata[0].kind === "record" && metadata[0].archivedAt === null &&
    semantic.length === 1 && semantic[0].workspaceId === workspaceId &&
    semantic[0].databaseId === databaseId && semantic[0].recordId === recordId &&
    semantic[0].kind === "task" && semantic[0].archivedAt === null &&
    Number.isSafeInteger(semantic[0].updatedAt) && semantic[0].updatedAt >= 0 &&
    validSemanticInput(semantic[0], recordId);
}

/** Used by the writer as well as by reads; permission checks never use IDs as grants. */
export async function canLinkTask(
  store: TaskRelationStore, accountId: string, workspaceId: string,
  databaseId: string, recordId: string,
): Promise<boolean> {
  if (!validPrincipalId(accountId) || !validWorkspaceId(workspaceId) ||
      !validScopeId(databaseId) || !validScopeId(recordId)) return false;
  try {
    if (!(await targetIsLiveTask(store, workspaceId, databaseId, recordId))) return false;
    return (await readAuthorizedRecordSemantics(
      store, accountId, workspaceId, databaseId, recordId
    ))?.kind === "task";
  } catch { return false; }
}

/**
 * Exposes only target IDs the viewer can currently read, no hidden dependency
 * counts, target titles, third-party assignments, or personal document data.
 * Corrupt links fail closed; inaccessible but valid targets are redacted.
 */
export async function readAuthorizedTaskRelations(
  store: TaskRelationStore, accountId: string | null,
  workspaceId: string, databaseId: string, recordId: string,
): Promise<AuthorizedTaskRelations | null> {
  if (!accountId || !validPrincipalId(accountId)) return null;
  try {
    if (!(await canLinkTask(store, accountId, workspaceId, databaseId, recordId))) return null;
    const rows = await store.taskRelations(recordId);
    if (rows.length === 0) return null;
    if (rows.length !== 1 || rows[0].workspaceId !== workspaceId ||
        rows[0].databaseId !== databaseId || rows[0].recordId !== recordId ||
        rows[0].archivedAt !== null || !Number.isSafeInteger(rows[0].updatedAt) ||
        rows[0].updatedAt < 0 || !validTaskRelationInput(rows[0], recordId)) return null;
    const row = rows[0];
    const refs = [...(row.parentTaskId === null ? [] : [row.parentTaskId]), ...row.dependsOn];
    const visible = new Set<string>();
    for (const id of refs) {
      if (!(await targetIsLiveTask(store, workspaceId, databaseId, id))) return null;
      if (await canLinkTask(store, accountId, workspaceId, databaseId, id)) visible.add(id);
    }
    return {
      recordId,
      parentTaskId: row.parentTaskId !== null && visible.has(row.parentTaskId) ? row.parentTaskId : null,
      dependsOn: row.dependsOn.filter((id) => visible.has(id)),
      updatedAt: row.updatedAt,
    };
  } catch { return null; }
}
