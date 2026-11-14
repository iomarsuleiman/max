import type { DatabaseReader, DatabaseWriter } from "./_generated/server";
import type { Db, NewRow } from "../lib/domain/db";
import { UploadService, type UploadRuntime } from "../lib/domain/uploads";
import { hashUploadCapability } from "../lib/domain/uploadRuntime";
import { notFound } from "../lib/domain/errors";
import { convexUploadStore } from "./uploadStore";

/** Native mutation runtime. Registration needs a clock, never entropy. */
const runtime: UploadRuntime = {
  now: () => Date.now(),
  newId: () => {
    throw new Error("Registration does not generate upload IDs.");
  },
  createCapability: () => {
    throw new Error("Registration does not generate capabilities.");
  },
  hashCapability: hashUploadCapability,
};

export async function registerPersonalUpload(nativeDb: DatabaseReader | DatabaseWriter, db: Db, ownerId: string, asset: NewRow<"assets">) {
  if (asset.ownerId !== ownerId) throw notFound("upload");
  const registrationKey = await hashUploadCapability(
    JSON.stringify({
      ownerId,
      pageId: asset.pageId,
      storageId: asset.storageId,
      name: asset.name,
      type: asset.type,
      size: asset.size,
      alt: asset.alt,
    }),
  );
  const result = await new UploadService(convexUploadStore(nativeDb), runtime).register(
    ownerId,
    asset,
    registrationKey,
    () => db.insert("assets", asset),
    async (assetId) => {
      const current = await db.get("assets", assetId);
      if (!current || current.ownerId !== ownerId || current.pageId !== asset.pageId || current.storageId !== asset.storageId) throw notFound("upload");
    },
  );
  return result.assetId;
}
