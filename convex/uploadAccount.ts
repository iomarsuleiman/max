import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { Storage } from "../lib/domain/db";
import { MaxError } from "../lib/domain/errors";
import { convexUploadStore } from "./uploadStore";
import { convexCollaborationStore } from "./collaborationStore";

export const ACCOUNT_UPLOAD_LIMIT = 1000;

/** Bounded, current ownership validation before any account-wide deletion. */
async function ownedReceipts(db: DatabaseReader, ownerId: string) {
  if (!ownerId) throw new MaxError("INTERNAL", "Upload account scope is unavailable.");
  const rows = await db
    .query("uploadReceipts")
    .withIndex("by_ownerId", (q) => q.eq("ownerId", ownerId))
    .take(ACCOUNT_UPLOAD_LIMIT + 1);
  if (rows.length > ACCOUNT_UPLOAD_LIMIT)
    throw new MaxError("LIMIT", "This account has too many upload receipts for one deletion. Preserve a backup and use bounded account cleanup.");
  const store = convexUploadStore(db);
  const personal = await convexCollaborationStore(db).transaction((tx) => tx.getPersonalWorkspace(ownerId));
  const personalId = personal?.kind === "personal" && personal.ownerId === ownerId && personal.state === "active" ? personal.id : undefined;
  async function personalPage(pageId: string): Promise<boolean> {
    let cursor: string | null = pageId;
    const visited = new Set<string>();
    while (cursor !== null) {
      if (visited.has(cursor) || visited.size >= 100) return false;
      visited.add(cursor);
      const id: Id<"pages"> | null = db.normalizeId("pages", cursor);
      const page: Doc<"pages"> | null = id ? await db.get(id) : null;
      if (
        !page ||
        page.ownerId !== ownerId ||
        (page.workspaceId !== undefined && page.workspaceId !== personalId) ||
        (page.teamspaceId !== undefined && page.teamspaceId !== null) ||
        (page.parentId !== null && page.databaseId !== null)
      )
        return false;
      cursor = page.parentId ?? page.databaseId;
    }
    return true;
  }
  for (const row of rows) {
    // Each read validates unique logical/capability/blob indexes, including
    // contradictory duplicates owned by another account outside this range.
    const receipt = await store.transaction((tx) => tx.get(row.logicalId));
    if (!receipt || receipt.ownerId !== ownerId) throw new MaxError("CONFLICT", "Upload ownership could not be established.");
    if (!("blob" in receipt)) continue;
    const id = db.system.normalizeId("_storage", receipt.blob.storageId);
    if (!id) throw new MaxError("CONFLICT", "Upload storage scope is invalid.");
    const metadata = await db.system.get(id);
    const references = await db
      .query("assets")
      .withIndex("by_storageId", (q) => q.eq("storageId", receipt.blob.storageId))
      .take(ACCOUNT_UPLOAD_LIMIT + 1);
    if (references.length > ACCOUNT_UPLOAD_LIMIT) throw new MaxError("LIMIT", "Upload references exceed the supported deletion limit.");
    for (const asset of references) {
      if (asset.ownerId !== ownerId || (asset.pageId !== null && !(await personalPage(asset.pageId))))
        throw new MaxError("CONFLICT", "Upload bytes have shared or unresolved attachment references.");
    }
    // Registered assets may already have removed these bytes in the same outer
    // account deletion. Missing storage is safe to remove idempotently.
    if (metadata) {
      const sha256 = Array.from(atob(metadata.sha256), (b) => b.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      if (
        metadata.size !== receipt.blob.size ||
        (metadata.contentType ?? "application/octet-stream") !== receipt.blob.type ||
        sha256 !== receipt.blob.sha256 ||
        receipt.state === "cleaned"
      )
        throw new MaxError("CONFLICT", "Upload bytes do not match their ownership receipt.");
    }
    if (receipt.state === "registered") {
      const assetId = db.normalizeId("assets", receipt.assetId);
      if (!assetId) throw new MaxError("CONFLICT", "Registered attachment scope is invalid.");
      const asset = await db.get(assetId);
      if (asset && (asset.ownerId !== ownerId || asset.storageId !== receipt.blob.storageId))
        throw new MaxError("CONFLICT", "Registered attachment ownership is inconsistent.");
    }
  }
  return rows;
}

export async function preflightUploadDeletion(nativeDb: DatabaseReader, ownerId: string): Promise<void> {
  await ownedReceipts(nativeDb, ownerId);
}

/** Same outer native mutation as account removal. No partial-error catches. */
export async function deleteOwnerUploads(nativeDb: DatabaseWriter, storage: Storage, ownerId: string): Promise<void> {
  const rows = await ownedReceipts(nativeDb, ownerId);
  for (const row of rows) {
    if ("blob" in row && row.state !== "cleaned") {
      const storageId = nativeDb.system.normalizeId("_storage", row.blob.storageId);
      if (!storageId) throw new MaxError("CONFLICT", "Upload storage scope is invalid.");
      if (await nativeDb.system.get(storageId)) await storage.remove(row.blob.storageId);
    }
    // Removing issued/receiving rows invalidates every outstanding capability.
    await nativeDb.delete(row._id);
  }
}
