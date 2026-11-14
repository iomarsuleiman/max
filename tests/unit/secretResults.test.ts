import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { execute, type OpContext } from "@/lib/domain/ops";

function fixture() {
  const db = new MemoryDb();
  let minted = 0;
  const ctx: OpContext = {
    db, ownerId: "actor", now: 1000, source: "ui",
    storage: {
      createUploadUrl: async () => { minted++; return "https://upload.invalid/private-capability"; },
      getUrl: async () => null,
      remove: async () => undefined,
    },
  };
  return { db, minted: () => minted, run: (name: string, args: unknown) => db.transaction(() => execute(name, args, ctx)) };
}

describe("secret-result cache boundaries", () => {
  it.each(["tokens.create", "assets.createUploadUrl"])("rejects cached %s before creating a secret", async (name) => {
    const f = fixture();
    await expect(f.run(name, { name: "Token", idempotencyKey: "secret-retry" })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(f.minted()).toBe(0);
    expect(await f.db.list("tokens", "actor")).toEqual([]);
    expect(await f.db.list("idempotency", "actor")).toEqual([]);
    expect(f.db.snapshot()).not.toContain("private-capability");
  });

  it("rejects secret-bearing batch caching before any nested operation", async () => {
    const f = fixture();
    await expect(f.run("batch", { idempotencyKey: "batch-secret", operations: [
      { op: "pages.create", args: { title: "Must not be created" } },
      { op: "assets.createUploadUrl", args: {} },
    ] })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(f.minted()).toBe(0);
    expect(await f.db.list("pages", "actor")).toEqual([]);
    expect(await f.db.list("idempotency", "actor")).toEqual([]);
  });

  it("refuses old secret-operation and unclassified batch cache results", async () => {
    const f = fixture();
    for (const op of ["tokens.create", "assets.createUploadUrl", "batch"]) {
      await f.db.insert("idempotency", { ownerId: "actor", key: op, op, result: '{"secret":"prior-sensitive-result"}', at: 1000 });
      const args = op === "batch" ? { operations: [{ op: "pages.create", args: { title: "Fresh" } }] } : { name: "Token" };
      await expect(f.run(op, { ...args, idempotencyKey: op })).rejects.toMatchObject({ code: op === "batch" ? "CONFLICT" : "VALIDATION" });
    }
    expect(f.minted()).toBe(0);
    expect(await f.db.list("pages", "actor")).toEqual([]);
  });

  it("keeps safe batch idempotency and marks new cache provenance", async () => {
    const f = fixture();
    const args = { idempotencyKey: "safe-batch", operations: [{ op: "pages.create", args: { title: "Created once" } }] };
    const result = z.object({ results: z.array(z.object({ page: z.object({ _id: z.string() }) })), idempotentReplay: z.boolean().optional() });
    const first = result.parse(await f.run("batch", args));
    const retry = result.parse(await f.run("batch", args));
    expect(retry.results).toEqual(first.results);
    expect(retry.idempotentReplay).toBe(true);
    expect(await f.db.list("pages", "actor")).toHaveLength(1);
    expect((await f.db.list("idempotency", "actor"))[0].resultPolicyVersion).toBe(1);
  });

  it("returns an uncached token once while persisting its hash only", async () => {
    const f = fixture();
    const { secret } = z.object({ secret: z.string().startsWith("max_") }).parse(await f.run("tokens.create", { name: "Private token" }));
    expect(f.db.snapshot()).not.toContain(secret);
    expect(await f.db.list("tokens", "actor")).toHaveLength(1);
    expect(await f.db.list("idempotency", "actor")).toEqual([]);
  });
});
