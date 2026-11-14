import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import schema from "@/convex/schema";

const modules = {
  "../../convex/_generated/server.ts": async () => ({}),
  "../../convex/http.ts": () => import("@/convex/http"),
  "../../convex/uploadHttp.ts": () => import("@/convex/uploadHttp"),
  "../../convex/uploadActions.ts": () => import("@/convex/uploadActions"),
  "../../convex/uploadMutations.ts": () => import("@/convex/uploadMutations"),
  "../../convex/ops.ts": () => import("@/convex/ops"),
};
const start = makeFunctionReference<"action">("uploadActions:start");
const mutation = makeFunctionReference<"mutation">("ops:mutation");
const query = makeFunctionReference<"query">("ops:query");
const uploadResult = z.object({ uploadUrl: z.string(), expiresAt: z.number() });
const storedResult = z.object({ storageId: z.string() });
const registeredResult = z.object({ id: z.string(), url: z.string() });
afterEach(() => vi.unstubAllEnvs());

describe("authenticated cloud upload gateway", () => {
  it("binds received bytes to the authenticated uploader and consumes registration once", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://upload-fixture.convex.site");
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const bob = t.withIdentity({ subject: "bob" });
    const ticket = uploadResult.parse(await alice.action(start, {}));
    const path = new URL(ticket.uploadUrl).pathname + new URL(ticket.uploadUrl).search;
    const response = await t.fetch(path, { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" });
    expect(response.status, await response.clone().text()).toBe(200);
    const { storageId } = storedResult.parse(await response.json());
    const input = { storageId, name: "hello.txt", type: "text/plain", size: 5 };
    await expect(bob.mutation(mutation, { op: "assets.register", args: input })).rejects.toThrow();
    await expect(alice.mutation(mutation, { op: "assets.register", args: { ...input, size: 4 } })).rejects.toThrow();
    const registered = registeredResult.parse(await alice.mutation(mutation, { op: "assets.register", args: input }));
    expect(registeredResult.parse(await alice.mutation(mutation, { op: "assets.register", args: input }))).toEqual(registered);
    await expect(alice.mutation(mutation, { op: "assets.register", args: { ...input, name: "different.txt" } })).rejects.toThrow();
    expect(await alice.query(query, { op: "assets.getUrl", args: { id: registered.id } })).toMatchObject({ size: 5, type: "text/plain" });
    const repeat = await t.fetch(path, { method: "POST", headers: { "content-type": "text/plain" }, body: "different" });
    expect(storedResult.parse(await repeat.json()).storageId).toBe(storageId);
    expect(await t.run((ctx) => ctx.db.query("assets").take(2))).toHaveLength(1);
  });

  it("denies unauthenticated starts, arbitrary storage claims and legacy raw URL creation", async () => {
    const t = convexTest(schema, modules);
    await expect(t.action(start, {})).rejects.toThrow();
    const alice = t.withIdentity({ subject: "alice" });
    await expect(alice.mutation(mutation, { op: "assets.createUploadUrl", args: {} })).rejects.toThrow();
    await expect(alice.mutation(mutation, { op: "batch", args: { operations: [{ op: "assets.createUploadUrl", args: {} }] } })).rejects.toThrow();
    await expect(
      alice.mutation(mutation, { op: "assets.register", args: { storageId: "unowned", type: "text/plain", size: 1, name: "claim.txt" } }),
    ).rejects.toThrow();
    expect((await t.fetch("/uploads?capability=invalid", { method: "POST", body: "a" })).status).toBe(404);
    expect((await t.fetch(`/uploads?capability=max-upload-v1.${"a".repeat(64)}`, { method: "POST", body: "a" })).status).toBe(404);
  });

  it("preserves HTTP expiry and lease-conflict errors across internal mutation boundaries", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://upload-fixture.convex.site");
    const t = convexTest(schema, modules);
    const ticket = uploadResult.parse(await t.withIdentity({ subject: "alice" }).action(start, {}));
    const url = new URL(ticket.uploadUrl);
    const path = url.pathname + url.search;
    await t.run(async (ctx) => {
      const receipt = await ctx.db.query("uploadReceipts").take(1);
      await ctx.db.replace(receipt[0]._id, {
        logicalId: receipt[0].logicalId,
        ownerId: receipt[0].ownerId,
        capabilityHash: receipt[0].capabilityHash,
        createdAt: receipt[0].createdAt,
        expiresAt: receipt[0].expiresAt,
        state: "receiving",
        attemptId: "existing-attempt",
        leaseUntil: Date.now() + 60_000,
      });
    });
    expect((await t.fetch(path, { method: "POST", body: "a" })).status).toBe(409);
    await t.run(async (ctx) => {
      const receipt = await ctx.db.query("uploadReceipts").take(1);
      await ctx.db.patch(receipt[0]._id, { expiresAt: Date.now() - 1 });
    });
    expect((await t.fetch(path, { method: "POST", body: "a" })).status).toBe(404);
  });

  it("invalidates outstanding upload tickets and connector state during a batched account wipe", async () => {
    vi.stubEnv("CONVEX_SITE_URL", "https://upload-fixture.convex.site");
    const t = convexTest(schema, modules);
    const alice = t.withIdentity({ subject: "alice" });
    const ticket = uploadResult.parse(await alice.action(start, {}));
    await t.run((ctx) => ctx.db.insert("notionConnections", {
      ownerId: "alice", workspaceId: "provider-workspace", workspaceName: "Fixture", encryptedToken: "synthetic", connectedAt: 1,
    }));
    await alice.mutation(mutation, { op: "batch", args: { operations: [{ op: "account.deleteAllData", args: { confirm: true } }] } });
    const url = new URL(ticket.uploadUrl);
    expect((await t.fetch(url.pathname + url.search, { method: "POST", headers: { "content-type": "text/plain" }, body: "a" })).status).toBe(404);
    expect(await t.run((ctx) => ctx.db.query("uploadReceipts").take(1))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("notionConnections").take(1))).toEqual([]);
  });
});
