import { mkdtemp, readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "__maxLocal");
});
const pageResult = z.object({ page: z.object({ _id: z.string(), title: z.string() }) });

describe("real local filesystem durability", () => {
  it("retains a durable cleanup claim after post-commit file removal fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "max-local-durable-"));
    vi.stubEnv("MAX_DATA_DIR", directory);
    const local = await import("@/lib/server/local");
    const storageId = await local.storeLocalUpload("local", new Blob(["abc"], { type: "text/plain" }));
    const { id } = z.object({ id: z.string() }).parse(await local.runLocal("assets.register", { storageId, type: "text/plain", name: "file.txt", size: 3 }, "ui"));
    const remove = vi.spyOn(local.localStorageAdapter, "remove").mockRejectedValueOnce(new Error("Synthetic filesystem failure"));
    await expect(local.runLocal("assets.remove", { id, confirm: true }, "mcp")).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("was saved") });
    const snapshot = z.object({
      assets: z.array(z.unknown()), uploadReceipts: z.array(z.object({ state: z.string() })),
      audit: z.array(z.object({ op: z.string(), ok: z.boolean() })),
    }).parse(JSON.parse(await readFile(path.join(directory, "db.json"), "utf8")));
    expect(snapshot.assets).toEqual([]);
    expect(snapshot.uploadReceipts.map((receipt) => receipt.state)).toEqual(["cleaning"]);
    expect(snapshot.audit.filter((event) => event.op === "assets.remove")).toEqual([{ op: "assets.remove", ok: true }]);
    expect(await local.readLocalFile(storageId)).not.toBeNull();
    remove.mockRestore();
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "__maxLocal");
    const restarted = await import("@/lib/server/local");
    await restarted.runLocal("assets.list", {}, "ui");
    expect(await restarted.readLocalFile(storageId)).toBeNull();
  });
  it("rolls memory back on a failed save and permits later saves after filesystem repair", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "max-local-durable-"));
    const directory = path.join(root, "data");
    await writeFile(directory, "blocked directory");
    vi.stubEnv("MAX_DATA_DIR", directory);
    const local = await import("@/lib/server/local");
    await expect(local.runLocal("pages.create", { title: "Must roll back" }, "ui")).rejects.toThrow();
    expect(await local.runLocal("pages.tree", {}, "ui")).toMatchObject({ pages: [] });
    await unlink(directory);
    const created = pageResult.parse(await local.runLocal("pages.create", { title: "Saved after repair" }, "ui"));
    const persisted = z.object({ pages: z.array(z.object({ _id: z.string() })) }).parse(JSON.parse(await readFile(path.join(directory, "db.json"), "utf8")));
    expect(persisted.pages).toHaveLength(1);
    expect(persisted.pages[0]._id).toBe(created.page._id);
  });

  it("preserves actual attachment bytes when a later batch operation rolls back", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "max-local-durable-"));
    await mkdir(path.join(root, "data"));
    vi.stubEnv("MAX_DATA_DIR", path.join(root, "data"));
    const local = await import("@/lib/server/local");
    const bytes = new Uint8Array([0, 127, 255]);
    const storageId = await local.storeLocalUpload("local", new Blob([bytes], { type: "text/plain" }));
    const registered = z
      .object({ id: z.string() })
      .parse(await local.runLocal("assets.register", { storageId, type: "text/plain", name: "file.txt", size: 3 }, "ui"));
    await expect(
      local.runLocal(
        "batch",
        {
          operations: [
            { op: "assets.remove", args: { id: registered.id, confirm: true } },
            { op: "pages.update", args: { id: "missing", title: "Fail" } },
          ],
        },
        "ui",
      ),
    ).rejects.toThrow();
    expect((await local.readLocalFile(storageId))?.body).toEqual(Buffer.from(bytes));
    expect(await local.runLocal("assets.getUrl", { id: registered.id }, "ui")).toMatchObject({ size: 3 });
    await local.runLocal("assets.remove", { id: registered.id, confirm: true }, "ui");
    expect(await local.readLocalFile(storageId)).toBeNull();
  });

  it.each([false, true])("recovers a committed file deletion after restart, file already removed: %s", async (alreadyRemoved) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "max-local-durable-"));
    vi.stubEnv("MAX_DATA_DIR", directory);
    const local = await import("@/lib/server/local");
    const storageId = await local.storeLocalUpload("local", new Blob(["abc"], { type: "text/plain" }));
    await local.runLocal("assets.register", { storageId, type: "text/plain", name: "file.txt", size: 3 }, "ui");
    const filename = path.join(directory, "db.json");
    const snapshot = z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).parse(JSON.parse(await readFile(filename, "utf8")));
    const receipt = z
      .object({
        _id: z.string(),
        id: z.string(),
        ownerId: z.string(),
        capabilityHash: z.string(),
        createdAt: z.number(),
        expiresAt: z.number(),
        blob: z.object({ storageId: z.string(), type: z.string(), size: z.number(), sha256: z.string() }),
      })
      .parse(snapshot.uploadReceipts[0]);
    snapshot.assets = [];
    snapshot.uploadReceipts = [{ ...receipt, state: "cleaning", cleanupId: "interrupted-cleanup", leaseUntil: Date.now() + 60_000 }];
    await writeFile(filename, JSON.stringify(snapshot));
    if (alreadyRemoved) await unlink(path.join(directory, "files", storageId));
    vi.resetModules();
    Reflect.deleteProperty(globalThis, "__maxLocal");
    const restarted = await import("@/lib/server/local");
    expect(await restarted.runLocal("assets.list", {}, "ui")).toMatchObject({ assets: [] });
    expect(await restarted.readLocalFile(storageId)).toBeNull();
    const recovered = z.record(z.string(), z.array(z.unknown())).parse(JSON.parse(await readFile(filename, "utf8")));
    expect(recovered.uploadReceipts).toBeUndefined();
  });
});
