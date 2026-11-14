import { mkdtemp, readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "__maxLocal");
});
const pageResult = z.object({ page: z.object({ _id: z.string(), title: z.string() }) });

describe("real local filesystem durability", () => {
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
    const storageId = await local.saveLocalFile(bytes.buffer, "text/plain");
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
});
