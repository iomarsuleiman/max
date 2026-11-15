import { canAccessWorkspacePageFromServer } from "./workspaceAccessGateway";
import {
  canManageExternalScope, readAuthorizedExternalShare,
  type ExternalShareStore,
} from "./workspaceExternalSharePolicy";
import {
  validLinkPolicyRow, type LinkPolicyStore,
} from "./workspaceLinkPolicy";
import { validPrincipalId, validScopeId } from "./workspaceManagementPolicy";

/**
 * PR39: candidate preflight for future sharing gateways. True only means that
 * the CURRENT shadow sharing intent is eligible for a future, independently
 * authorized resource request. It is NEVER a document/media/MCP permission,
 * token, session lease, or evidence of public access.
 */
export interface SharingPreflightStore extends ExternalShareStore, LinkPolicyStore {}

const MAX_TIME = 4102444800000;
const validClock = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= 0 && n <= MAX_TIME;

/** Consent must be current, identity-bound and limited to a single accepted
 * proposal. Revocation, expiry, source permission or destination membership
 * changes make the next check deny. No content resource is ever read.
 */
export async function acceptedExternalSharePreflight(
  store: SharingPreflightStore,
  verifiedActor: string | null,
  shareId: string,
  now: number,
): Promise<boolean> {
  if (!verifiedActor || !validPrincipalId(verifiedActor) ||
      !validScopeId(shareId) || !validClock(now)) return false;
  try {
    const rows = await store.externalShares(shareId);
    if (rows.length !== 1 || rows[0].shareId !== shareId ||
        now < rows[0].createdAt) return false;
    const preview = await readAuthorizedExternalShare(
      store, verifiedActor, shareId, now
    );
    return preview?.status === "accepted" &&
      preview.sourceWorkspaceId !== null && preview.scopeId !== null;
  } catch { return false; }
}

/** A workspace-members policy must not expand an actor's current scope ACL.
 * Anonymous/public-intent policies are ALWAYS denied here; a link ID is not
 * a bearer credential. Future resource routes must recheck their own ACLs.
 */
export async function currentMemberLinkPreflight(
  store: SharingPreflightStore,
  verifiedActor: string | null,
  linkId: string,
  now: number,
): Promise<boolean> {
  if (!verifiedActor || !validPrincipalId(verifiedActor) ||
      !validScopeId(linkId) || !validClock(now)) return false;
  try {
    const rows = await store.linkPoliciesById(linkId);
    if (rows.length !== 1 || rows[0].linkId !== linkId) return false;
    const row = rows[0];
    if (!validLinkPolicyRow(row) || row.state !== "active" ||
        row.audience !== "workspace_members" ||
        now < row.createdAt || now >= row.expiresAt) return false;
    if (!(await canManageExternalScope(
      store, row.issuedByAccountId, row.originWorkspaceId, row.scopeId
    ))) return false;
    return await canAccessWorkspacePageFromServer(
      store, verifiedActor, row.originWorkspaceId, row.scopeId, "view"
    );
  } catch { return false; }
}
