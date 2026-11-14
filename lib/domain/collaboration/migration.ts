import { z } from "zod";
import type { WorkspaceMembership } from "./policy";

/** Rehearsal format only. These records are not accepted by the live adapters. */
const row = z.object({ _id: z.string().min(1), ownerId: z.string().min(1) }).passthrough();
const tableNames = ["pages", "documents", "settings", "assets", "tokens", "audit", "idempotency", "versions", "comments"] as const;
const snapshotSchema = z.record(z.enum(tableNames), z.array(row));
const v2TableNames = [...tableNames, "uploadReceipts"] as const;
const v2SnapshotSchema = z.record(z.enum(v2TableNames), z.array(row));
type Snapshot = z.infer<typeof snapshotSchema> & { uploadReceipts?: z.infer<typeof row>[] };
const identifier = z
  .string()
  .min(1)
  .max(300)
  .refine((value) => value.trim() === value && !/[\u0000-\u001f]/.test(value));
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const receiptIdentity = { _id: identifier, id: identifier, ownerId: identifier, capabilityHash: hash, createdAt: timestamp, expiresAt: timestamp };
const blob = z
  .object({
    storageId: z.string().regex(/^[a-z0-9]{8,40}$/),
    size: z
      .number()
      .int()
      .min(1)
      .max(50 * 1024 * 1024),
    type: z
      .string()
      .max(100)
      .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/),
    sha256: hash,
  })
  .strict();
const receiptSchema = z.discriminatedUnion("state", [
  z.object({ ...receiptIdentity, state: z.literal("issued") }).strict(),
  z.object({ ...receiptIdentity, state: z.literal("receiving"), attemptId: identifier, leaseUntil: timestamp }).strict(),
  z.object({ ...receiptIdentity, state: z.literal("stored"), blob, receivedByAttemptId: identifier, storedAt: timestamp, registerUntil: timestamp }).strict(),
  z
    .object({
      ...receiptIdentity,
      state: z.literal("registered"),
      blob,
      receivedByAttemptId: identifier,
      assetId: identifier,
      registrationKey: identifier,
      registeredAt: timestamp,
    })
    .strict(),
  z.object({ ...receiptIdentity, state: z.literal("cleaning"), blob, cleanupId: identifier, leaseUntil: timestamp }).strict(),
  z.object({ ...receiptIdentity, state: z.literal("cleaned"), blob, cleanedAt: timestamp }).strict(),
]);
const contentTables = new Set<string>(["pages", "documents", "assets", "versions", "comments"]);

export interface PersonalWorkspaceMapping {
  ownerId: string;
  workspaceId: string;
  membershipId: string;
}

export interface WorkspaceMigrationPlan {
  format: "max-personal-workspace-rehearsal";
  version: 1 | 2;
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
  // Presence of the tenth table selects v2; v1 never silently accepts it.
  const source: unknown = JSON.parse(serialized);
  const snapshot: Snapshot =
    typeof source === "object" && source !== null && Object.hasOwn(source, "uploadReceipts") ? v2SnapshotSchema.parse(source) : snapshotSchema.parse(source);
  for (const [table, rows] of Object.entries(snapshot)) {
    const ids = new Set<string>();
    for (const value of rows) {
      if (ids.has(value._id)) throw new Error(`Duplicate row ID in ${table}.`);
      ids.add(value._id);
      if ("workspaceId" in value) throw new Error("Expected an unmigrated snapshot.");
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
  const receiptIds = new Set<string>();
  const receiptHashes = new Set<string>();
  const storageIds = new Set<string>();
  for (const raw of snapshot.uploadReceipts ?? []) {
    const receipt = receiptSchema.parse(raw);
    if (receipt.expiresAt < receipt.createdAt || receiptIds.has(receipt.id) || receiptHashes.has(receipt.capabilityHash))
      throw new Error("Invalid or duplicate upload receipt identity.");
    receiptIds.add(receipt.id);
    receiptHashes.add(receipt.capabilityHash);
    if ("blob" in receipt) {
      if (storageIds.has(receipt.blob.storageId)) throw new Error("Duplicate upload receipt storage ID.");
      storageIds.add(receipt.blob.storageId);
    }
    if (receipt.state === "registered") {
      const asset = snapshot.assets.find((value) => value._id === receipt.assetId);
      if (
        !asset ||
        asset.ownerId !== receipt.ownerId ||
        asset.storageId !== receipt.blob.storageId ||
        asset.size !== receipt.blob.size ||
        asset.type !== receipt.blob.type
      )
        throw new Error("Registered upload receipt does not match its attachment.");
    }
  }
  return snapshot;
}

/** Builds an additive copy. Does not mutate Db, files, credentials or the source. */
export async function planPersonalWorkspaceMigration(original: string): Promise<WorkspaceMigrationPlan> {
  const snapshot = parseSnapshot(original);
  const version = snapshot.uploadReceipts === undefined ? 1 : 2;
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
    version,
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
    version,
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
  const header = z
    .object({ format: z.literal("max-personal-workspace-rehearsal"), version: z.union([z.literal(1), z.literal(2)]), original: z.string() })
    .parse(input);
  const expected = await planPersonalWorkspaceMigration(header.original);
  const schema = z
    .object({
      format: z.literal("max-personal-workspace-rehearsal"),
      version: z.union([z.literal(1), z.literal(2)]),
      original: z.string(),
      expanded: z.string(),
      originalSha256: z.string(),
      expandedSha256: z.string(),
      mappings: z.array(z.object({ ownerId: z.string(), workspaceId: z.string(), membershipId: z.string() }).strict()),
      counts: z.record(z.string(), z.number().int().nonnegative()),
    })
    .strict();
  const actual = schema.parse(input);
  const expectedTables = expected.version === 1 ? tableNames : v2TableNames;
  if (
    actual.version !== expected.version ||
    actual.expanded !== expected.expanded ||
    actual.originalSha256 !== expected.originalSha256 ||
    actual.expandedSha256 !== expected.expandedSha256 ||
    JSON.stringify(actual.mappings) !== JSON.stringify(expected.mappings) ||
    expectedTables.some((table) => actual.counts[table] !== expected.counts[table]) ||
    Object.keys(actual.counts).length !== expectedTables.length
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
