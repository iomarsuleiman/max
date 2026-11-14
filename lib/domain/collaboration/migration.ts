import { z } from "zod";
import type { WorkspaceMembership } from "./policy";

/** Rehearsal format only. These records are not accepted by the live adapters. */
const row = z.object({ _id: z.string().min(1), ownerId: z.string().min(1) }).passthrough();
const tableNames = ["pages", "documents", "settings", "assets", "tokens", "audit", "idempotency", "versions", "comments"] as const;
const snapshotSchema = z.record(z.enum(tableNames), z.array(row));
type Snapshot = z.infer<typeof snapshotSchema>;
const contentTables = new Set<string>(["pages", "documents", "assets", "versions", "comments"]);

export interface PersonalWorkspaceMapping {
  ownerId: string;
  workspaceId: string;
  membershipId: string;
}

export interface WorkspaceMigrationPlan {
  format: "max-personal-workspace-rehearsal";
  version: 1;
  /** Exact original bytes, including table ordering and whitespace. Private. */
  original: string;
  expanded: string;
  originalSha256: string;
  expandedSha256: string;
  mappings: PersonalWorkspaceMapping[];
  counts: Record<string, number>;
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseSnapshot(serialized: string): Snapshot {
  // Missing tables are distinct from empty tables. MemoryDb snapshots include all nine.
  const snapshot = snapshotSchema.parse(JSON.parse(serialized));
  for (const [table, rows] of Object.entries(snapshot)) {
    const ids = new Set<string>();
    for (const value of rows) {
      if (ids.has(value._id)) throw new Error(`Duplicate row ID in ${table}.`);
      ids.add(value._id);
      if ("workspaceId" in value) throw new Error("Expected an unmigrated v1 snapshot.");
    }
  }
  const pages = new Map(snapshot.pages.map((page) => [page._id, page]));
  function sameOwner(pageId: unknown, ownerId: string, required: boolean) {
    if (pageId === null && !required) return;
    if (typeof pageId !== "string") throw new Error("Invalid page reference in source snapshot.");
    const target = pages.get(pageId);
    if (!target || target.ownerId !== ownerId) throw new Error("Missing or cross-owner page reference in source snapshot.");
  }
  for (const page of snapshot.pages) {
    sameOwner(page.parentId, page.ownerId, false);
    sameOwner(page.databaseId, page.ownerId, false);
    if (page.parentId !== null && page.databaseId !== null) throw new Error("Page has two parents.");
    if (typeof page.databaseId === "string" && pages.get(page.databaseId)?.kind !== "database") throw new Error("Record parent is not a database.");
    const seen = new Set<string>([page._id]);
    let parentId = page.parentId ?? page.databaseId;
    while (typeof parentId === "string") {
      if (seen.has(parentId)) throw new Error("Page hierarchy contains a cycle.");
      seen.add(parentId);
      const parent = pages.get(parentId);
      parentId = parent?.parentId ?? parent?.databaseId;
    }
  }
  for (const table of ["documents", "comments", "versions", "assets"] as const) {
    for (const value of snapshot[table]) sameOwner(value.pageId, value.ownerId, table !== "assets");
  }
  const documentPages = new Set<string>();
  for (const document of snapshot.documents) {
    if (typeof document.pageId !== "string" || documentPages.has(document.pageId)) throw new Error("Duplicate document for a page.");
    documentPages.add(document.pageId);
    if (!Number.isSafeInteger(document.revision) || Number(document.revision) < 0 || typeof document.content !== "string")
      throw new Error("Invalid document revision or content.");
    if (!Array.isArray(JSON.parse(document.content))) throw new Error("Document content must be a BlockNote array.");
  }
  return snapshot;
}

/** Builds an additive copy. Does not mutate Db, files, credentials or the source. */
export async function planPersonalWorkspaceMigration(original: string): Promise<WorkspaceMigrationPlan> {
  const snapshot = parseSnapshot(original);
  const owners = [...new Set(Object.values(snapshot).flatMap((rows) => rows.map((value) => value.ownerId)))].sort();
  const mappings: PersonalWorkspaceMapping[] = [];
  for (const ownerId of owners) {
    const suffix = (await sha256(`max-personal-workspace-v1\u0000${ownerId}`)).slice(0, 48);
    mappings.push({ ownerId, workspaceId: `personal_${suffix}`, membershipId: `owner_${suffix}` });
  }
  const byOwner = new Map(mappings.map((mapping) => [mapping.ownerId, mapping.workspaceId]));
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const [table, rows] of Object.entries(snapshot)) {
    counts[table] = rows.length;
    tables[table] = rows.map((value) => (contentTables.has(table) ? { ...value, workspaceId: byOwner.get(value.ownerId) } : { ...value }));
  }
  const expanded = JSON.stringify({
    format: "max-workspace-rehearsal",
    version: 1,
    tables,
    workspaces: mappings.map(({ ownerId, workspaceId }) => ({ _id: workspaceId, kind: "personal", ownerId, state: "active" })),
    memberships: mappings.map(
      ({ ownerId, workspaceId, membershipId }) =>
        ({
          _id: membershipId,
          userId: ownerId,
          workspaceId,
          role: "owner",
          state: "active",
        }) satisfies WorkspaceMembership & { _id: string },
    ),
  });
  return {
    format: "max-personal-workspace-rehearsal",
    version: 1,
    original,
    expanded,
    originalSha256: await sha256(original),
    expandedSha256: await sha256(expanded),
    mappings,
    counts,
  };
}

/** Recompute the whole artifact, rather than trusting caller-supplied hashes. */
export async function verifyWorkspaceMigrationPlan(input: unknown): Promise<WorkspaceMigrationPlan> {
  const header = z.object({ format: z.literal("max-personal-workspace-rehearsal"), version: z.literal(1), original: z.string() }).parse(input);
  const expected = await planPersonalWorkspaceMigration(header.original);
  const schema = z
    .object({
      format: z.literal("max-personal-workspace-rehearsal"),
      version: z.literal(1),
      original: z.string(),
      expanded: z.string(),
      originalSha256: z.string(),
      expandedSha256: z.string(),
      mappings: z.array(z.object({ ownerId: z.string(), workspaceId: z.string(), membershipId: z.string() }).strict()),
      counts: z.record(z.string(), z.number().int().nonnegative()),
    })
    .strict();
  const actual = schema.parse(input);
  if (
    actual.expanded !== expected.expanded ||
    actual.originalSha256 !== expected.originalSha256 ||
    actual.expandedSha256 !== expected.expandedSha256 ||
    JSON.stringify(actual.mappings) !== JSON.stringify(expected.mappings) ||
    tableNames.some((table) => actual.counts[table] !== expected.counts[table]) ||
    Object.keys(actual.counts).length !== tableNames.length
  ) {
    throw new Error("Migration artifact does not match its source.");
  }
  return expected;
}

/** Refuses stale input. Repeating the same application returns the same bytes. */
export async function applyWorkspaceMigration(current: string, artifact: unknown): Promise<string> {
  const plan = await verifyWorkspaceMigrationPlan(artifact);
  if (current !== plan.original && current !== plan.expanded) throw new Error("Snapshot changed after rehearsal. Rehearse again from a fresh backup.");
  return plan.expanded;
}

/** Rollback is intentionally refused after edits; it must never discard new work. */
export async function rollbackWorkspaceMigration(current: string, artifact: unknown): Promise<string> {
  const plan = await verifyWorkspaceMigrationPlan(artifact);
  if (current !== plan.expanded && current !== plan.original) throw new Error("Snapshot changed after migration. Reconcile new work before rollback.");
  return plan.original;
}
