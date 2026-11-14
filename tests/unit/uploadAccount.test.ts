import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { convexStorage } from "@/convex/convexDb";
import { convexUploadStore } from "@/convex/uploadStore";
import { ACCOUNT_UPLOAD_LIMIT, deleteOwnerUploads, preflightUploadDeletion } from "@/convex/uploadAccount";
import { UploadService, type UploadRuntime } from "@/lib/domain/uploads";
import { newPageRow } from "@/lib/domain/ops/helpers";
import { convexDb } from "@/convex/convexDb";

function setup() {
  const t = convexTest(schema, { "../../convex/_generated/server.ts": async () => ({}) });
  let sequence = 0;
  const runtime: UploadRuntime = {
    now: () => 1000,
    newId: () => `test-upload-${++sequence}`,
    createCapability: () => `max-upload-v1.${(++sequence).toString(16).padStart(64, "0")}`,
    hashCapability: async (capability) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability))), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
  };
  async function seedBlob(ownerId: string, registered = false) {
    return t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["synthetic upload"], { type: "text/plain" }));
      const metadata = await ctx.db.system.get(storageId);
      if (!metadata) throw new Error("Missing native storage metadata");
      const sha256 = Array.from(atob(metadata.sha256), (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join("");
      const assetId = await ctx.db.insert("assets", {
        ownerId,
        pageId: null,
        storageId,
        name: "a.txt",
        type: "text/plain",
        size: metadata.size,
        alt: "",
        createdAt: 1000,
      });
      const identity = { id: runtime.newId(), ownerId, capabilityHash: (++sequence).toString(16).padStart(64, "0"), createdAt: 1000, expiresAt: 2000 };
      const blob = { storageId, type: "text/plain", size: metadata.size, sha256 };
      await convexUploadStore(ctx.db).transaction((tx) =>
        tx.insert(
          registered
            ? { ...identity, state: "registered", blob, receivedByAttemptId: "attempt", assetId, registrationKey: "registration", registeredAt: 1000 }
            : { ...identity, state: "stored", blob, receivedByAttemptId: "attempt", storedAt: 1000, registerUntil: 10000 },
        ),
      );
      if (!registered) await ctx.db.delete(assetId);
      return { storageId, assetId, identity, blob };
    });
  }
  return { t, runtime, seedBlob };
}

describe("bounded native account upload cleanup", () => {
  it("revokes outstanding issued and receiving capabilities while preserving another owner", async () => {
    const f = setup();
    const issued = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).issue("alice"));
    const receiving = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).issue("alice"));
    await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).begin(receiving.capability));
    const other = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).issue("bob"));
    await f.t.run((ctx) => deleteOwnerUploads(ctx.db, convexStorage(ctx.storage), "alice"));
    for (const { capability } of [issued, receiving])
      await expect(f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).begin(capability))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).begin(other.capability))).toMatchObject({ state: "receiving" });
  });

  it("removes pending and registered owned receipts and bytes idempotently after asset deletion", async () => {
    const f = setup();
    const pending = await f.seedBlob("alice");
    const registered = await f.seedBlob("alice", true);
    const other = await f.seedBlob("bob");
    await f.t.run(async (ctx) => {
      await preflightUploadDeletion(ctx.db, "alice");
      // The account operation removes registered assets and bytes before its
      // final receipt cleanup hook, so cleanup must accept absent native bytes.
      await ctx.storage.delete(registered.storageId);
      await ctx.db.delete(registered.assetId);
      await deleteOwnerUploads(ctx.db, convexStorage(ctx.storage), "alice");
      await deleteOwnerUploads(ctx.db, convexStorage(ctx.storage), "alice");
      expect(await ctx.storage.getUrl(pending.storageId)).toBeNull();
      expect(await ctx.storage.getUrl(registered.storageId)).toBeNull();
      expect(await ctx.storage.getUrl(other.storageId)).not.toBeNull();
      expect(
        await ctx.db
          .query("uploadReceipts")
          .withIndex("by_ownerId", (q) => q.eq("ownerId", "alice"))
          .take(1),
      ).toEqual([]);
      expect(await convexUploadStore(ctx.db).transaction((tx) => tx.get(other.identity.id))).toMatchObject({ ownerId: "bob", state: "stored" });
    });
  });

  it("refuses limit+1 owner receipts before any row or storage removal", async () => {
    const f = setup();
    await f.t.run(async (ctx) => {
      for (let index = 0; index <= ACCOUNT_UPLOAD_LIMIT; index++)
        await ctx.db.insert("uploadReceipts", {
          logicalId: `receipt-${index}`,
          ownerId: "alice",
          capabilityHash: index.toString(16).padStart(64, "0"),
          createdAt: 1,
          expiresAt: 2,
          state: "issued",
        });
      let removals = 0;
      const storage = {
        createUploadUrl: async () => "unused",
        getUrl: async () => null,
        remove: async () => {
          removals++;
        },
      };
      await expect(preflightUploadDeletion(ctx.db, "alice")).rejects.toMatchObject({ code: "LIMIT" });
      await expect(deleteOwnerUploads(ctx.db, storage, "alice")).rejects.toMatchObject({ code: "LIMIT" });
      expect(removals).toBe(0);
      expect(await ctx.db.query("uploadReceipts").take(ACCOUNT_UPLOAD_LIMIT + 1)).toHaveLength(ACCOUNT_UPLOAD_LIMIT + 1);
    });
  });

  it.each(["foreign reference", "shared reference", "unresolved reference", "duplicate receipt", "metadata mismatch"])(
    "fails closed before deletion for %s",
    async (problem) => {
      const f = setup();
      const owned = await f.seedBlob("alice");
      await f.t.run(async (ctx) => {
        if (problem === "duplicate receipt") {
          await ctx.db.insert("uploadReceipts", {
            logicalId: "foreign-receipt",
            ownerId: "bob",
            capabilityHash: "e".repeat(64),
            createdAt: 1,
            expiresAt: 2,
            state: "stored",
            blob: owned.blob,
            receivedByAttemptId: "foreign-attempt",
            storedAt: 1,
            registerUntil: 2,
          });
        } else if (problem === "metadata mismatch") {
          const row = await ctx.db
            .query("uploadReceipts")
            .withIndex("by_logicalId", (q) => q.eq("logicalId", owned.identity.id))
            .unique();
          if (!row || !("blob" in row)) throw new Error("Missing receipt");
          await ctx.db.patch(row._id, { blob: { ...row.blob, size: row.blob.size + 1 } });
        } else {
          const ownerId = problem === "foreign reference" ? "bob" : "alice";
          let pageId: string | null = null;
          if (problem !== "foreign reference") {
            const page = await ctx.db.insert(
              "pages",
              newPageRow(
                { db: convexDb(ctx.db), storage: null, ownerId, source: "ui", now: 1 },
                { rank: "a", ...(problem === "shared reference" ? { workspaceId: "organization" } : {}) },
              ),
            );
            pageId = page;
            if (problem === "unresolved reference") await ctx.db.delete(page);
          }
          await ctx.db.insert("assets", {
            ownerId,
            pageId,
            storageId: owned.storageId,
            name: "ref.txt",
            type: "text/plain",
            size: owned.blob.size,
            alt: "",
            createdAt: 1,
          });
        }
        let removals = 0;
        const storage = {
          createUploadUrl: async () => "unused",
          getUrl: async () => null,
          remove: async () => {
            removals++;
          },
        };
        await expect(preflightUploadDeletion(ctx.db, "alice")).rejects.toMatchObject({ code: problem === "duplicate receipt" ? "INTERNAL" : "CONFLICT" });
        await expect(deleteOwnerUploads(ctx.db, storage, "alice")).rejects.toBeDefined();
        expect(removals).toBe(0);
        expect(await ctx.storage.getUrl(owned.storageId)).not.toBeNull();
        expect(
          await ctx.db
            .query("uploadReceipts")
            .withIndex("by_ownerId", (q) => q.eq("ownerId", "alice"))
            .take(2),
        ).toHaveLength(1);
      });
    },
  );
});
