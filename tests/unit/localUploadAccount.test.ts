import { describe, expect, it } from "vitest";
import type { Storage } from "@/lib/domain/db";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { createPersonalDb } from "@/lib/domain/collaboration/personalDb";
import { localUploadStore } from "@/lib/domain/localUploadStore";
import { deleteLocalOwnerUploads, preflightLocalUploadDeletion, LOCAL_ACCOUNT_UPLOAD_LIMIT } from "@/lib/domain/localUploadAccount";
import type { UploadReceipt } from "@/lib/domain/uploads";
import { newPageRow } from "@/lib/domain/ops/helpers";

async function fixture() {
  const db = new MemoryDb();
  const personal = createPersonalDb({ db, ownerId: "alice" });
  const files = new Map<string, { bytes: Uint8Array; type: string }>();
  const staged: string[] = [];
  let sequence = 0;
  const readMetadata = async (id: string) => {
    const file = files.get(id);
    if (!file) return null;
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(file.bytes));
    return { size: file.bytes.byteLength, type: file.type, sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("") };
  };
  const storage: Storage = {
    createUploadUrl: async () => "unused",
    getUrl: async () => null,
    remove: async (id) => {
      staged.push(id);
    },
  };
  const write = async <T>(run: () => Promise<T>): Promise<T> => {
    const before = [...staged];
    try {
      return await db.transaction(run);
    } catch (error) {
      staged.splice(0, staged.length, ...before);
      throw error;
    }
  };
  const seed = async (ownerId = "alice", registered = false) => {
    const index = ++sequence;
    const storageId = `file${index.toString().padStart(8, "0")}`;
    files.set(storageId, { bytes: new TextEncoder().encode(`actual bytes ${index}`), type: "text/plain" });
    const metadata = await readMetadata(storageId);
    if (!metadata) throw new Error("Missing file");
    const blob = { storageId, ...metadata };
    const identity = { id: `receipt-${index}`, ownerId, capabilityHash: index.toString(16).padStart(64, "0"), createdAt: 1, expiresAt: 1000 };
    const assetId = registered
      ? await db.insert("assets", { ownerId, pageId: null, storageId, name: "a.txt", type: blob.type, size: blob.size, alt: "", createdAt: 1 })
      : null;
    const receipt: UploadReceipt = assetId
      ? { ...identity, state: "registered", blob, receivedByAttemptId: "attempt", assetId, registrationKey: "details", registeredAt: 2 }
      : { ...identity, state: "stored", blob, receivedByAttemptId: "attempt", storedAt: 2, registerUntil: 1000 };
    await localUploadStore(db).transaction((tx) => tx.insert(receipt));
    return { receipt, storageId, blob, assetId };
  };
  return { db, personal, files, staged, readMetadata, storage, write, seed };
}

describe("local account upload cleanup", () => {
  it("preflights real byte metadata, invalidates tickets and stages deletion without unlinking files", async () => {
    const f = await fixture();
    const pending = await f.seed();
    const registered = await f.seed("alice", true);
    await localUploadStore(f.db).transaction(async (tx) => {
      await tx.insert({ id: "issued", ownerId: "alice", capabilityHash: "e".repeat(64), createdAt: 1, expiresAt: 1000, state: "issued" });
      await tx.insert({
        id: "receiving",
        ownerId: "alice",
        capabilityHash: "f".repeat(64),
        createdAt: 1,
        expiresAt: 1000,
        state: "receiving",
        attemptId: "attempt",
        leaseUntil: 1000,
      });
    });
    await preflightLocalUploadDeletion(f.db, f.personal, "alice", f.readMetadata);
    expect(f.staged).toEqual([]);
    await f.write(async () => {
      if (!registered.assetId) throw new Error("Expected asset");
      await f.db.delete("assets", registered.assetId);
      await deleteLocalOwnerUploads(f.db, f.personal, "alice", f.readMetadata, f.storage);
    });
    expect(await f.db.list("uploadReceipts", "alice")).toEqual([]);
    expect(f.staged).toEqual([pending.storageId, registered.storageId]);
    expect(f.files.size).toBe(2);
    await f.write(() => deleteLocalOwnerUploads(f.db, f.personal, "alice", f.readMetadata, f.storage));
    expect(f.staged).toHaveLength(2);
  });

  it.each(["foreign reference", "shared reference", "unresolved reference", "duplicate id", "duplicate hash", "duplicate blob", "metadata mismatch"])(
    "denies %s before any cleanup changes",
    async (problem) => {
      const f = await fixture();
      const owned = await f.seed();
      if (problem.startsWith("duplicate")) {
        const duplicate: UploadReceipt = {
          ...owned.receipt,
          id: problem === "duplicate id" ? owned.receipt.id : "foreign",
          ownerId: "bob",
          capabilityHash: problem === "duplicate hash" ? owned.receipt.capabilityHash : "d".repeat(64),
          state: "stored",
          blob: { ...owned.blob, storageId: problem === "duplicate blob" ? owned.storageId : "differentfile" },
          receivedByAttemptId: "foreign-attempt",
          storedAt: 2,
          registerUntil: 1000,
        };
        await f.db.insert("uploadReceipts", duplicate);
      } else if (problem === "metadata mismatch") {
        f.files.set(owned.storageId, { bytes: new TextEncoder().encode("tampered"), type: "text/plain" });
      } else {
        const ownerId = problem === "foreign reference" ? "bob" : "alice";
        let pageId: string | null = null;
        if (problem !== "foreign reference") {
          pageId = await f.db.insert(
            "pages",
            newPageRow(
              { db: f.db, storage: null, ownerId, now: 1, source: "ui" },
              { rank: "a", ...(problem === "shared reference" ? { workspaceId: "organization" } : {}) },
            ),
          );
          if (problem === "unresolved reference") await f.db.delete("pages", pageId);
        }
        await f.db.insert("assets", {
          ownerId,
          pageId,
          storageId: owned.storageId,
          name: "ref.txt",
          type: owned.blob.type,
          size: owned.blob.size,
          alt: "",
          createdAt: 1,
        });
      }
      const before = f.db.snapshot();
      await expect(preflightLocalUploadDeletion(f.db, f.personal, "alice", f.readMetadata)).rejects.toMatchObject({
        code: problem.startsWith("duplicate") ? "INTERNAL" : "CONFLICT",
      });
      await expect(f.write(() => deleteLocalOwnerUploads(f.db, f.personal, "alice", f.readMetadata, f.storage))).rejects.toBeDefined();
      expect(f.db.snapshot()).toBe(before);
      expect(f.staged).toEqual([]);
      expect(f.files.has(owned.storageId)).toBe(true);
    },
  );

  it("allows missing registered bytes only after their asset was removed, and rejects missing pending bytes", async () => {
    const f = await fixture();
    const registered = await f.seed("alice", true);
    f.files.delete(registered.storageId);
    await expect(preflightLocalUploadDeletion(f.db, f.personal, "alice", f.readMetadata)).rejects.toMatchObject({ code: "CONFLICT" });
    if (!registered.assetId) throw new Error("Expected asset");
    await f.db.delete("assets", registered.assetId);
    await f.write(() => deleteLocalOwnerUploads(f.db, f.personal, "alice", f.readMetadata, f.storage));
    expect(f.staged).toEqual([]);
    const pending = await f.seed();
    f.files.delete(pending.storageId);
    await expect(preflightLocalUploadDeletion(f.db, f.personal, "alice", f.readMetadata)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("accepts cleaned missing files but refuses cleaned receipts whose bytes reappear", async () => {
    const f = await fixture();
    const owned = await f.seed();
    await localUploadStore(f.db).transaction((tx) =>
      tx.put({
        id: owned.receipt.id,
        ownerId: "alice",
        capabilityHash: owned.receipt.capabilityHash,
        createdAt: 1,
        expiresAt: 1000,
        state: "cleaned",
        blob: owned.blob,
        cleanedAt: 3,
      }),
    );
    await expect(preflightLocalUploadDeletion(f.db, f.personal, "alice", f.readMetadata)).rejects.toMatchObject({ code: "CONFLICT" });
    f.files.delete(owned.storageId);
    await f.write(() => deleteLocalOwnerUploads(f.db, f.personal, "alice", f.readMetadata, f.storage));
    expect(await f.db.list("uploadReceipts", "alice")).toEqual([]);
    expect(f.staged).toEqual([]);
  });

  it("rolls receipt removal and staged cleanup back after a later outer transaction failure", async () => {
    const f = await fixture();
    const owned = await f.seed();
    const before = f.db.snapshot();
    await expect(
      f.write(async () => {
        await deleteLocalOwnerUploads(f.db, f.personal, "alice", f.readMetadata, f.storage);
        throw new Error("Later failure");
      }),
    ).rejects.toThrow("Later failure");
    expect(f.db.snapshot()).toBe(before);
    expect(f.staged).toEqual([]);
    expect(f.files.has(owned.storageId)).toBe(true);
  });

  it("checks every receipt before staging an earlier valid file", async () => {
    const f = await fixture();
    await f.seed();
    const later = await f.seed();
    f.files.set(later.storageId, { bytes: new TextEncoder().encode("corruption"), type: "text/plain" });
    const before = f.db.snapshot();
    await expect(f.write(() => deleteLocalOwnerUploads(f.db, f.personal, "alice", f.readMetadata, f.storage))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.staged).toEqual([]);
    expect(f.db.snapshot()).toBe(before);
  });

  it("fails on owner receipt overflow or global reference overflow without staging files", async () => {
    const f = await fixture();
    for (let index = 0; index <= LOCAL_ACCOUNT_UPLOAD_LIMIT; index++)
      await f.db.insert("uploadReceipts", {
        id: `issued-${index}`,
        ownerId: "alice",
        capabilityHash: index.toString(16).padStart(64, "0"),
        createdAt: 1,
        expiresAt: 2,
        state: "issued",
      });
    await expect(preflightLocalUploadDeletion(f.db, f.personal, "alice", f.readMetadata)).rejects.toMatchObject({ code: "LIMIT" });
    const references = await fixture();
    const owned = await references.seed();
    for (let index = 0; index <= LOCAL_ACCOUNT_UPLOAD_LIMIT; index++)
      await references.db.insert("assets", {
        ownerId: "alice",
        pageId: null,
        storageId: owned.storageId,
        name: "a.txt",
        type: owned.blob.type,
        size: owned.blob.size,
        alt: "",
        createdAt: 1,
      });
    await expect(preflightLocalUploadDeletion(references.db, references.personal, "alice", references.readMetadata)).rejects.toMatchObject({ code: "LIMIT" });
    expect(f.staged).toEqual([]);
    expect(references.staged).toEqual([]);
  });

  it("preserves another owner's receipts and rejects a registered receipt pointing to their asset", async () => {
    const f = await fixture();
    const owned = await f.seed("alice", true);
    await f.seed("bob");
    if (!owned.assetId) throw new Error("Expected asset");
    await f.db.patch("assets", owned.assetId, { ownerId: "bob" });
    await expect(preflightLocalUploadDeletion(f.db, f.personal, "alice", f.readMetadata)).rejects.toMatchObject({ code: "CONFLICT" });
    await f.db.patch("assets", owned.assetId, { ownerId: "alice" });
    await f.write(() => deleteLocalOwnerUploads(f.db, f.personal, "alice", f.readMetadata, f.storage));
    expect(await f.db.list("uploadReceipts", "bob")).toHaveLength(1);
    expect(f.staged).toEqual([owned.storageId]);
  });
});
