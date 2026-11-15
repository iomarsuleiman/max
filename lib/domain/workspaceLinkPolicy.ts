import { canManageExternalScope, nextExternalShareRevision, validExternalShareExpiry, type ExternalScopeAccessStore } from "./workspaceExternalSharePolicy";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";

/** PR38: management-only shadow policy. It does NOT issue bearer credentials
 * or authorize document, asset, search, editor, public, or MCP reads. */
export type LinkAudience = "workspace_members" | "anyone_with_link";
export type LinkState = "active" | "revoked";
export interface LinkPolicyRow {
  linkId: string;
  originWorkspaceId: string;
  scopeId: string;
  issuedByAccountId: string;
  audience: LinkAudience;
  state: LinkState;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  revokedAt: number | null;
}
export interface LinkPolicyStore extends ExternalScopeAccessStore {
  linkPoliciesById(id: string): Promise<readonly LinkPolicyRow[]>;
  linkPoliciesByScope(workspaceId: string, scopeId: string): Promise<readonly LinkPolicyRow[]>;
}
export interface ManagedLinkPreview {
  linkId: string;
  audience: LinkAudience;
  status: "active" | "expired" | "revoked" | "issuer_revoked";
  expiresAt: number;
  updatedAt: number;
}
export const MAX_LINK_POLICIES_PER_SCOPE = 32;
const MAX_TIME = 4102444800000;
const validTime = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= 0 && n <= MAX_TIME;

export const validLinkAudience = (audience: string): audience is LinkAudience =>
  audience === "workspace_members" || audience === "anyone_with_link";

export function validLinkPolicyRow(row: LinkPolicyRow): boolean {
  return !!row && validScopeId(row.linkId) && validScopeId(row.scopeId) &&
    validWorkspaceId(row.originWorkspaceId) &&
    validPrincipalId(row.issuedByAccountId) && validLinkAudience(row.audience) &&
    (row.state === "active" || row.state === "revoked") &&
    validTime(row.createdAt) && validTime(row.updatedAt) &&
    row.updatedAt >= row.createdAt && validTime(row.expiresAt) &&
    row.expiresAt > row.createdAt &&
    validExternalShareExpiry(row.createdAt, row.expiresAt) &&
    (row.state === "active" ? row.revokedAt === null :
      row.revokedAt !== null && validTime(row.revokedAt) &&
      row.revokedAt >= row.createdAt && row.revokedAt <= row.updatedAt);
}

export const validLinkExpiry = validExternalShareExpiry;
export const nextLinkRevision = nextExternalShareRevision;

export async function previewManagedLink(
  store: LinkPolicyStore, actor: string | null, linkId: string, now: number,
): Promise<ManagedLinkPreview | null> {
  if (!actor || !validPrincipalId(actor) || !validScopeId(linkId) || !validTime(now)) return null;
  try {
    const rows = await store.linkPoliciesById(linkId);
    if (rows.length !== 1 || rows[0].linkId !== linkId ||
        !validLinkPolicyRow(rows[0])) return null;
    const row = rows[0];
    if (!(await canManageExternalScope(store, actor, row.originWorkspaceId, row.scopeId))) return null;
    const status = row.state === "revoked" ? "revoked" as const :
      now >= row.expiresAt ? "expired" as const :
      !(await canManageExternalScope(store, row.issuedByAccountId, row.originWorkspaceId, row.scopeId))
        ? "issuer_revoked" as const : "active" as const;
    return { linkId, audience: row.audience, status, expiresAt: row.expiresAt, updatedAt: row.updatedAt };
  } catch { return null; }
}

/** Bounded, all-or-nothing manager listing. A malformed or duplicated policy
 * invalidates the entire result; there are never public audience listings. */
export async function listManagedLinks(
  store: LinkPolicyStore, actor: string | null, workspaceId: string,
  scopeId: string, now: number,
): Promise<readonly ManagedLinkPreview[]> {
  if (!actor || !validPrincipalId(actor) || !validTime(now) ||
      !validWorkspaceId(workspaceId) || !validScopeId(scopeId)) return [];
  try {
    if (!(await canManageExternalScope(store, actor, workspaceId, scopeId))) return [];
    const rows = await store.linkPoliciesByScope(workspaceId, scopeId);
    if (rows.length > MAX_LINK_POLICIES_PER_SCOPE ||
        new Set(rows.map((r) => r.linkId)).size !== rows.length ||
        rows.some((r) => !validLinkPolicyRow(r) ||
          r.originWorkspaceId !== workspaceId || r.scopeId !== scopeId)) return [];
    const previews: ManagedLinkPreview[] = [];
    for (const row of rows) {
      const status = row.state === "revoked" ? "revoked" as const :
        now >= row.expiresAt ? "expired" as const :
        !(await canManageExternalScope(store, row.issuedByAccountId, workspaceId, scopeId))
          ? "issuer_revoked" as const : "active" as const;
      previews.push({
        linkId: row.linkId, audience: row.audience, status,
        expiresAt: row.expiresAt, updatedAt: row.updatedAt,
      });
    }
    return previews.sort((a, b) => a.linkId.localeCompare(b.linkId));
  } catch { return []; }
}
