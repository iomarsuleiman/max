import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { AccessGrant, GrantPrincipal } from "../lib/domain/collaboration/policy";
import { COLLABORATION_LIMITS } from "../lib/domain/collaboration/collaborationStore";
import { MaxError } from "../lib/domain/errors";

const inconsistent = () => new MaxError("INTERNAL", "Page access metadata is inconsistent. No content was returned.");
const validId = (value: string) => !!value && value.length <= 300 && value.trim() === value && !/[\u0000-\u001f]/.test(value);
export function principalKey(principal: GrantPrincipal): string {
  switch (principal.kind) {
    case "user":
      if (!validId(principal.userId)) throw inconsistent();
      return `user:${principal.userId}`;
    case "group":
      if (!validId(principal.groupId)) throw inconsistent();
      return `group:${principal.groupId}`;
    case "workspace_members":
      return "workspace_members";
  }
}

/** Canonical grants are the permission source and the reverse lookup, never a cache. */
export async function readPageGrantSet(db: DatabaseReader, pageId: Id<"pages">, workspaceId: string) {
  const headers = await db
    .query("collabPageAccess")
    .withIndex("by_pageId", (q) => q.eq("pageId", pageId))
    .take(2);
  if (headers.length > 1) throw inconsistent();
  const header = headers[0] ?? null;
  // Reading the whole bounded page prefix detects stale revisions as well as
  // current rows. A stale reverse entry must never silently govern membership.
  const rows = await db
    .query("collabPageGrants")
    .withIndex("by_pageId_aclRevision", (q) => q.eq("pageId", pageId))
    .take(COLLABORATION_LIMITS.grantsPerPage + 1);
  if (rows.length > COLLABORATION_LIMITS.grantsPerPage || (header && header.grantCount > COLLABORATION_LIMITS.grantsPerPage))
    throw new MaxError("LIMIT", "This page exceeds the supported access-grant limit.");
  if (!header) {
    if (rows.length) throw inconsistent();
    return { header, rows };
  }
  if (
    header.workspaceId !== workspaceId ||
    !Number.isSafeInteger(header.aclRevision) ||
    header.aclRevision < 1 ||
    !Number.isSafeInteger(header.grantCount) ||
    header.grantCount < 0 ||
    header.grantCount !== rows.length
  )
    throw inconsistent();
  const ids = new Set<string>();
  for (const row of rows) {
    if (
      !validId(row.logicalId) ||
      ids.has(row.logicalId) ||
      row.workspaceId !== workspaceId ||
      row.aclRevision !== header.aclRevision ||
      row.principalKey !== principalKey(row.value.principal) ||
      (row.value.effect === "allow" && row.value.expiresAt !== null && !Number.isFinite(row.value.expiresAt))
    )
      throw inconsistent();
    ids.add(row.logicalId);
    const unique = await db
      .query("collabPageGrants")
      .withIndex("by_logicalId", (q) => q.eq("logicalId", row.logicalId))
      .take(2);
    if (unique.length !== 1 || unique[0]._id !== row._id) throw inconsistent();
  }
  return { header, rows };
}

export async function listPrincipalGrantPageIds(
  db: DatabaseReader,
  workspaceId: string,
  principal: GrantPrincipal,
  effect?: "allow" | "deny",
): Promise<readonly string[]> {
  const key = principalKey(principal);
  const query =
    effect === undefined
      ? db.query("collabPageGrants").withIndex("by_workspaceId_principalKey_effect_pageId", (q) => q.eq("workspaceId", workspaceId).eq("principalKey", key))
      : db
          .query("collabPageGrants")
          .withIndex("by_workspaceId_principalKey_effect_pageId", (q) => q.eq("workspaceId", workspaceId).eq("principalKey", key).eq("value.effect", effect));
  const rows = await query.take(COLLABORATION_LIMITS.grantAnchorsPerPrincipal + 1);
  if (rows.length > COLLABORATION_LIMITS.grantAnchorsPerPrincipal) throw new MaxError("LIMIT", "This principal exceeds the supported grant-anchor limit.");
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.workspaceId !== workspaceId || principalKey(row.value.principal) !== key || row.principalKey !== key || (effect && row.value.effect !== effect))
      throw inconsistent();
    const page = await db.get(row.pageId);
    if (!page || (page.workspaceId !== undefined && page.workspaceId !== workspaceId)) throw inconsistent();
    if (page.workspaceId === undefined) {
      const personal = await db
        .query("collabWorkspaces")
        .withIndex("by_kind_ownerId", (q) => q.eq("kind", "personal").eq("ownerId", page.ownerId))
        .take(2);
      if (personal.length !== 1 || personal[0].logicalId !== workspaceId || personal[0].state !== "active") throw inconsistent();
    }
    const set = await readPageGrantSet(db, row.pageId, workspaceId);
    if (!set.header || !set.rows.some((value) => value._id === row._id)) throw inconsistent();
    ids.add(row.pageId);
  }
  return [...ids];
}

/** Storage only. Caller must authorize page.share in this SAME outer mutation. */
export async function replaceStoredPageAccess(
  db: DatabaseWriter,
  input: {
    pageId: Id<"pages">;
    workspaceId: string;
    mode: "inherit" | "replace";
    grants: readonly AccessGrant[];
    baseRevision: number;
    updatedBy: string;
    now: number;
  },
): Promise<number> {
  const page = await db.get(input.pageId);
  if (!page || !validId(input.workspaceId) || !validId(input.updatedBy) || !Number.isSafeInteger(input.now) || input.now < 0) throw inconsistent();
  const pageWorkspaceId = page.workspaceId;
  const workspaces =
    pageWorkspaceId === undefined
      ? await db
          .query("collabWorkspaces")
          .withIndex("by_kind_ownerId", (q) => q.eq("kind", "personal").eq("ownerId", page.ownerId))
          .take(2)
      : await db
          .query("collabWorkspaces")
          .withIndex("by_logicalId", (q) => q.eq("logicalId", pageWorkspaceId))
          .take(2);
  const workspace = workspaces[0];
  if (
    workspaces.length !== 1 ||
    !workspace ||
    workspace.logicalId !== input.workspaceId ||
    workspace.state !== "active" ||
    (workspace.kind === "personal" && workspace.ownerId !== page.ownerId)
  )
    throw inconsistent();
  const prior = await readPageGrantSet(db, input.pageId, input.workspaceId);
  if (!Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 || (prior.header?.aclRevision ?? 0) !== input.baseRevision)
    throw new MaxError("CONFLICT", "Page permissions changed. Reload them before retrying.");
  if (input.grants.length > COLLABORATION_LIMITS.grantsPerPage) throw new MaxError("LIMIT", "This page exceeds the supported access-grant limit.");
  const revision = input.baseRevision + 1;
  if (!Number.isSafeInteger(revision)) throw inconsistent();
  const prepared = [];
  for (const [index, value] of input.grants.entries()) {
    const key = principalKey(value.principal);
    if (value.effect === "allow" && value.expiresAt !== null && !Number.isFinite(value.expiresAt)) throw inconsistent();
    if (value.principal.kind === "group") {
      const groupId = value.principal.groupId;
      const groups = await db
        .query("collabGroups")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", groupId))
        .take(2);
      if (groups.length !== 1 || groups[0].workspaceId !== input.workspaceId || groups[0].state !== "active") throw inconsistent();
    }
    const logicalId = `${input.pageId}:${revision}:${index}`;
    if (
      (
        await db
          .query("collabPageGrants")
          .withIndex("by_logicalId", (q) => q.eq("logicalId", logicalId))
          .take(1)
      ).length
    )
      throw inconsistent();
    prepared.push({ logicalId, workspaceId: input.workspaceId, pageId: input.pageId, aclRevision: revision, principalKey: key, value });
  }
  for (const row of prior.rows) await db.delete(row._id);
  for (const row of prepared) await db.insert("collabPageGrants", row);
  const header = {
    pageId: input.pageId,
    workspaceId: input.workspaceId,
    mode: input.mode,
    aclRevision: revision,
    grantCount: prepared.length,
    updatedAt: input.now,
    updatedBy: input.updatedBy,
  };
  if (prior.header) await db.replace(prior.header._id, header);
  else await db.insert("collabPageAccess", header);
  return revision;
}
