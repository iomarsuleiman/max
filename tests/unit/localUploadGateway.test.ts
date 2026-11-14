import { mkdtemp, mkdir, readFile, readdir, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("server-only", () => ({}));

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "__maxLocal");
  for (const root of roots.splice(0)) {
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(root));
    if (relative.startsWith("..") || path.isAbsolute(relative) || !path.basename(root).startsWith("max-local-upload-gateway-"))
      throw new Error("Unsafe test cleanup target");
    await rm(root, { recursive: true, force: true });
  }
});

const ticketSchema = z.object({ uploadUrl: z.string() });
const receivedSchema = z.object({ storageId: z.string() });
const assetSchema = z.object({ id: z.string(), url: z.string() });
const snapshotSchema = z.object({
  assets: z.array(z.object({ _id: z.string(), ownerId: z.string(), storageId: z.string() })),
  uploadReceipts: z.array(z.object({ ownerId: z.string(), state: z.string(), blob: z.object({ storageId: z.string() }).optional() })),
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "max-local-upload-gateway-"));
  roots.push(root);
  const data = path.join(root, "data");
  await mkdir(data);
  vi.stubEnv("MAX_DATA_DIR", data);
  vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
  vi.stubEnv("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY", "");
  vi.resetModules();
  Reflect.deleteProperty(globalThis, "__maxLocal");
  const local = await import("@/lib/server/local");
  const route = await import("@/app/api/local/upload/route");
  const bytes = new Uint8Array([0, 127, 128, 255, 10]);
  const upload = async (url: string, body = bytes) => {
    const response = await route.POST(new Request(new URL(url, "http://localhost"), { method: "POST", headers: { "content-type": "text/plain" }, body }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    return receivedSchema.parse(await response.json()).storageId;
  };
  const ticket = ticketSchema.parse(await local.runLocal("assets.createUploadUrl", {}, "ui", "alice"));
  return { root, data, local, route, bytes, ticket, upload };
}

describe("real local owner-bound upload gateway", () => {
  it("receives through the actual route, survives restart and atomically consumes the owner's receipt", async () => {
    const f = await fixture();
    const storageId = await f.upload(f.ticket.uploadUrl);
    expect(await f.upload(f.ticket.uploadUrl, new Uint8Array([9]))).toBe(storageId);
    expect((await f.local.readLocalFile(storageId))?.body).toEqual(Buffer.from(f.bytes));
    const initial = snapshotSchema.parse(JSON.parse(await readFile(path.join(f.data, "db.json"), "utf8")));
    expect(initial.assets).toEqual([]);
    expect(initial.uploadReceipts).toMatchObject([{ ownerId: "alice", state: "stored", blob: { storageId } }]);

    vi.resetModules();
    Reflect.deleteProperty(globalThis, "__maxLocal");
    const local = await import("@/lib/server/local");
    const route = await import("@/app/api/local/upload/route");
    const replay = await route.POST(
      new Request(new URL(f.ticket.uploadUrl, "http://localhost"), {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "different replay bytes",
      }),
    );
    expect(replay.status).toBe(200);
    expect(receivedSchema.parse(await replay.json()).storageId).toBe(storageId);

    const args = { storageId, name: "bilingual.txt", type: "text/plain", size: f.bytes.length };
    await expect(local.runLocal("assets.register", args, "ui", "bob")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(local.runLocal("assets.register", { ...args, size: f.bytes.length + 1 }, "ui", "alice")).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(local.runLocal("assets.register", { ...args, type: "image/png" }, "ui", "alice")).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await local.runLocal("assets.list", {}, "ui", "alice")).toMatchObject({ assets: [] });

    const [firstResult, secondResult] = await Promise.all([
      local.runLocal("assets.register", args, "ui", "alice"),
      local.runLocal("assets.register", args, "ui", "alice"),
    ]);
    const registered = assetSchema.parse(firstResult);
    const repeated = assetSchema.parse(secondResult);
    expect(repeated).toEqual(registered);
    const persisted = snapshotSchema.parse(JSON.parse(await readFile(path.join(f.data, "db.json"), "utf8")));
    expect(persisted.assets).toEqual([{ _id: registered.id, ownerId: "alice", storageId }]);
    expect(persisted.uploadReceipts).toMatchObject([{ ownerId: "alice", state: "registered", blob: { storageId } }]);
    expect((await readdir(path.join(f.data, "files"))).sort()).toEqual([storageId, `${storageId}.type`].sort());
    expect((await local.readLocalFile(storageId))?.body).toEqual(Buffer.from(f.bytes));
  });

  it("refuses capabilityless requests and arbitrary legacy storage IDs without deleting bytes", async () => {
    const f = await fixture();
    const before = await readFile(path.join(f.data, "db.json"), "utf8");
    const response = await f.route.POST(
      new Request("http://localhost/api/local/upload", { method: "POST", headers: { "content-type": "text/plain" }, body: "unowned" }),
    );
    expect(response.status).toBe(404);
    expect(await readFile(path.join(f.data, "db.json"), "utf8")).toBe(before);
    const storageId = await f.local.saveLocalFile(new Uint8Array([1, 2, 3]).buffer, "text/plain");
    await expect(f.local.runLocal("assets.register", { storageId, name: "legacy.txt", type: "text/plain", size: 3 }, "ui", "alice")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await f.local.readLocalFile(storageId))?.body).toEqual(Buffer.from([1, 2, 3]));
    expect(await f.local.runLocal("assets.list", {}, "ui", "alice")).toMatchObject({ assets: [] });
  });

  it("rolls asset and receipt consumption back on persistence failure and retries after filesystem repair", async () => {
    const f = await fixture();
    const storageId = await f.upload(f.ticket.uploadUrl);
    const file = path.join(f.data, "db.json");
    const before = await readFile(file, "utf8");
    const fault = `${file}.${process.pid}.tmp`;
    await mkdir(fault);
    const args = { storageId, name: "durable.txt", type: "text/plain", size: f.bytes.length };
    await expect(f.local.runLocal("assets.register", args, "ui", "alice")).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await f.local.runLocal("assets.list", {}, "ui", "alice")).toMatchObject({ assets: [] });
    expect((await f.local.readLocalFile(storageId))?.body).toEqual(Buffer.from(f.bytes));
    expect(snapshotSchema.parse(JSON.parse(before)).uploadReceipts).toMatchObject([{ ownerId: "alice", state: "stored" }]);
    // The injected fault is an empty directory, not a recursive deletion target.
    await rmdir(fault);
    const registered = assetSchema.parse(await f.local.runLocal("assets.register", args, "ui", "alice"));
    const after = snapshotSchema.parse(JSON.parse(await readFile(file, "utf8")));
    expect(after.assets).toEqual([{ _id: registered.id, ownerId: "alice", storageId }]);
    expect(after.uploadReceipts).toMatchObject([{ ownerId: "alice", state: "registered" }]);
    expect((await f.local.readLocalFile(storageId))?.body).toEqual(Buffer.from(f.bytes));
  });
});
