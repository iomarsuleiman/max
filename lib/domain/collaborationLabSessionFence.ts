/**
 * PR15: trusted server-side *policy preflight* for isolated collaboration labs.
 * No bearer token, provider endpoint, room connection or shared-document write.
 *
 * The session row MUST come from authenticated server storage (not the client).
 * accountId MUST come from ctx.auth.getUserIdentity().subject on each operation.
 * All callers still require a separate actual server-side provider integration.
 */
import { canAccessWorkspacePageFromServer, type WorkspaceAuthorizationStore } from "./workspaceAccessGateway";
import type { TransportCandidate } from "./collaborationCodec";

export type LabOperation =
  | "join" | "read-snapshot" | "subscribe" | "submit-steps" | "reconnect";

export interface TrustedCollaborationLabSession {
  accountId: string;
  workspaceId: string;
  pageId: string;
  sessionId: string;
  candidate: TransportCandidate;
  generation: number;
  issuedAt: number;
  expiresAt: number;
}

export interface LabOperationRequest {
  workspaceId: string;
  pageId: string;
  sessionId: string;
  candidate: TransportCandidate;
  operation: LabOperation;
}

export interface LabServerContext {
  /** A server-only flag, never a client argument or NEXT_PUBLIC setting. */
  labEnabled: boolean;
  /** Trusted server clock. */
  now: number;
  /** Server-incremented generation, invalidated on revoke or permission edits. */
  currentGeneration: number;
}

export interface LabPreflightResult {
  policyEligible: boolean;
  /** No data API is implemented by this module. */
  canReadSharedContent: false;
  canSubmitSteps: false;
  canActivateProvider: false;
}

const DENIED: LabPreflightResult = Object.freeze({
  policyEligible: false,
  canReadSharedContent: false,
  canSubmitSteps: false,
  canActivateProvider: false,
});

const validId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200 &&
  value.trim() === value && !/[\u0000-\u001f]/.test(value);

const validCandidate = (value: unknown): value is TransportCandidate =>
  value === "blocknote-yjs" || value === "convex-prosemirror-sync";

const validOperation = (value: unknown): value is LabOperation =>
  value === "join" || value === "read-snapshot" || value === "subscribe" ||
  value === "submit-steps" || value === "reconnect";

/**
 * Re-check live workspace ACL for EACH requested action, not just session join.
 * A positive result is only diagnostic and never represents provider access.
 * A session marker / previously allowed response cannot bypass revocation.
 */
export async function inspectCollaborationLabOperation(
  store: WorkspaceAuthorizationStore,
  authenticatedAccountId: string | null,
  trustedSession: TrustedCollaborationLabSession | null,
  request: LabOperationRequest,
  server: LabServerContext,
): Promise<LabPreflightResult> {
  if (!server || server.labEnabled !== true ||
      !Number.isSafeInteger(server.now) || server.now < 0 ||
      !Number.isSafeInteger(server.currentGeneration) || server.currentGeneration < 1 ||
      !validId(authenticatedAccountId) || !trustedSession || !request ||
      !validId(trustedSession.accountId) ||
      !validId(trustedSession.workspaceId) || !validId(trustedSession.pageId) ||
      !validId(trustedSession.sessionId) || !validCandidate(trustedSession.candidate) ||
      !validOperation(request.operation) || !validCandidate(request.candidate) ||
      !validId(request.workspaceId) || !validId(request.pageId) || !validId(request.sessionId) ||
      !Number.isSafeInteger(trustedSession.generation) ||
      !Number.isSafeInteger(trustedSession.issuedAt) ||
      !Number.isSafeInteger(trustedSession.expiresAt) ||
      trustedSession.generation !== server.currentGeneration ||
      trustedSession.issuedAt > server.now ||
      trustedSession.expiresAt <= server.now ||
      trustedSession.expiresAt <= trustedSession.issuedAt ||
      trustedSession.expiresAt - trustedSession.issuedAt > 300_000 ||
      trustedSession.accountId !== authenticatedAccountId ||
      trustedSession.workspaceId !== request.workspaceId ||
      trustedSession.pageId !== request.pageId ||
      trustedSession.sessionId !== request.sessionId ||
      trustedSession.candidate !== request.candidate) return DENIED;

  const capability = request.operation === "submit-steps" || request.operation === "reconnect"
    ? "edit_content" : "view";
  try {
    const allowed = await canAccessWorkspacePageFromServer(
      store, authenticatedAccountId, request.workspaceId, request.pageId, capability,
    );
    return allowed ? {
      policyEligible: true,
      canReadSharedContent: false,
      canSubmitSteps: false,
      canActivateProvider: false,
    } : DENIED;
  } catch {
    // Corrupt/unavailable ACL backend is denial, not a session bypass.
    return DENIED;
  }
}
