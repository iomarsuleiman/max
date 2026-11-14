import { describe, expect, it } from "vitest";
import { MaxError } from "@/lib/domain/errors";
import {
  UploadService,
  UPLOAD_LIMITS,
  type StoredUpload,
  type UploadReceipt,
  type UploadRuntime,
  type UploadStore,
  type UploadTransaction,
} from "@/lib/domain/uploads";

const clone = <T>(value: T): T => structuredClone(value);

/** Serialized transactions include both receipt and attachment writes. */
class MemoryUploadStore implements UploadStore {
  receipts = new Map<string, UploadReceipt>();
  assets = new Map<string, StoredUpload>();
  private tail: Promise<unknown> = Promise.resolve();
  failPut = false;
  transaction<T>(body: (tx: UploadTransaction) => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      const receipts = clone(this.receipts);
      const assets = clone(this.assets);
      let open = true;
      const check = () => {
        if (!open) throw new Error("Closed transaction");
      };
      const find = (predicate: (row: UploadReceipt) => boolean) => {
        check();
        const found = [...this.receipts.values()].filter(predicate);
        if (found.length > 1) throw new Error("Duplicate receipt index");
        return clone(found[0] ?? null);
      };
      const tx: UploadTransaction = {
        get: async (id) => {
          check();
          return clone(this.receipts.get(id) ?? null);
        },
        getByCapabilityHash: async (hash) => find((row) => row.capabilityHash === hash),
        getByStorageId: async (id) => find((row) => "blob" in row && row.blob.storageId === id),
        insert: async (row) => {
          check();
          if (this.receipts.has(row.id)) throw new Error("Duplicate ID");
          this.receipts.set(row.id, clone(row));
        },
        put: async (row) => {
          check();
          if (this.failPut) throw new Error("Injected receipt failure");
          if (!this.receipts.has(row.id)) throw new Error("Missing ID");
          this.receipts.set(row.id, clone(row));
        },
      };
      try {
        return await body(tx);
      } catch (error) {
        this.receipts = receipts;
        this.assets = assets;
        throw error;
      } finally {
        open = false;
      }
    });
    this.tail = result.catch(() => undefined);
    return result;
  }
}

function fixture() {
  const store = new MemoryUploadStore();
  let now = 1000;
  let sequence = 0;
  const runtime: UploadRuntime = {
    now: () => now,
    newId: () => `trusted-${++sequence}`,
    createCapability: () => `max-upload-v1.${(++sequence).toString(16).padStart(64, "0")}`,
    hashCapability: async (token) => {
      const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  };
  const service = new UploadService(store, runtime);
  const blob: StoredUpload = { storageId: "actual-file", type: "text/plain", size: 7, sha256: "a".repeat(64) };
  const commit = async (actual: StoredUpload) => {
    const id = `asset-${store.assets.size + 1}`;
    store.assets.set(id, clone(actual));
    return id;
  };
  const authorize = async (id: string) => {
    if (!store.assets.has(id)) throw new MaxError("NOT_FOUND", "Asset missing");
  };
  const receive = async (owner = "alice", actual = blob) => {
    const ticket = await service.issue(owner);
    const begun = await service.begin(ticket.capability);
    if (begun.state !== "receiving") throw new Error("Expected attempt");
    await service.complete(begun.attempt, actual);
    return { ...ticket, attempt: begun.attempt };
  };
  return {
    service,
    store,
    runtime,
    blob,
    commit,
    authorize,
    receive,
    setNow: (value: number) => {
      now = value;
    },
    now: () => now,
  };
}

describe("transactional upload ownership receipts", () => {
  it("supports hashed-only internal mutations without persisting raw action capabilities", async () => {
    const f = fixture();
    const capability = f.runtime.createCapability();
    const hash = await f.runtime.hashCapability(capability);
    await f.service.issuePrepared("alice", { id: "action-created", capabilityHash: hash });
    expect(await f.service.beginHashed(hash)).toMatchObject({ state: "receiving", attempt: { receiptId: "action-created", ownerId: "alice" } });
    expect(JSON.stringify([...f.store.receipts.values()])).not.toContain(capability);
    await expect(f.service.issuePrepared("alice", { id: "another-id", capabilityHash: hash })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.service.beginHashed("malformed")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("persists only a capability hash and receives only measured server metadata", async () => {
    const f = fixture();
    const ticket = await f.service.issue("alice");
    expect(JSON.stringify([...f.store.receipts.values()])).not.toContain(ticket.capability);
    const begun = await f.service.begin(ticket.capability);
    expect(begun.state).toBe("receiving");
    if (begun.state !== "receiving") throw new Error("Expected attempt");
    expect(begun.attempt.ownerId).toBe("alice");
    await f.service.complete(begun.attempt, f.blob);
    expect(await f.service.begin(ticket.capability)).toEqual({ state: "stored", blob: f.blob });
  });

  it("serializes competing receivers and replaces only an expired lease", async () => {
    const f = fixture();
    const ticket = await f.service.issue("alice");
    const results = await Promise.allSettled([f.service.begin(ticket.capability), f.service.begin(ticket.capability)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const first = results.find((result) => result.status === "fulfilled");
    if (!first || first.status !== "fulfilled" || first.value.state !== "receiving") throw new Error("Expected receiver");
    f.setNow(first.value.leaseUntil);
    const next = await f.service.begin(ticket.capability);
    if (next.state !== "receiving") throw new Error("Expected receiver");
    await expect(f.service.complete(first.value.attempt, f.blob)).rejects.toMatchObject({ code: "CONFLICT" });
    await f.service.complete(next.attempt, f.blob);
    await expect(f.service.complete(first.value.attempt, f.blob)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await f.service.complete(next.attempt, f.blob)).toEqual(f.blob);
  });

  it("rejects malformed, missing, expired and incomplete capabilities", async () => {
    const f = fixture();
    await expect(f.service.begin("guess")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.service.begin(`max-upload-v1.${"f".repeat(64)}`)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const ticket = await f.service.issue("alice");
    f.setNow(ticket.expiresAt);
    await expect(f.service.begin(ticket.capability)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.service.register("alice", f.blob, "details", f.commit, f.authorize)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects wrong owner, metadata mismatch and a second receipt claiming the same bytes", async () => {
    const f = fixture();
    const received = await f.receive();
    await expect(f.service.complete({ ...received.attempt, ownerId: "bob" }, f.blob)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.service.register("bob", f.blob, "details", f.commit, f.authorize)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.service.register("alice", { ...f.blob, size: 8 }, "details", f.commit, f.authorize)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(f.receive("bob")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.store.assets.size).toBe(0);
  });

  it("registers exactly once under concurrency and reauthorizes identical retries", async () => {
    const f = fixture();
    const received = await f.receive();
    const results = await Promise.all([
      f.service.register("alice", f.blob, "page-and-details-hash", f.commit, f.authorize),
      f.service.register("alice", f.blob, "page-and-details-hash", f.commit, f.authorize),
    ]);
    expect(results).toEqual([
      { assetId: "asset-1", replay: false },
      { assetId: "asset-1", replay: true },
    ]);
    expect(f.store.assets.size).toBe(1);
    expect(await f.service.begin(received.capability)).toEqual({ state: "registered", blob: f.blob, assetId: "asset-1" });
    await expect(f.service.register("alice", f.blob, "different-destination", f.commit, f.authorize)).rejects.toMatchObject({ code: "CONFLICT" });
    f.store.assets.clear();
    await expect(f.service.register("alice", f.blob, "page-and-details-hash", f.commit, f.authorize)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rolls back attachment creation when the receipt commit fails", async () => {
    const f = fixture();
    const received = await f.receive();
    f.store.failPut = true;
    await expect(f.service.register("alice", f.blob, "details", f.commit, f.authorize)).rejects.toThrow("Injected receipt failure");
    expect(f.store.assets.size).toBe(0);
    expect(f.store.receipts.get(received.attempt.receiptId)?.state).toBe("stored");
    f.store.failPut = false;
    expect(await f.service.register("alice", f.blob, "details", f.commit, f.authorize)).toEqual({ assetId: "asset-1", replay: false });
  });

  it("retains a pending receipt when fresh destination authorization rejects registration", async () => {
    const f = fixture();
    const received = await f.receive();
    await expect(
      f.service.register(
        "alice",
        f.blob,
        "details",
        async () => {
          throw new MaxError("NOT_FOUND", "Destination revoked");
        },
        f.authorize,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.store.receipts.get(received.attempt.receiptId)?.state).toBe("stored");
    expect(f.store.assets.size).toBe(0);
  });

  it("claims only expired unregistered bytes and permanently blocks registration before deletion", async () => {
    const f = fixture();
    const received = await f.receive();
    expect(await f.service.claimCleanup(received.attempt.receiptId)).toBeNull();
    f.setNow(f.now() + UPLOAD_LIMITS.pendingMs);
    const claim = await f.service.claimCleanup(received.attempt.receiptId);
    expect(claim?.storageId).toBe(f.blob.storageId);
    if (!claim) throw new Error("Expected cleanup claim");
    await expect(f.service.register("alice", f.blob, "details", f.commit, f.authorize)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await f.service.claimCleanup(received.attempt.receiptId)).toBeNull();
    await f.service.completeCleanup(claim);
    await f.service.completeCleanup(claim);
    expect(f.store.receipts.get(claim.receiptId)?.state).toBe("cleaned");
  });

  it("recovers uncertain cleanup acknowledgements without ever claiming registered bytes", async () => {
    const f = fixture();
    const registered = await f.receive();
    await f.service.register("alice", f.blob, "details", f.commit, f.authorize);
    const orphan = await f.receive("alice", { ...f.blob, storageId: "orphan" });
    f.setNow(f.now() + UPLOAD_LIMITS.pendingMs);
    expect(await f.service.claimCleanup(registered.attempt.receiptId)).toBeNull();
    const first = await f.service.claimCleanup(orphan.attempt.receiptId);
    if (!first) throw new Error("Expected cleanup claim");
    f.setNow(f.now() + UPLOAD_LIMITS.cleanupLeaseMs);
    const retry = await f.service.claimCleanup(orphan.attempt.receiptId);
    if (!retry) throw new Error("Expected cleanup retry");
    expect(retry.storageId).toBe(first.storageId);
    await expect(f.service.completeCleanup(first)).rejects.toMatchObject({ code: "CONFLICT" });
    await f.service.completeCleanup(retry);
    expect(f.store.assets.size).toBe(1);
  });

  it("does not let cleanup race a successful registration or revive expired pending bytes", async () => {
    const f = fixture();
    const received = await f.receive();
    await Promise.all([f.service.register("alice", f.blob, "details", f.commit, f.authorize), f.service.claimCleanup(received.attempt.receiptId)]);
    f.setNow(f.now() + UPLOAD_LIMITS.pendingMs);
    expect(await f.service.claimCleanup(received.attempt.receiptId)).toBeNull();
    const orphan = await f.receive("alice", { ...f.blob, storageId: "expired" });
    f.setNow(f.now() + UPLOAD_LIMITS.pendingMs);
    await expect(f.service.register("alice", { ...f.blob, storageId: "expired" }, "details", f.commit, f.authorize)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(f.service.begin(orphan.capability)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects oversized or malformed trusted metadata and invalid runtime entropy", async () => {
    const f = fixture();
    const ticket = await f.service.issue("alice");
    const begun = await f.service.begin(ticket.capability);
    if (begun.state !== "receiving") throw new Error("Expected attempt");
    await expect(f.service.complete(begun.attempt, { ...f.blob, size: UPLOAD_LIMITS.bytes + 1 })).rejects.toMatchObject({ code: "LIMIT" });
    await expect(f.service.complete(begun.attempt, { ...f.blob, sha256: "not-a-hash" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(new UploadService(f.store, { ...f.runtime, createCapability: () => "weak" }).issue("alice")).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
