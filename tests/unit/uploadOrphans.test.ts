import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import schema from "@/convex/schema";
import { convexUploadStore } from "@/convex/uploadStore";
import type { UploadReceipt } from "@/lib/domain/uploads";

const identity = (row: UploadReceipt) => ({
  id: row.id,
  ownerId: row.ownerId,
  capabilityHash: row.capabilityHash,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
});

const adopt = makeFunctionReference<"mutation">("uploadOrphans:adopt");
const cleaning = z.object({
  state: z.literal("cleaning"),
  claim: z.object({ receiptId: z.string(), cleanupId: z.string(), storageId: z.string() }),
  blob: z.object({ storageId: z.string(), size: z.number(), type: z.string(), sha256: z.string() }),
});

async function fixture() {
  const t = convexTest(schema, {
    "../../convex/_generated/server.ts": async () => ({}),
    "../../convex/uploadOrphans.ts": () => import("@/convex/uploadOrphans"),
  });
  const attempt = { receiptId: "original", ownerId: "alice", attemptId: "old-attempt" };
  const actual = await t.run(async (ctx) => {
    await convexUploadStore(ctx.db).transaction((tx) =>
      tx.insert({
        id: attempt.receiptId,
        ownerId: attempt.ownerId,
        capabilityHash: "a".repeat(64),
        createdAt: Date.now() - 1000,
        expiresAt: Date.now() + 60_000,
        state: "receiving",
        attemptId: "newer-attempt",
        leaseUntil: Date.now() + 10_000,
      }),
    );
    const storageId = await ctx.storage.store(new Blob(["actual bytes"], { type: "text/plain" }));
    const stored = await ctx.db.system.get(storageId);
    if (!stored) throw new Error("Missing native stored metadata");
    return {
      storageId,
      size: stored.size,
      type: stored.contentType ?? "application/octet-stream",
      sha256: Array.from(atob(stored.sha256), (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
    };
  });
  const args = { attempt, storageId: actual.storageId, orphanId: "orphan", capabilityHash: "b".repeat(64), cleanupId: "cleanup" };
  return { t, actual, args };
}

describe("trusted native upload orphan adoption", () => {
  it("records stale receiver bytes as cleanup-only using actual storage metadata", async () => {
    const f = await fixture();
    const result = cleaning.parse(await f.t.mutation(adopt, f.args));
    expect(result.blob).toEqual(f.actual);
    expect(result.claim).toEqual({ receiptId: "orphan", cleanupId: "cleanup", storageId: f.actual.storageId });
    const receipt = await f.t.run((ctx) => convexUploadStore(ctx.db).transaction((tx) => tx.get("orphan")));
    expect(receipt).toMatchObject({ ownerId: "alice", state: "cleaning", blob: f.actual });
    if (!receipt) throw new Error("Expected orphan receipt");
    expect(receipt.expiresAt).toBe(receipt.createdAt);
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(f.actual.storageId)) !== null)).toBe(true);
  });

  it("preserves a stored receipt when completion committed but its acknowledgement was lost", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      convexUploadStore(ctx.db).transaction(async (tx) => {
        const original = await tx.get("original");
        if (!original) throw new Error("Missing original");
        await tx.put({
          ...identity(original),
          state: "stored",
          blob: f.actual,
          receivedByAttemptId: "old-attempt",
          storedAt: Date.now(),
          registerUntil: Date.now() + 100_000,
        });
      }),
    );
    expect(await f.t.mutation(adopt, f.args)).toEqual({ state: "preserved", storageId: f.actual.storageId });
    expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(3))).toHaveLength(1);
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(f.actual.storageId)) !== null)).toBe(true);
  });

  it("preserves registered bytes and their global attachment reference", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const assetId = await ctx.db.insert("assets", {
        ownerId: "alice",
        pageId: null,
        storageId: f.actual.storageId,
        size: f.actual.size,
        type: f.actual.type,
        name: "a.txt",
        alt: "",
        createdAt: Date.now(),
      });
      await convexUploadStore(ctx.db).transaction(async (tx) => {
        const original = await tx.get("original");
        if (!original) throw new Error("Missing original");
        await tx.put({
          ...identity(original),
          state: "registered",
          blob: f.actual,
          receivedByAttemptId: "old-attempt",
          assetId,
          registrationKey: "details",
          registeredAt: Date.now(),
        });
      });
    });
    expect(await f.t.mutation(adopt, f.args)).toEqual({ state: "preserved", storageId: f.actual.storageId });
    expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(3))).toHaveLength(1);
  });

  it("refuses foreign original owners and any globally referenced unreceipted bytes", async () => {
    const f = await fixture();
    await expect(f.t.mutation(adopt, { ...f.args, attempt: { ...f.args.attempt, ownerId: "bob" } })).rejects.toThrow();
    await f.t.run((ctx) =>
      ctx.db.insert("assets", {
        ownerId: "bob",
        pageId: null,
        storageId: f.actual.storageId,
        size: f.actual.size,
        type: f.actual.type,
        name: "b.txt",
        alt: "",
        createdAt: Date.now(),
      }),
    );
    await expect(f.t.mutation(adopt, f.args)).rejects.toThrow();
    expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(3))).toHaveLength(1);
    expect(await f.t.run(async (ctx) => (await ctx.storage.get(f.actual.storageId)) !== null)).toBe(true);
  });

  it("refuses another owner's existing receipt", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      convexUploadStore(ctx.db).transaction((tx) =>
        tx.insert({
          id: "foreign",
          ownerId: "bob",
          capabilityHash: "c".repeat(64),
          createdAt: 0,
          expiresAt: 1000,
          state: "stored",
          blob: f.actual,
          receivedByAttemptId: "bob-attempt",
          storedAt: 1,
          registerUntil: 1000,
        }),
      ),
    );
    await expect(f.t.mutation(adopt, f.args)).rejects.toThrow();
    expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(3))).toHaveLength(2);
  });

  it("returns the original cleanup claim on repeat adoption without duplicating records", async () => {
    const f = await fixture();
    const first = await f.t.mutation(adopt, f.args);
    expect(await f.t.mutation(adopt, { ...f.args, orphanId: "another-id", cleanupId: "another-cleanup", capabilityHash: "d".repeat(64) })).toEqual(first);
    expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(3))).toHaveLength(2);
  });

  it("refuses stored metadata contradictions and bytes older than the originating ticket", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      convexUploadStore(ctx.db).transaction(async (tx) => {
        const original = await tx.get("original");
        if (!original) throw new Error("Missing original");
        await tx.put({
          ...identity(original),
          state: "stored",
          blob: { ...f.actual, size: 1 },
          receivedByAttemptId: "old-attempt",
          storedAt: Date.now(),
          registerUntil: Date.now() + 10_000,
        });
      }),
    );
    await expect(f.t.mutation(adopt, f.args)).rejects.toThrow();
    const old = await fixture();
    await old.t.run(async (ctx) => {
      const original = await ctx.db
        .query("uploadReceipts")
        .withIndex("by_logicalId", (q) => q.eq("logicalId", "original"))
        .unique();
      if (!original) throw new Error("Missing original");
      await ctx.db.patch(original._id, { createdAt: Date.now() + 100_000 });
    });
    await expect(old.t.mutation(adopt, old.args)).rejects.toThrow();
  });

  it("is idempotent after receipt-aware deletion and rejects caller body metadata", async () => {
    const f = await fixture();
    const result = cleaning.parse(await f.t.mutation(adopt, f.args));
    await f.t.run(async (ctx) => {
      await ctx.storage.delete(f.actual.storageId);
      await convexUploadStore(ctx.db).transaction(async (tx) => {
        const receipt = await tx.get(result.claim.receiptId);
        if (!receipt || receipt.state !== "cleaning") throw new Error("Expected cleanup receipt");
        await tx.put({ ...identity(receipt), blob: receipt.blob, state: "cleaned", cleanedAt: Date.now() });
      });
    });
    expect(await f.t.mutation(adopt, f.args)).toEqual({ state: "cleaned", storageId: f.actual.storageId });
    await expect(f.t.mutation(adopt, { ...f.args, blob: { size: 1, sha256: "forged" } })).rejects.toThrow();
  });
});
