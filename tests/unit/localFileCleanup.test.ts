import { describe, expect, it } from "vitest";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { createPersonalDb } from "@/lib/domain/collaboration/personalDb";
import { localUploadStore } from "@/lib/domain/localUploadStore";
import { getPendingLocalCleanup, stageLocalFileDeletions, LOCAL_FILE_CLEANUP_LIMIT } from "@/lib/domain/localFileCleanup";
import { UploadService, type UploadRuntime } from "@/lib/domain/uploads";

async function fixture() {
  const db = new MemoryDb();
  let sequence = 0;
  const runtime: UploadRuntime = {
    now: () => 1000,
    newId: () => `cleanup-${++sequence}`,
    createCapability: () => `max-upload-v1.${(++sequence).toString(16).padStart(64, "0")}`,
    hashCapability: async (value) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
  const store = localUploadStore(db);
  const service = new UploadService(store, runtime);
  const blob = { storageId: "filebytes123", size: 4, type: "text/plain", sha256: "a".repeat(64) };
  const files = new Map([[blob.storageId, { size: blob.size, type: blob.type, sha256: blob.sha256 }]]);
  const readMetadata = async (storageId: string) => files.get(storageId) ?? null;
  const personal = createPersonalDb({ db, ownerId: "alice" });
  const ticket = await db.transaction(() => service.issue("alice"));
  const begun = await db.transaction(() => service.begin(ticket.capability));
  if (begun.state !== "receiving") throw new Error("Expected receiving lease");
  await db.transaction(() => service.complete(begun.attempt, blob));
  const asset = () =>
    db.insert("assets", {
      ownerId: "alice",
      pageId: null,
      storageId: blob.storageId,
      type: blob.type,
      size: blob.size,
      name: "a.txt",
      alt: "",
      createdAt: 1000,
    });
  const registered = await db.transaction(() => service.register("alice", blob, "attachment-details", asset, async () => undefined));
  const stage = (ids = [blob.storageId]) => stageLocalFileDeletions(db, "alice", ids, readMetadata, runtime, personal);
  return { db, runtime, store, service, blob, files, readMetadata, personal, asset, registered, stage, ticket };
}

describe("durable local file deletion ledger", () => {
  it("retires an explicitly deleted attachment without deleting physical bytes", async () => {
    const f = await fixture();
    const claims = await f.db.transaction(async () => {
      await f.db.delete("assets", f.registered.assetId);
      return f.stage();
    });
    expect(claims).toHaveLength(1);
    expect(f.files.has(f.blob.storageId)).toBe(true);
    const receipt = await f.store.transaction((tx) => tx.get(claims[0].receiptId));
    expect(receipt).toMatchObject({ state: "cleaning", blob: f.blob, ownerId: "alice" });
    await expect(f.service.register("alice", f.blob, "attachment-details", f.asset, async () => undefined)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("keeps registration excluded while serialized cleanup and replay requests race", async () => {
    const f = await fixture();
    let tail: Promise<unknown> = Promise.resolve();
    const write = <T>(run: () => Promise<T>) => {
      const next = tail.then(() => f.db.transaction(run));
      tail = next.catch(() => undefined);
      return next;
    };
    const [retirement, registration] = await Promise.allSettled([
      write(async () => {
        await f.db.delete("assets", f.registered.assetId);
        return f.stage();
      }),
      write(() => f.service.register("alice", f.blob, "attachment-details", f.asset, async () => undefined)),
    ]);
    expect(retirement.status).toBe("fulfilled");
    expect(registration.status).toBe("rejected");
    if (registration.status === "rejected") expect(registration.reason).toMatchObject({ code: "NOT_FOUND" });
    expect(await f.db.list("assets", "alice")).toEqual([]);
    expect(await getPendingLocalCleanup(f.db, "alice")).toHaveLength(1);
  });

  it("rolls back attachment removal and retirement when the outer durable transaction fails", async () => {
    const f = await fixture();
    const original = f.db.snapshot();
    await expect(
      f.db.transaction(async () => {
        await f.db.delete("assets", f.registered.assetId);
        await f.stage();
        throw new Error("persist failed");
      }),
    ).rejects.toThrow("persist failed");
    expect(f.db.snapshot()).toBe(original);
    expect(f.files.has(f.blob.storageId)).toBe(true);
    expect(await getPendingLocalCleanup(f.db, "alice")).toEqual([]);
  });

  it("reconstructs committed claims after restart and completes only after external deletion", async () => {
    const f = await fixture();
    await f.db.transaction(async () => {
      await f.db.delete("assets", f.registered.assetId);
      await f.stage();
    });
    const restarted = new MemoryDb();
    restarted.restore(f.db.snapshot());
    const claims = await getPendingLocalCleanup(restarted, "alice");
    expect(claims).toHaveLength(1);
    const service = new UploadService(localUploadStore(restarted), f.runtime);
    f.files.delete(claims[0].storageId);
    await restarted.transaction(() => service.completeCleanup(claims[0]));
    expect(await getPendingLocalCleanup(restarted, "alice")).toEqual([]);
    expect((await restarted.list("uploadReceipts", "alice"))[0]).toMatchObject({ state: "cleaned", blob: f.blob });
    await restarted.transaction(() => service.completeCleanup(claims[0]));
  });

  it("keeps bytes and a still-valid registered receipt when another personal reference remains", async () => {
    const f = await fixture();
    await f.asset();
    expect(await f.db.transaction(() => f.stage())).toEqual([]);
    expect((await f.db.list("uploadReceipts", "alice"))[0].state).toBe("registered");
    expect(f.files.has(f.blob.storageId)).toBe(true);
  });

  it("removes an obsolete registered receipt while preserving a remaining personal attachment", async () => {
    const f = await fixture();
    const other = await f.asset();
    await f.db.delete("assets", f.registered.assetId);
    expect(await f.db.transaction(() => f.stage())).toEqual([]);
    expect(await f.db.list("uploadReceipts", "alice")).toEqual([]);
    expect(await f.db.get("assets", other)).not.toBeNull();
    expect(f.files.has(f.blob.storageId)).toBe(true);
  });

  it("denies foreign and unresolved references without changing receipt metadata", async () => {
    for (const foreign of [true, false]) {
      const f = await fixture();
      await f.db.delete("assets", f.registered.assetId);
      await f.db.insert("assets", {
        ownerId: foreign ? "bob" : "alice",
        pageId: foreign ? null : "missing-page",
        storageId: f.blob.storageId,
        name: "ref",
        type: f.blob.type,
        size: 4,
        alt: "",
        createdAt: 1000,
      });
      const before = f.db.snapshot();
      await expect(f.stage()).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.db.snapshot()).toBe(before);
    }
  });

  it("validates every selected file before applying the first transition", async () => {
    const f = await fixture();
    await f.db.delete("assets", f.registered.assetId);
    f.files.set("otherfile123", { size: -1, type: "text/plain", sha256: "b".repeat(64) });
    const before = f.db.snapshot();
    await expect(f.stage([f.blob.storageId, "otherfile123"])).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.db.snapshot()).toBe(before);
    f.files.set(f.blob.storageId, { size: 4, type: "text/plain", sha256: "b".repeat(64) });
    await expect(f.stage()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.db.snapshot()).toBe(before);
    f.files.set(f.blob.storageId, { size: 4, type: "Text/Plain; charset=utf-8", sha256: f.blob.sha256 });
    await expect(f.stage()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.db.snapshot()).toBe(before);
  });

  it("rejects duplicated receipt indexes and foreign receipt ownership", async () => {
    for (const duplicate of [true, false]) {
      const f = await fixture();
      await f.db.delete("assets", f.registered.assetId);
      const row = (await f.db.list("uploadReceipts", "alice"))[0];
      if (duplicate) {
        const { _id: _physical, ...value } = row;
        await f.db.insert("uploadReceipts", value);
      } else await f.db.patch("uploadReceipts", row._id, { ownerId: "bob" });
      const before = f.db.snapshot();
      await expect(f.stage()).rejects.toMatchObject({ code: duplicate ? "INTERNAL" : "CONFLICT" });
      expect(f.db.snapshot()).toBe(before);
    }
  });

  it("creates a cleanup-only receipt for explicitly removed legacy bytes", async () => {
    const f = await fixture();
    const row = (await f.db.list("uploadReceipts", "alice"))[0];
    await f.db.delete("uploadReceipts", row._id);
    await f.db.delete("assets", f.registered.assetId);
    const claims = await f.db.transaction(() => f.stage([f.blob.storageId, f.blob.storageId]));
    expect(claims).toHaveLength(1);
    const receipt = (await f.db.list("uploadReceipts", "alice"))[0];
    expect(receipt).toMatchObject({ state: "cleaning", expiresAt: 1000, blob: f.blob });
    expect(await getPendingLocalCleanup(f.db, "alice")).toEqual(claims);
  });

  it("reuses cleanup claims and handles already absent bytes idempotently", async () => {
    const f = await fixture();
    await f.db.delete("assets", f.registered.assetId);
    const claims = await f.db.transaction(() => f.stage());
    expect(await f.db.transaction(() => f.stage())).toEqual(claims);
    f.files.delete(f.blob.storageId);
    expect(await f.db.transaction(() => f.stage())).toEqual([]);
    expect((await f.db.list("uploadReceipts", "alice"))[0].state).toBe("cleaned");
  });

  it("refuses recovery deletion if bytes gained any attachment reference", async () => {
    const f = await fixture();
    await f.db.delete("assets", f.registered.assetId);
    await f.db.transaction(() => f.stage());
    await f.asset();
    await expect(getPendingLocalCleanup(f.db, "alice")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.files.has(f.blob.storageId)).toBe(true);
  });

  it("refuses malformed cleanup claims after snapshot loading", async () => {
    const f = await fixture();
    await f.db.delete("assets", f.registered.assetId);
    await f.db.transaction(() => f.stage());
    const row = (await f.db.list("uploadReceipts", "alice"))[0];
    await f.db.patch("uploadReceipts", row._id, { capabilityHash: "invalid" });
    await expect(getPendingLocalCleanup(f.db, "alice")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.files.has(f.blob.storageId)).toBe(true);
  });

  it("refuses unsafe paths and supported-limit overflow before writes", async () => {
    const f = await fixture();
    const before = f.db.snapshot();
    await expect(f.stage(["../escape"])).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.stage(Array.from({ length: LOCAL_FILE_CLEANUP_LIMIT + 1 }, () => f.blob.storageId))).rejects.toMatchObject({ code: "LIMIT" });
    expect(f.db.snapshot()).toBe(before);
  });

  it("does not let unrelated upload history block reads or one selected deletion", async () => {
    const f = await fixture();
    for (let index = 0; index <= LOCAL_FILE_CLEANUP_LIMIT; index++) {
      await f.db.insert("uploadReceipts", {
        id: `history-${index}`,
        ownerId: "alice",
        capabilityHash: (index + 1000).toString(16).padStart(64, "0"),
        createdAt: 1000,
        expiresAt: 2000,
        state: "issued",
      });
    }
    expect(await getPendingLocalCleanup(f.db, "alice")).toEqual([]);
    await f.db.delete("assets", f.registered.assetId);
    expect(await f.db.transaction(() => f.stage())).toHaveLength(1);
    expect(await getPendingLocalCleanup(f.db, "alice")).toHaveLength(1);
  });

  it("retains the bound on actual pending cleanup claims", async () => {
    const f = await fixture();
    for (let index = 0; index <= LOCAL_FILE_CLEANUP_LIMIT; index++) {
      await f.db.insert("uploadReceipts", {
        id: `pending-${index}`,
        ownerId: "alice",
        capabilityHash: (index + 1000).toString(16).padStart(64, "0"),
        createdAt: 1000,
        expiresAt: 1000,
        state: "cleaning",
        cleanupId: `claim-${index}`,
        leaseUntil: 2000,
        blob: { ...f.blob, storageId: `pendingfile${index}` },
      });
    }
    const before = f.db.snapshot();
    await expect(getPendingLocalCleanup(f.db, "alice")).rejects.toMatchObject({ code: "LIMIT" });
    await expect(f.stage()).rejects.toMatchObject({ code: "LIMIT" });
    expect(f.db.snapshot()).toBe(before);
  });
});
