import { describe, expect, it } from "vitest";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { localUploadStore } from "@/lib/domain/localUploadStore";
import { UploadService, UPLOAD_LIMITS, type UploadReceipt, type UploadRuntime } from "@/lib/domain/uploads";

function fixture() {
  const db = new MemoryDb();
  const store = localUploadStore(db);
  let now = 1000;
  let sequence = 0;
  let tail: Promise<unknown> = Promise.resolve();
  const write = <T>(run: () => Promise<T>): Promise<T> => {
    const next = tail.then(() => db.transaction(run));
    tail = next.catch(() => undefined);
    return next;
  };
  const runtime: UploadRuntime = {
    now: () => now,
    newId: () => `local-${++sequence}`,
    createCapability: () => `max-upload-v1.${(++sequence).toString(16).padStart(64, "0")}`,
    hashCapability: async (token) =>
      Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
  const service = new UploadService(store, runtime);
  const blob = { storageId: "localbytes123", size: 4, type: "text/plain", sha256: "a".repeat(64) };
  const commit = () =>
    db.insert("assets", {
      ownerId: "alice",
      pageId: null,
      storageId: blob.storageId,
      size: blob.size,
      type: blob.type,
      name: "a.txt",
      alt: "",
      createdAt: now,
    });
  const authorize = async (assetId: string) => {
    if (!(await db.get("assets", assetId))) throw new Error("Asset authorization failed");
  };
  const receive = async () => {
    const ticket = await write(() => service.issue("alice"));
    const begun = await write(() => service.begin(ticket.capability));
    if (begun.state !== "receiving") throw new Error("Expected receiver");
    await write(() => service.complete(begun.attempt, blob));
    return { ...ticket, attempt: begun.attempt };
  };
  return {
    db,
    store,
    service,
    runtime,
    blob,
    write,
    commit,
    authorize,
    receive,
    setNow: (value: number) => {
      now = value;
    },
  };
}

const identity = (row: UploadReceipt) => ({
  id: row.id,
  ownerId: row.ownerId,
  capabilityHash: row.capabilityHash,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
});

describe("local upload receipt adapter", () => {
  it("persists a full receive/register lifecycle and exact variant replacement with a stable physical ID", async () => {
    const f = fixture();
    const ticket = await f.write(() => f.service.issue("alice"));
    const initial = (await f.db.list("uploadReceipts", "alice"))[0];
    const begun = await f.write(() => f.service.begin(ticket.capability));
    if (begun.state !== "receiving") throw new Error("Expected receiver");
    await f.write(() => f.service.complete(begun.attempt, f.blob));
    const stored = (await f.db.list("uploadReceipts", "alice"))[0];
    expect(stored._id).toBe(initial._id);
    expect(stored).not.toHaveProperty("attemptId");
    expect(stored).not.toHaveProperty("leaseUntil");
    const registered = await f.write(() => f.service.register("alice", f.blob, "details", f.commit, f.authorize));
    const terminal = (await f.db.list("uploadReceipts", "alice"))[0];
    expect(terminal._id).toBe(initial._id);
    expect(terminal).not.toHaveProperty("storedAt");
    expect(terminal).not.toHaveProperty("registerUntil");
    const reopened = new MemoryDb();
    reopened.restore(f.db.snapshot());
    expect(await localUploadStore(reopened).transaction((tx) => tx.getByStorageId(f.blob.storageId))).toMatchObject({
      state: "registered",
      assetId: registered.assetId,
    });
    expect(await reopened.get("assets", registered.assetId)).not.toBeNull();
  });

  it("resolves capability hashes globally without granting foreign registration", async () => {
    const f = fixture();
    const received = await f.receive();
    expect(await f.store.transaction((tx) => tx.getByCapabilityHash("missing"))).toBeNull();
    const hash = await f.runtime.hashCapability(received.capability);
    expect(await f.store.transaction((tx) => tx.getByCapabilityHash(hash))).toMatchObject({ ownerId: "alice" });
    await expect(f.write(() => f.service.register("bob", f.blob, "details", f.commit, f.authorize))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await f.db.list("assets", "alice")).toEqual([]);
  });

  it("serializes concurrent consumption in the caller's outer transaction", async () => {
    const f = fixture();
    await f.receive();
    const results = await Promise.all([
      f.write(() => f.service.register("alice", f.blob, "details", f.commit, f.authorize)),
      f.write(() => f.service.register("alice", f.blob, "details", f.commit, f.authorize)),
    ]);
    expect(results.map((result) => result.replay)).toEqual([false, true]);
    expect(results[0].assetId).toBe(results[1].assetId);
    expect(await f.db.list("assets", "alice")).toHaveLength(1);
  });

  it("rolls receipt and attachment writes back together after a later outer failure", async () => {
    const f = fixture();
    const received = await f.receive();
    const before = f.db.snapshot();
    await expect(
      f.write(async () => {
        await f.service.register("alice", f.blob, "details", f.commit, f.authorize);
        throw new Error("Later batch failure");
      }),
    ).rejects.toThrow("Later batch failure");
    expect(f.db.snapshot()).toBe(before);
    expect(await f.store.transaction((tx) => tx.get(received.attempt.receiptId))).toMatchObject({ state: "stored" });
  });

  it("rejects duplicate logical IDs, hashes and blob IDs even across owners", async () => {
    for (const duplicate of ["id", "capabilityHash", "blob.storageId"]) {
      const f = fixture();
      const received = await f.receive();
      const original = await f.store.transaction((tx) => tx.get(received.attempt.receiptId));
      if (!original || original.state !== "stored") throw new Error("Expected stored receipt");
      const corrupt: UploadReceipt = {
        ...original,
        id: duplicate === "id" ? original.id : "foreign-receipt",
        ownerId: "bob",
        capabilityHash: duplicate === "capabilityHash" ? original.capabilityHash : "f".repeat(64),
        blob: { ...original.blob, storageId: duplicate === "blob.storageId" ? original.blob.storageId : "foreignbytes" },
      };
      await f.db.insert("uploadReceipts", corrupt);
      await expect(f.store.transaction((tx) => tx.get(original.id))).rejects.toMatchObject({ code: "INTERNAL" });
      await expect(f.store.transaction((tx) => tx.put(original))).rejects.toMatchObject({ code: "INTERNAL" });
    }
  });

  it("refuses duplicate insertions and missing replacements before modifying the snapshot", async () => {
    const f = fixture();
    const received = await f.receive();
    const original = await f.store.transaction((tx) => tx.get(received.attempt.receiptId));
    if (!original || original.state !== "stored") throw new Error("Expected stored receipt");
    const before = f.db.snapshot();
    for (const duplicate of [original, { ...original, id: "second" }, { ...original, id: "third", capabilityHash: "e".repeat(64) }])
      await expect(f.write(() => f.store.transaction((tx) => tx.insert(duplicate)))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.write(() => f.store.transaction((tx) => tx.put({ ...original, id: "missing" })))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.db.snapshot()).toBe(before);
  });

  it("enforces identity, received bytes and completed receipt immutability", async () => {
    const f = fixture();
    const received = await f.receive();
    const original = await f.store.transaction((tx) => tx.get(received.attempt.receiptId));
    if (!original || original.state !== "stored") throw new Error("Expected stored receipt");
    for (const change of [
      { ...original, ownerId: "bob" },
      { ...original, capabilityHash: "f".repeat(64) },
      { ...original, createdAt: 0 },
      { ...original, expiresAt: 1 },
      { ...original, blob: { ...original.blob, size: 8 } },
    ])
      await expect(f.write(() => f.store.transaction((tx) => tx.put(change)))).rejects.toMatchObject({ code: "CONFLICT" });
    await f.write(() => f.service.register("alice", f.blob, "details", f.commit, f.authorize));
    const registered = await f.store.transaction((tx) => tx.get(original.id));
    if (!registered || registered.state !== "registered") throw new Error("Expected registered receipt");
    await expect(f.write(() => f.store.transaction((tx) => tx.put({ ...registered, assetId: "replacement" })))).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.write(() => f.store.transaction((tx) => tx.put({ ...identity(registered), state: "issued" })))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("retains cleanup claims across snapshot restore and cannot reopen cleaned bytes", async () => {
    const f = fixture();
    const received = await f.receive();
    f.setNow(1000 + UPLOAD_LIMITS.pendingMs);
    const claim = await f.write(() => f.service.claimCleanup(received.attempt.receiptId));
    if (!claim) throw new Error("Expected cleanup claim");
    const serialized = f.db.snapshot();
    f.db.restore(serialized);
    await f.write(() => f.service.completeCleanup(claim));
    const cleaned = await f.store.transaction((tx) => tx.get(claim.receiptId));
    if (!cleaned || cleaned.state !== "cleaned") throw new Error("Expected cleaned receipt");
    expect((await f.db.list("uploadReceipts", "alice"))[0]).not.toHaveProperty("cleanupId");
    await expect(f.write(() => f.store.transaction((tx) => tx.put({ ...cleaned, cleanedAt: 0 })))).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("starts no nested transaction and preserves v1 snapshots when receipts are absent", async () => {
    const f = fixture();
    let transactions = 0;
    const originalTransaction = f.db.transaction.bind(f.db);
    f.db.transaction = async (run) => {
      transactions++;
      return originalTransaction(run);
    };
    expect(JSON.parse(f.db.snapshot())).not.toHaveProperty("uploadReceipts");
    await f.write(() => f.service.issue("alice"));
    expect(transactions).toBe(1);
    expect(JSON.parse(f.db.snapshot())).toHaveProperty("uploadReceipts");
  });
});
