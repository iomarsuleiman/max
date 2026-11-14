import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { cleanupReceipt, UPLOAD_CLEANUP_BATCH } from "@/convex/uploadCleanup";
import { convexUploadStore } from "@/convex/uploadStore";
import { UploadService, UPLOAD_LIMITS, type StoredUpload, type UploadReceipt, type UploadRuntime } from "@/lib/domain/uploads";

const candidates = makeFunctionReference<"query">("uploadCleanup:candidates");
const cleanupOne = makeFunctionReference<"mutation">("uploadCleanup:cleanupOne");
const sweep = makeFunctionReference<"action">("uploadCleanup:sweep");
function setup() {
  const t = convexTest(schema, {
    "../../convex/_generated/server.ts": async () => ({}),
    "../../convex/uploadCleanup.ts": () => import("@/convex/uploadCleanup"),
  });
  let sequence = 0;
  const identity = () => ({
    id: `receipt-${++sequence}`,
    ownerId: "alice",
    capabilityHash: sequence.toString(16).padStart(64, "0"),
    createdAt: Date.now() - 1000,
    expiresAt: Date.now() - 1,
  });
  async function stored(registerUntil = Date.now() - 1) {
    const base = identity();
    const actual = await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["owned bytes"], { type: "text/plain" }));
      const metadata = await ctx.db.system.get(storageId);
      if (!metadata) throw new Error("Missing fixture metadata");
      const blob: StoredUpload = {
        storageId,
        size: metadata.size,
        type: metadata.contentType ?? "application/octet-stream",
        sha256: Array.from(atob(metadata.sha256), (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
      };
      await convexUploadStore(ctx.db).transaction((tx) =>
        tx.insert({ ...base, state: "stored", blob, receivedByAttemptId: "receiver", storedAt: Date.now() - 1000, registerUntil }),
      );
      return { storageId, blob };
    });
    return { ...base, ...actual };
  }
  const read = (id: string) => t.run((ctx) => convexUploadStore(ctx.db).transaction((tx) => tx.get(id)));
  const bytes = (id: string) =>
    t.run(async (ctx) => {
      const storageId = ctx.db.system.normalizeId("_storage", id);
      return storageId ? ((await ctx.storage.get(storageId))?.text() ?? null) : null;
    });
  return { t, identity, stored, read, bytes };
}

describe("bounded native upload receipt sweep", () => {
  it("deletes expired unregistered bytes and purges their receipt atomically", async () => {
    const f = setup();
    const file = await f.stored();
    expect(await f.t.mutation(cleanupOne, { receiptId: file.id, cleanupId: "sweeper" })).toEqual({ receiptRemoved: true, fileRemoved: true });
    expect(await f.read(file.id)).toBeNull();
    expect(await f.bytes(file.storageId)).toBeNull();
    expect(await f.t.mutation(cleanupOne, { receiptId: file.id, cleanupId: "retry" })).toEqual({ receiptRemoved: false, fileRemoved: false });
  });

  it("rolls back physical deletion and receipt finalization when the outer mutation fails", async () => {
    const f = setup();
    const file = await f.stored();
    await expect(
      f.t.run(async (ctx) => {
        await cleanupReceipt(ctx, { receiptId: file.id, cleanupId: "rollback" });
        throw new Error("Later mutation failure");
      }),
    ).rejects.toThrow("Later mutation failure");
    expect((await f.read(file.id))?.state).toBe("stored");
    expect(await f.bytes(file.storageId)).toBe("owned bytes");
  });

  it("recovers an expired cleaning claim whose bytes were already removed, but preserves a missing pending upload", async () => {
    const f = setup();
    const cleaning = await f.stored();
    await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("uploadReceipts")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", cleaning.id))
        .unique();
      if (!row) throw new Error("Fixture missing");
      await ctx.db.replace(row._id, {
        logicalId: cleaning.id,
        ownerId: cleaning.ownerId,
        capabilityHash: cleaning.capabilityHash,
        createdAt: cleaning.createdAt,
        expiresAt: cleaning.expiresAt,
        state: "cleaning",
        blob: cleaning.blob,
        cleanupId: "old-claim",
        leaseUntil: Date.now() - 1,
      });
      await ctx.storage.delete(cleaning.storageId);
    });
    expect(await f.t.mutation(cleanupOne, { receiptId: cleaning.id, cleanupId: "recovered" })).toEqual({ receiptRemoved: true, fileRemoved: false });
    const pending = await f.stored();
    await f.t.run((ctx) => ctx.storage.delete(pending.storageId));
    await expect(f.t.mutation(cleanupOne, { receiptId: pending.id, cleanupId: "missing" })).rejects.toThrow();
    expect((await f.read(pending.id))?.state).toBe("stored");
  });

  it("purges expired capabilities only and gives receiving attempts a full pending-retention grace period", async () => {
    const f = setup();
    const issued = f.identity(),
      receiving = f.identity(),
      recent = f.identity(),
      active = f.identity();
    const now = Date.now();
    await f.t.run(async (ctx) =>
      convexUploadStore(ctx.db).transaction(async (tx) => {
        await tx.insert({ ...issued, state: "issued" });
        await tx.insert({
          ...receiving,
          state: "receiving",
          expiresAt: now - UPLOAD_LIMITS.pendingMs - 1,
          attemptId: "old",
          leaseUntil: now - UPLOAD_LIMITS.pendingMs - 1,
        });
        await tx.insert({ ...recent, state: "receiving", attemptId: "recent", leaseUntil: now - 1 });
        await tx.insert({ ...active, state: "issued", expiresAt: now + 60_000 });
      }),
    );
    expect(await f.t.query(candidates, { now })).toEqual([issued.id, receiving.id].sort());
    for (const row of [issued, receiving])
      expect(await f.t.mutation(cleanupOne, { receiptId: row.id, cleanupId: "metadata" })).toEqual({ receiptRemoved: true, fileRemoved: false });
    for (const row of [recent, active])
      expect(await f.t.mutation(cleanupOne, { receiptId: row.id, cleanupId: "active" })).toEqual({ receiptRemoved: false, fileRemoved: false });
  });

  it("rechecks stale discovery after registration wins and never deletes registered bytes", async () => {
    const f = setup();
    const file = await f.stored(Date.now() + 60_000);
    expect(await f.t.query(candidates, { now: Date.now() + 120_000 })).toContain(file.id);
    const runtime: UploadRuntime = { now: () => Date.now(), newId: () => "unused", createCapability: () => "unused", hashCapability: async () => "unused" };
    await f.t.run(async (ctx) =>
      new UploadService(convexUploadStore(ctx.db), runtime).register(
        "alice",
        file.blob,
        "registration",
        async () =>
          ctx.db.insert("assets", {
            ownerId: "alice",
            pageId: null,
            storageId: file.storageId,
            type: "text/plain",
            size: file.blob.size,
            name: "owned.txt",
            alt: "",
            createdAt: Date.now(),
          }),
        async () => undefined,
      ),
    );
    expect(await f.t.mutation(cleanupOne, { receiptId: file.id, cleanupId: "stale" })).toEqual({ receiptRemoved: false, fileRemoved: false });
    expect((await f.read(file.id))?.state).toBe("registered");
    expect(await f.bytes(file.storageId)).toBe("owned bytes");
  });

  it("preserves referenced and mismatched bytes, while independent candidates still finish", async () => {
    const f = setup();
    const referenced = await f.stored(),
      mismatch = await f.stored(),
      valid = await f.stored();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("assets", {
        ownerId: "bob",
        pageId: null,
        storageId: referenced.storageId,
        type: "text/plain",
        size: referenced.blob.size,
        name: "foreign.txt",
        alt: "",
        createdAt: Date.now(),
      });
      const row = await ctx.db
        .query("uploadReceipts")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", mismatch.id))
        .unique();
      if (!row) throw new Error("Fixture missing");
      await ctx.db.patch(row._id, { blob: { ...mismatch.blob, size: mismatch.blob.size + 1 } });
    });
    expect(await f.t.action(sweep, {})).toEqual({ candidates: 3, receiptsRemoved: 1, filesRemoved: 1, skipped: 0, failed: 2 });
    expect(await f.bytes(referenced.storageId)).toBe("owned bytes");
    expect(await f.bytes(mismatch.storageId)).toBe("owned bytes");
    expect(await f.read(valid.id)).toBeNull();
    expect((await f.read(referenced.id))?.state).toBe("stored");
  });

  it("rejects contradictory receipt indexes before any file deletion", async () => {
    const f = setup();
    const file = await f.stored();
    await f.t.run((ctx) =>
      ctx.db.insert("uploadReceipts", {
        logicalId: "contradiction",
        ownerId: "bob",
        capabilityHash: file.capabilityHash,
        createdAt: Date.now(),
        expiresAt: Date.now() + 1000,
        state: "issued",
      }),
    );
    await expect(f.t.mutation(cleanupOne, { receiptId: file.id, cleanupId: "denied" })).rejects.toThrow();
    expect(await f.bytes(file.storageId)).toBe("owned bytes");
  });

  it("uses four bounded expiry indexes without letting ordinary history hide eligible work", async () => {
    const f = setup();
    const now = Date.now();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 1001; i++) {
        const base = f.identity();
        await ctx.db.insert("uploadReceipts", {
          logicalId: base.id,
          ownerId: base.ownerId,
          capabilityHash: base.capabilityHash,
          createdAt: base.createdAt,
          expiresAt: now + 60_000,
          state: "issued",
        });
      }
      for (const state of ["stored", "cleaning", "issued", "receiving"] as const)
        for (let i = 0; i < 30; i++) {
          const base = f.identity();
          const blob = { storageId: `discovery-only-${base.id}`, size: 1, type: "text/plain", sha256: "a".repeat(64) };
          let receipt: UploadReceipt;
          if (state === "stored") receipt = { ...base, state, blob, receivedByAttemptId: "receiver", storedAt: now - 10, registerUntil: now - 1 };
          else if (state === "cleaning") receipt = { ...base, state, blob, cleanupId: "old", leaseUntil: now - 1 };
          else if (state === "receiving")
            receipt = { ...base, state, expiresAt: now - UPLOAD_LIMITS.pendingMs - 1, attemptId: "old", leaseUntil: now - UPLOAD_LIMITS.pendingMs - 1 };
          else receipt = { ...base, state };
          const { id, ...data } = receipt;
          await ctx.db.insert("uploadReceipts", { logicalId: id, ...data });
        }
    });
    const ids: unknown = await f.t.query(candidates, { now });
    expect(ids).toHaveLength(UPLOAD_CLEANUP_BATCH * 4);
    expect(new Set(Array.isArray(ids) ? ids : []).size).toBe(UPLOAD_CLEANUP_BATCH * 4);
  });

  it("refuses malformed expiry instead of treating it as expired", async () => {
    const f = setup();
    const file = await f.stored();
    await f.t.run(async (ctx) => {
      const row = await ctx.db
        .query("uploadReceipts")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", file.id))
        .unique();
      if (!row) throw new Error("Fixture missing");
      await ctx.db.patch(row._id, { registerUntil: -1 });
    });
    await expect(f.t.mutation(cleanupOne, { receiptId: file.id, cleanupId: "invalid-expiry" })).rejects.toThrow();
    expect(await f.bytes(file.storageId)).toBe("owned bytes");
    expect((await f.read(file.id))?.state).toBe("stored");
  });
});
