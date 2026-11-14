import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { convexDb, convexStorage } from "@/convex/convexDb";
import { retireNativeFiles, NATIVE_FILE_CLEANUP_LIMIT } from "@/convex/fileCleanup";
import { createPersonalDb } from "@/lib/domain/collaboration/personalDb";
import { newPageRow } from "@/lib/domain/ops/helpers";
import type { Storage } from "@/lib/domain/db";

function fixture() {
  const t = convexTest(schema, { "../../convex/_generated/server.ts": async () => ({}) });
  let sequence = 0;
  const seed = (state: "registered" | "stored" | "none" = "registered") =>
    t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob([`native-cleanup-${++sequence}`], { type: "text/plain" }));
      const metadata = await ctx.db.system.get(storageId);
      if (!metadata) throw new Error("Missing native storage metadata");
      const blob = {
        storageId,
        type: "text/plain",
        size: metadata.size,
        sha256: Array.from(atob(metadata.sha256), (byte) => byte.charCodeAt(0).toString(16).padStart(2, "0")).join(""),
      };
      const assetId = await ctx.db.insert("assets", {
        ownerId: "alice",
        pageId: null,
        storageId,
        name: "file.txt",
        type: blob.type,
        size: blob.size,
        alt: "",
        createdAt: 1000,
      });
      const identity = {
        logicalId: `receipt-${sequence}`,
        ownerId: "alice",
        capabilityHash: sequence.toString(16).padStart(64, "0"),
        createdAt: 1000,
        expiresAt: 2000,
      };
      const receiptId =
        state === "none"
          ? null
          : await ctx.db.insert(
              "uploadReceipts",
              state === "registered"
                ? { ...identity, state, blob, receivedByAttemptId: "attempt", assetId, registrationKey: "details", registeredAt: 1000 }
                : { ...identity, state, blob, receivedByAttemptId: "attempt", storedAt: 1000, registerUntil: 2000 },
            );
      return { storageId, assetId, receiptId, blob, identity };
    });
  return { t, seed };
}

describe("atomic native file retirement", () => {
  it("removes explicitly deleted attachment bytes and their registered receipt atomically", async () => {
    const f = fixture();
    const file = await f.seed();
    await f.t.run(async (ctx) => {
      await ctx.db.delete(file.assetId);
      await retireNativeFiles(ctx.db, createPersonalDb({ db: convexDb(ctx.db), ownerId: "alice" }), "alice", [file.storageId], convexStorage(ctx.storage));
    });
    expect(await f.t.run((ctx) => ctx.db.system.get(file.storageId))).toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(1))).toEqual([]);
  });

  it("rolls physical bytes, receipt and attachment rows back after a later mutation failure", async () => {
    const f = fixture();
    const file = await f.seed();
    await expect(
      f.t.run(async (ctx) => {
        await ctx.db.delete(file.assetId);
        await retireNativeFiles(ctx.db, createPersonalDb({ db: convexDb(ctx.db), ownerId: "alice" }), "alice", [file.storageId], convexStorage(ctx.storage));
        throw new Error("later failure");
      }),
    ).rejects.toThrow("later failure");
    expect(await f.t.run((ctx) => ctx.db.system.get(file.storageId))).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(file.assetId))).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(1))).toHaveLength(1);
  });

  it("retains referenced personal bytes and purges only an obsolete registered receipt", async () => {
    const f = fixture();
    const file = await f.seed();
    const other = await f.t.run(async (ctx) => {
      const row = await ctx.db.get(file.assetId);
      if (!row) throw new Error("Expected attachment");
      const { _id: _native, _creationTime: _at, ...asset } = row;
      return ctx.db.insert("assets", asset);
    });
    await f.t.run(async (ctx) => {
      const personal = createPersonalDb({ db: convexDb(ctx.db), ownerId: "alice" });
      await retireNativeFiles(ctx.db, personal, "alice", [file.storageId], convexStorage(ctx.storage));
      expect(await ctx.db.query("uploadReceipts").take(1)).toHaveLength(1);
      await ctx.db.delete(file.assetId);
      await retireNativeFiles(ctx.db, personal, "alice", [file.storageId], convexStorage(ctx.storage));
    });
    expect(await f.t.run((ctx) => ctx.db.system.get(file.storageId))).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.get(other))).not.toBeNull();
    expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(1))).toEqual([]);
  });

  it("rejects foreign and mixed-workspace references before any storage removal", async () => {
    for (const mixed of [false, true]) {
      const f = fixture();
      const file = await f.seed();
      const removed: string[] = [];
      await expect(
        f.t.run(async (ctx) => {
          const db = convexDb(ctx.db);
          const pageId = mixed
            ? await ctx.db.insert("pages", {
                ...newPageRow({ db, storage: null, ownerId: "alice", now: 1000, source: "ui" }, { rank: "a" }),
                workspaceId: "organization",
              })
            : null;
          await ctx.db.insert("assets", {
            ownerId: mixed ? "alice" : "bob",
            pageId,
            storageId: file.storageId,
            name: "ref",
            type: file.blob.type,
            size: file.blob.size,
            alt: "",
            createdAt: 1000,
          });
          await ctx.db.delete(file.assetId);
          const storage: Storage = {
            ...convexStorage(ctx.storage),
            remove: async (id) => {
              removed.push(id);
            },
          };
          await retireNativeFiles(ctx.db, createPersonalDb({ db, ownerId: "alice" }), "alice", [file.storageId], storage);
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(removed).toEqual([]);
      expect(await f.t.run((ctx) => ctx.db.system.get(file.storageId))).not.toBeNull();
    }
  });

  it("validates the entire selection before attempting the first storage deletion", async () => {
    const f = fixture();
    const first = await f.seed();
    const second = await f.seed();
    const removed: string[] = [];
    await expect(
      f.t.run(async (ctx) => {
        if (!second.receiptId) throw new Error("Expected receipt");
        await ctx.db.patch(second.receiptId, { blob: { ...second.blob, sha256: "f".repeat(64) } });
        await ctx.db.delete(first.assetId);
        await ctx.db.delete(second.assetId);
        await retireNativeFiles(ctx.db, createPersonalDb({ db: convexDb(ctx.db), ownerId: "alice" }), "alice", [first.storageId, second.storageId], {
          ...convexStorage(ctx.storage),
          remove: async (id) => {
            removed.push(id);
          },
        });
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(removed).toEqual([]);
  });

  it("fails closed on duplicate receipt indexes and foreign receipt ownership", async () => {
    for (const duplicate of [false, true]) {
      const f = fixture();
      const file = await f.seed();
      await expect(
        f.t.run(async (ctx) => {
          if (!file.receiptId) throw new Error("Expected receipt");
          if (duplicate) {
            const row = await ctx.db.get(file.receiptId);
            if (!row) throw new Error("Missing receipt");
            const { _id: _native, _creationTime: _at, ...data } = row;
            await ctx.db.insert("uploadReceipts", data);
          } else await ctx.db.patch(file.receiptId, { ownerId: "bob" });
          await ctx.db.delete(file.assetId);
          await retireNativeFiles(ctx.db, createPersonalDb({ db: convexDb(ctx.db), ownerId: "alice" }), "alice", [file.storageId], convexStorage(ctx.storage));
        }),
      ).rejects.toMatchObject({ code: duplicate ? "INTERNAL" : "CONFLICT" });
      expect(await f.t.run((ctx) => ctx.db.system.get(file.storageId))).not.toBeNull();
    }
  });

  it("supports pending receipts, legacy bytes and idempotently absent files", async () => {
    for (const state of ["stored", "none"] as const) {
      const f = fixture();
      const file = await f.seed(state);
      await f.t.run(async (ctx) => {
        await ctx.db.delete(file.assetId);
        const personal = createPersonalDb({ db: convexDb(ctx.db), ownerId: "alice" });
        await retireNativeFiles(ctx.db, personal, "alice", [file.storageId], convexStorage(ctx.storage));
        await retireNativeFiles(ctx.db, personal, "alice", [file.storageId], convexStorage(ctx.storage));
      });
      expect(await f.t.run((ctx) => ctx.db.system.get(file.storageId))).toBeNull();
      expect(await f.t.run((ctx) => ctx.db.query("uploadReceipts").take(1))).toEqual([]);
    }
  });

  it("does not scan or block on more than one thousand unrelated historical receipts", async () => {
    const f = fixture();
    const file = await f.seed();
    for (let start = 0; start < 1001; start += 500)
      await f.t.run(async (ctx) => {
        for (let index = start; index < Math.min(1001, start + 500); index++)
          await ctx.db.insert("uploadReceipts", {
            logicalId: `history-${index}`,
            ownerId: "alice",
            capabilityHash: (index + 10000).toString(16).padStart(64, "0"),
            createdAt: 1000,
            expiresAt: 2000,
            state: "issued",
          });
      });
    await f.t.run(async (ctx) => {
      await ctx.db.delete(file.assetId);
      await retireNativeFiles(ctx.db, createPersonalDb({ db: convexDb(ctx.db), ownerId: "alice" }), "alice", [file.storageId], convexStorage(ctx.storage));
    });
    expect(await f.t.run((ctx) => ctx.db.system.get(file.storageId))).toBeNull();
  });

  it("rejects malformed IDs and selected-file overflow before writes", async () => {
    const f = fixture();
    const file = await f.seed();
    for (const ids of [["invalid"], Array.from({ length: NATIVE_FILE_CLEANUP_LIMIT + 1 }, () => file.storageId)])
      await expect(
        f.t.run((ctx) => retireNativeFiles(ctx.db, createPersonalDb({ db: convexDb(ctx.db), ownerId: "alice" }), "alice", ids, convexStorage(ctx.storage))),
      ).rejects.toMatchObject({ code: ids.length === 1 ? "CONFLICT" : "LIMIT" });
    expect(await f.t.run((ctx) => ctx.db.system.get(file.storageId))).not.toBeNull();
  });
});
