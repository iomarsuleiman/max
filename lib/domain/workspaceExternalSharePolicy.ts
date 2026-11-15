import { canAccessWorkspacePageFromServer, type WorkspaceAuthorizationStore } from "./workspaceAccessGateway";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";

/**
 * PR37 is a sharing PROPOSAL registry, not a content-access grant. Existing
 * personal documents, workspace ACLs, media, MCP and the editor never consult
 * this table. A future content gateway must independently authorize each read.
 */
export type ExternalShareMode = "guest" | "cross_workspace";
export type ExternalShareStatus = "pending" | "accepted" | "declined" | "revoked";
export interface ExternalShareRow {
  shareId: string;
  originWorkspaceId: string;
  scopeId: string;
  targetWorkspaceId: string | null;
  targetAccountId: string;
  createdByAccountId: string;
  status: ExternalShareStatus;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  updatedAt: number;
}
export interface ExternalShareStore extends WorkspaceAuthorizationStore {
  externalShares(shareId: string): Promise<readonly ExternalShareRow[]>;
  globalScopes(pageId: string): Promise<readonly { workspaceId: string; pageId: string }[]>;
}
export interface ExternalSharePreview {
  shareId: string;
  mode: ExternalShareMode;
  status: ExternalShareStatus | "expired";
  expiresAt: number;
  updatedAt: number;
  // Opaque shadow-scope reference only after authenticated acceptance.
  // No titles, articles, other account identities or content are exposed.
  sourceWorkspaceId: string | null;
  scopeId: string | null;
}
export const MAX_EXTERNAL_SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIME = 4102444800000;
const validTime = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME;

export function validExternalShareExpiry(now: number, expiresAt: number): boolean {
  return validTime(now) && validTime(expiresAt) &&
    expiresAt > now && expiresAt - now <= MAX_EXTERNAL_SHARE_TTL_MS;
}
export function validExternalShareTarget(
  originWorkspaceId: string, targetWorkspaceId: string | null,
  targetAccountId: string, creatorId: string,
): boolean {
  return validWorkspaceId(originWorkspaceId) && validPrincipalId(creatorId) &&
    validPrincipalId(targetAccountId) && targetAccountId !== creatorId &&
    (targetWorkspaceId === null ||
      (validWorkspaceId(targetWorkspaceId) && targetWorkspaceId !== originWorkspaceId));
}
export function validExternalShareRow(row: ExternalShareRow): boolean {
  return !!row && validScopeId(row.shareId) && validScopeId(row.scopeId) &&
    validExternalShareTarget(row.originWorkspaceId, row.targetWorkspaceId,
      row.targetAccountId, row.createdByAccountId) &&
    ["pending", "accepted", "declined", "revoked"].includes(row.status) &&
    validTime(row.createdAt) && validTime(row.updatedAt) &&
    row.updatedAt >= row.createdAt &&
    validTime(row.expiresAt) && row.expiresAt > row.createdAt &&
    row.expiresAt - row.createdAt <= MAX_EXTERNAL_SHARE_TTL_MS &&
    (row.status === "pending"
      ? row.resolvedAt === null
      : row.resolvedAt !== null && validTime(row.resolvedAt) &&
        row.resolvedAt >= row.createdAt && row.resolvedAt <= row.updatedAt);
}
export function nextExternalShareRevision(previous: number, now: number): number | null {
  if (!validTime(previous) || !validTime(now)) return null;
  const revision = Math.max(now, previous + 1);
  return validTime(revision) ? revision : null;
}

/** Cross-tenant recipients must have exactly one active, correctly bound
 * membership in their target workspace. Guests need only their verified
 * authenticated subject; they are NOT silently enrolled in the source tenant.
 */
export async function validExternalShareRecipient(
  store: WorkspaceAuthorizationStore, accountId: string,
  targetWorkspaceId: string | null,
): Promise<boolean> {
  if (!validPrincipalId(accountId)) return false;
  if (targetWorkspaceId === null) return true;
  if (!validWorkspaceId(targetWorkspaceId)) return false;
  try {
    const [workspaces, memberships] = await Promise.all([
      store.workspaces(targetWorkspaceId),
      store.memberships(targetWorkspaceId, accountId),
    ]);
    if (workspaces.length !== 1 || memberships.length !== 1) return false;
    const ws = workspaces[0], member = memberships[0];
    return ws.workspaceId === targetWorkspaceId && ws.status === "active" &&
      validPrincipalId(ws.ownerId) && member.workspaceId === targetWorkspaceId &&
      member.accountId === accountId && member.status === "active" &&
      ["owner", "admin", "member", "guest"].includes(member.role) &&
      (member.role === "owner") === (ws.ownerId === accountId);
  } catch { return false; }
}

/** Enforces global scope ownership and CURRENT source manager rights, not an
 * invitation's historical authorization snapshot or browser-supplied role.
 */
export async function canManageExternalScope(
  store: ExternalShareStore, actor: string,
  originWorkspaceId: string, scopeId: string,
): Promise<boolean> {
  if (!validPrincipalId(actor) || !validWorkspaceId(originWorkspaceId) ||
      !validScopeId(scopeId)) return false;
  try {
    const scopes = await store.globalScopes(scopeId);
    return scopes.length === 1 && scopes[0].workspaceId === originWorkspaceId &&
      scopes[0].pageId === scopeId &&
      await canAccessWorkspacePageFromServer(
        store, actor, originWorkspaceId, scopeId, "manage"
      );
  } catch { return false; }
}

/** Fail closed on revoked source permissions, destination membership changes,
 * changed tenants, expired invitation, duplicates and backend failures. */
export async function readAuthorizedExternalShare(
  store: ExternalShareStore, accountId: string | null,
  shareId: string, now: number,
): Promise<ExternalSharePreview | null> {
  if (!accountId || !validPrincipalId(accountId) ||
      !validScopeId(shareId) || !validTime(now)) return null;
  try {
    const rows = await store.externalShares(shareId);
    if (rows.length !== 1 || rows[0].shareId !== shareId ||
        !validExternalShareRow(rows[0])) return null;
    const row = rows[0];
    if (row.targetAccountId !== accountId ||
        !(await validExternalShareRecipient(store, accountId, row.targetWorkspaceId)) ||
        !(await canManageExternalScope(
          store, row.createdByAccountId, row.originWorkspaceId, row.scopeId
        ))) return null;
    const active = now < row.expiresAt;
    const status = !active ? "expired" : row.status;
    return {
      shareId, mode: row.targetWorkspaceId === null ? "guest" : "cross_workspace",
      status, expiresAt: row.expiresAt, updatedAt: row.updatedAt,
      sourceWorkspaceId: status === "accepted" ? row.originWorkspaceId : null,
      scopeId: status === "accepted" ? row.scopeId : null,
    };
  } catch { return null; }
}
