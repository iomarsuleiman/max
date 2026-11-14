import { MaxError, notFound } from "../errors";
import { COLLABORATION_LIMITS, type CollaborationTransaction, type ResolvedCollaborationActor } from "./collaborationStore";
import { canPage, evaluatePageAccess, type GroupMembership, type PageCapability, type PageGrant, type PolicyPage, type PolicySnapshot } from "./policy";

/**
 * Trusted adapter, using the SAME database transaction as CollaborationTransaction.
 * Return policy metadata for archived/template pages too; operation invariants
 * separately decide whether those pages may be edited, restored or discovered.
 * Resolve the real parentId ?? databaseId and persisted workspace/teamspace/ACL.
 * Never construct policies from request-body roles, ancestors, groups or grants.
 */
export interface PagePolicyReader {
  getPolicyPage(pageId: string): Promise<PolicyPage | null>;
}

export const PAGE_AUTHORIZATION_LIMITS = Object.freeze({
  /** Must match policy.ts's MAX_ANCESTORS. Boundary tests exercise 100/101. */
  ancestors: 100,
  discoveryCandidates: 200,
});

type AuthorizationReads = Pick<
  CollaborationTransaction,
  "getWorkspace" | "getPersonalWorkspace" | "getMembership" | "getGroup" | "listUserGroupMemberships" | "getTeamspace"
>;

export interface PageAuthorizationContext {
  transaction: AuthorizationReads;
  pages: PagePolicyReader;
  actor: ResolvedCollaborationActor;
  /** Resource selection only; it never establishes membership. */
  workspaceId: string;
  /** Server-owned clock, sampled inside the outer transaction. */
  now: number;
}

/** Internal policy metadata. Never return this object directly from UI/MCP APIs. */
export interface AuthorizedPolicyPage {
  page: PolicyPage;
  grant: PageGrant;
}

const denied = () => notFound();
const validId = (value: string) =>
  typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value && !/[\u0000-\u001f]/.test(value);

async function actorSnapshot(context: PageAuthorizationContext): Promise<Omit<PolicySnapshot, "pages" | "teamspaces">> {
  const { transaction: tx, actor, workspaceId, now } = context;
  if (!Number.isSafeInteger(now) || now < 0) throw new MaxError("INTERNAL", "The workspace clock is unavailable.");
  if (!validId(workspaceId) || !validId(actor.userId)) throw denied();
  const workspace = await tx.getWorkspace(workspaceId);
  if (!workspace || workspace.id !== workspaceId || workspace.state !== "active") throw denied();
  const membership = await tx.getMembership(workspaceId, actor.userId);
  if (!membership || membership.workspaceId !== workspaceId || membership.userId !== actor.userId || membership.state !== "active") throw denied();

  const groupMemberships: GroupMembership[] = [];
  if (workspace.kind === "personal") {
    if (workspace.ownerId !== actor.userId || membership.role !== "owner") throw denied();
    const canonical = await tx.getPersonalWorkspace(actor.userId);
    if (!canonical || canonical.id !== workspaceId || canonical.kind !== "personal" || canonical.ownerId !== actor.userId || canonical.state !== "active")
      throw denied();
  } else {
    const memberships = await tx.listUserGroupMemberships(workspaceId, actor.userId);
    if (memberships.length > COLLABORATION_LIMITS.groupsPerWorkspace) throw new MaxError("LIMIT", "This workspace exceeds the supported collaboration limit.");
    for (const member of memberships) {
      if (member.workspaceId !== workspaceId || member.userId !== actor.userId || !validId(member.groupId)) throw denied();
      // Preserve a revoked row if a faulty adapter returns it alongside an
      // active duplicate: the pure evaluator gives revocation precedence.
      if (member.state === "revoked") {
        groupMemberships.push(member);
        continue;
      }
      const group = await tx.getGroup(member.groupId);
      if (!group || group.state !== "active") continue;
      if (group.id !== member.groupId || group.workspaceId !== workspaceId) throw denied();
      groupMemberships.push(member);
    }
  }
  return { workspace, membership, userId: actor.userId, groupMemberships, now };
}

async function authorizeInSnapshot(
  context: PageAuthorizationContext,
  actor: Omit<PolicySnapshot, "pages" | "teamspaces">,
  pageId: string,
  capability: PageCapability,
): Promise<AuthorizedPolicyPage> {
  if (!validId(pageId)) throw denied();
  const pages: PolicyPage[] = [];
  const visited = new Set<string>();
  let cursor: string | null = pageId;
  let teamspaceId: string | null | undefined;
  while (cursor !== null) {
    if (!validId(cursor) || visited.has(cursor)) throw denied();
    // The caller has not yet proved access. Revealing a distinct limit error
    // would disclose the existence/shape of an otherwise hidden page.
    if (pages.length >= PAGE_AUTHORIZATION_LIMITS.ancestors) throw denied();
    visited.add(cursor);
    const page = await context.pages.getPolicyPage(cursor);
    if (!page || page.id !== cursor || page.workspaceId !== context.workspaceId) throw denied();
    if (teamspaceId !== undefined && page.teamspaceId !== teamspaceId) throw denied();
    teamspaceId = page.teamspaceId;
    pages.push(page);
    cursor = page.parentId;
  }
  const page = pages[0];
  if (!page) throw denied();
  const snapshot: PolicySnapshot = { ...actor, pages, teamspaces: [] };
  if (teamspaceId !== null && teamspaceId !== undefined) {
    if (!validId(teamspaceId)) throw denied();
    const teamspace = await context.transaction.getTeamspace(teamspaceId);
    if (!teamspace || teamspace.id !== teamspaceId || teamspace.workspaceId !== context.workspaceId || teamspace.state !== "active") throw denied();
    snapshot.teamspaces = [teamspace];
  }
  // The evaluator owns grant inheritance, denial, expiry, role and teamspace
  // admission semantics. Storage resolution must not reimplement those rules.
  const access = evaluatePageAccess(snapshot, pageId);
  if (!access.allowed || !canPage(snapshot, pageId, capability)) throw denied();
  return { page, grant: access.grant };
}

/**
 * Call inside the same outer transaction as the eventual content read/write.
 * actor, clock and capability are handler-owned, not parsed from client input.
 * No request snapshot or cross-request cache is accepted or retained here.
 */
export async function authorizeCollaborationPage(
  input: PageAuthorizationContext & { pageId: string; capability: PageCapability },
): Promise<AuthorizedPolicyPage> {
  return authorizeInSnapshot(input, await actorSnapshot(input), input.pageId, input.capability);
}

/**
 * Filter a bounded candidate window before pagination/counts/title rendering.
 * Returns only authorized metadata, with no rejected IDs, reasons or hidden total.
 * Fetch candidate windows without leaking hidden page content to the transport.
 * Continue authorized pagination in the adapter; do not present a truncated
 * candidate window as the complete readable workspace.
 */
export async function filterAuthorizedCollaborationPages(
  input: PageAuthorizationContext & { pageIds: readonly string[]; capability: PageCapability },
): Promise<AuthorizedPolicyPage[]> {
  if (input.pageIds.length > PAGE_AUTHORIZATION_LIMITS.discoveryCandidates) throw new MaxError("LIMIT", "Too many page candidates were requested.");
  const snapshot = await actorSnapshot(input);
  const result: AuthorizedPolicyPage[] = [];
  for (const pageId of new Set(input.pageIds)) {
    try {
      result.push(await authorizeInSnapshot(input, snapshot, pageId, input.capability));
    } catch (error) {
      if (!(error instanceof MaxError) || error.code !== "NOT_FOUND") throw error;
    }
  }
  return result;
}
