import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { convexUploadStore } from "@/convex/uploadStore";
import { UploadService, UPLOAD_LIMITS, type UploadReceipt, type UploadRuntime } from "@/lib/domain/uploads";

function setup() {
  const t = convexTest(schema, { "../../convex/_generated/server.ts": async () => ({}) });
  let sequence = 0;
  let now = 1000;
  const runtime: UploadRuntime = {
    now: () => now,
    newId: () => `upload-${++sequence}`,
    createCapability: () => `max-upload-v1.${(++sequence).toString(16).padStart(64, "0")}`,
    hashCapability: async (capability) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(capability))), (b) => b.toString(16).padStart(2, "0")).join(""),
  };
  const blob = { storageId: "trusted-receiver-bytes", size: 3, type: "text/plain", sha256: "a".repeat(64) };
  return {
    t,
    runtime,
    blob,
    advance: (milliseconds: number) => {
      now += milliseconds;
    },
  };
}

describe("native upload ownership receipts", () => {
  it("rejects writes from native query contexts and cannot reopen terminal receipts", async () => {
    const f = setup();
    const receipt: UploadReceipt = {
      id: "terminal",
      ownerId: "alice",
      capabilityHash: "d".repeat(64),
      createdAt: 1,
      expiresAt: 10000,
      state: "registered",
      blob: f.blob,
      receivedByAttemptId: "attempt",
      assetId: "asset",
      registrationKey: "key",
      registeredAt: 2,
    };
    await expect(f.t.query((ctx) => convexUploadStore(ctx.db).transaction((tx) => tx.insert(receipt)))).rejects.toMatchObject({ code: "INTERNAL" });
    await f.t.run((ctx) => convexUploadStore(ctx.db).transaction((tx) => tx.insert(receipt)));
    await expect(f.t.query((ctx) => convexUploadStore(ctx.db).transaction((tx) => tx.put(receipt)))).rejects.toMatchObject({ code: "INTERNAL" });
    await f.t.run(async (ctx) => {
      const store = convexUploadStore(ctx.db);
      await expect(store.transaction((tx) => tx.put({ ...receipt, assetId: "replacement" }))).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(store.transaction((tx) => tx.put({ ...receipt, state: "stored", storedAt: 2, registerUntil: 10000 }))).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(store.transaction((tx) => tx.insert({ ...receipt, id: "other", capabilityHash: "e".repeat(64) }))).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await store.transaction((tx) => tx.put({ ...receipt }));
      expect(await store.transaction((tx) => tx.get(receipt.id))).toEqual(receipt);
    });
  });

  it("persists issue/receive/register and reauthorizes registration retries across transactions", async () => {
    const f = setup();
    const issued = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).issue("alice"));
    const started = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).begin(issued.capability));
    if (started.state !== "receiving") throw new Error("Expected fresh receiver");
    await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).complete(started.attempt, f.blob));
    await expect(
      f.t.run((ctx) =>
        new UploadService(convexUploadStore(ctx.db), f.runtime).register(
          "bob",
          f.blob,
          "same",
          async () => "stolen",
          async () => {},
        ),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const result = await f.t.run((ctx) =>
      new UploadService(convexUploadStore(ctx.db), f.runtime).register(
        "alice",
        f.blob,
        "registration",
        async (blob) =>
          ctx.db.insert("assets", {
            ownerId: "alice",
            pageId: null,
            storageId: blob.storageId,
            name: "a.txt",
            type: blob.type,
            size: blob.size,
            alt: "",
            createdAt: 1000,
          }),
        async () => {
          throw new Error("Initial registration cannot replay");
        },
      ),
    );
    expect(result.replay).toBe(false);
    let replayAuthorityChecked = false;
    const replay = await f.t.run((ctx) =>
      new UploadService(convexUploadStore(ctx.db), f.runtime).register(
        "alice",
        f.blob,
        "registration",
        async () => {
          throw new Error("Cannot duplicate asset");
        },
        async (assetId) => {
          expect(assetId).toBe(result.assetId);
          replayAuthorityChecked = true;
        },
      ),
    );
    expect(replay).toEqual({ ...result, replay: true });
    expect(replayAuthorityChecked).toBe(true);
    await expect(
      f.t.run((ctx) =>
        new UploadService(convexUploadStore(ctx.db), f.runtime).register(
          "alice",
          f.blob,
          "registration",
          async () => "unused",
          async () => {
            throw new Error("Destination revoked");
          },
        ),
      ),
    ).rejects.toThrow("Destination revoked");
    await f.t.run(async (ctx) => {
      expect(await ctx.db.query("assets").take(2)).toHaveLength(1);
      expect(await convexUploadStore(ctx.db).transaction((tx) => tx.getByStorageId(f.blob.storageId))).toMatchObject({
        state: "registered",
        ownerId: "alice",
        assetId: result.assetId,
      });
    });
    f.advance(UPLOAD_LIMITS.pendingMs + 1);
    expect(await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).claimCleanup(started.attempt.receiptId))).toBeNull();
  });

  it("rolls back attachment and receipt writes together when an outer mutation fails", async () => {
    const f = setup();
    const { capability } = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).issue("alice"));
    const started = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).begin(capability));
    if (started.state !== "receiving") throw new Error("Expected receiver");
    await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).complete(started.attempt, f.blob));
    await expect(
      f.t.run(async (ctx) => {
        await new UploadService(convexUploadStore(ctx.db), f.runtime).register(
          "alice",
          f.blob,
          "register",
          async (blob) =>
            ctx.db.insert("assets", {
              ownerId: "alice",
              pageId: null,
              storageId: blob.storageId,
              name: "a.txt",
              type: blob.type,
              size: blob.size,
              alt: "",
              createdAt: 1000,
            }),
          async () => {},
        );
        throw new Error("Outer failure");
      }),
    ).rejects.toThrow("Outer failure");
    await f.t.run(async (ctx) => {
      expect(await ctx.db.query("assets").take(1)).toEqual([]);
      expect(await convexUploadStore(ctx.db).transaction((tx) => tx.getByStorageId(f.blob.storageId))).toMatchObject({ state: "stored" });
    });
  });

  it("claims cleanup before deletion and never cleans registered bytes", async () => {
    const f = setup();
    const { capability } = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).issue("alice"));
    const started = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).begin(capability));
    if (started.state !== "receiving") throw new Error("Expected receiver");
    await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).complete(started.attempt, f.blob));
    expect(await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).claimCleanup(started.attempt.receiptId))).toBeNull();
    f.advance(UPLOAD_LIMITS.pendingMs + 1);
    const claim = await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).claimCleanup(started.attempt.receiptId));
    if (!claim) throw new Error("Expected expired cleanup claim");
    await expect(
      f.t.run((ctx) =>
        new UploadService(convexUploadStore(ctx.db), f.runtime).register(
          "alice",
          f.blob,
          "late",
          async () => "late",
          async () => {},
        ),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).completeCleanup(claim));
    await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).completeCleanup(claim));
    expect(await f.t.run((ctx) => new UploadService(convexUploadStore(ctx.db), f.runtime).claimCleanup(claim.receiptId))).toBeNull();
  });

  it("rejects duplicate indexed identifiers and preserves immutable identity and received bytes", async () => {
    const f = setup();
    const initial: UploadReceipt = { id: "receipt", ownerId: "alice", capabilityHash: "b".repeat(64), createdAt: 1, expiresAt: 10000, state: "issued" };
    await f.t.run(async (ctx) => {
      const store = convexUploadStore(ctx.db);
      await store.transaction((tx) => tx.insert(initial));
      for (const changed of [
        { ...initial, ownerId: "bob" },
        { ...initial, capabilityHash: "c".repeat(64) },
        { ...initial, createdAt: 2 },
        { ...initial, expiresAt: 20000 },
      ])
        await expect(store.transaction((tx) => tx.put(changed))).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(store.transaction((tx) => tx.insert({ ...initial, id: "other" }))).rejects.toMatchObject({ code: "CONFLICT" });
      const stored: UploadReceipt = { ...initial, state: "stored", blob: f.blob, storedAt: 2, registerUntil: 10000, receivedByAttemptId: "attempt" };
      await store.transaction((tx) => tx.put(stored));
      await expect(store.transaction((tx) => tx.put({ ...stored, blob: { ...f.blob, storageId: "replacement" } }))).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(store.transaction((tx) => tx.put(initial))).rejects.toMatchObject({ code: "CONFLICT" });
      await ctx.db.insert("uploadReceipts", {
        logicalId: "receipt",
        ownerId: "alice",
        capabilityHash: initial.capabilityHash,
        createdAt: 1,
        expiresAt: 10000,
        state: "stored",
        blob: f.blob,
        storedAt: 2,
        registerUntil: 10000,
        receivedByAttemptId: "attempt",
      });
      await expect(store.transaction((tx) => tx.get("receipt"))).rejects.toMatchObject({ code: "INTERNAL" });
      await expect(store.transaction((tx) => tx.getByCapabilityHash(initial.capabilityHash))).rejects.toMatchObject({ code: "INTERNAL" });
      await expect(store.transaction((tx) => tx.getByStorageId(f.blob.storageId))).rejects.toMatchObject({ code: "INTERNAL" });
    });
  });
});
