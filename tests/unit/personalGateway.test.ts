import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import schema from "@/convex/schema";
import { convexDb } from "@/convex/convexDb";
import { newPageRow } from "@/lib/domain/ops/helpers";

const modules = {
  "../../convex/_generated/server.ts": async () => ({}),
  "../../convex/ops.ts": () => import("@/convex/ops"),
};
const query = makeFunctionReference<"query">("ops:query");
const mutation = makeFunctionReference<"mutation">("ops:mutation");

describe("authenticated legacy personal gateway", () => {
  it("blocks creator-owned organization pages before reads, writes and account deletion", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "alice" });
    const id = await t.run(async (ctx) => ctx.db.insert("pages", {
      ...newPageRow({ db: convexDb(ctx.db), storage: null, ownerId: "alice", now: 1, source: "ui" }, { rank: "a", title: "Shared secret" }),
      workspaceId: "organization",
    }));
    await expect(signedIn.query(query, { op: "pages.get", args: { id } })).rejects.toThrow();
    await expect(signedIn.mutation(mutation, { op: "pages.update", args: { id, title: "Overwrite" } })).rejects.toThrow();
    await expect(signedIn.mutation(mutation, { op: "account.deleteAllData", args: { confirm: true } })).rejects.toThrow();
    await expect(signedIn.mutation(mutation, { op: "batch", args: { operations: [{ op: "account.deleteAllData", args: { confirm: true } }] } })).rejects.toThrow();
    expect(await signedIn.query(query, { op: "pages.tree", args: {} })).toMatchObject({ pages: [] });
    expect(await t.run((ctx) => ctx.db.get(id))).toMatchObject({ title: "Shared secret", workspaceId: "organization" });
  });

  it("preserves unscoped personal creation and authenticated reads", async () => {
    const t = convexTest(schema, modules);
    const signedIn = t.withIdentity({ subject: "alice" });
    await signedIn.mutation(mutation, { op: "pages.create", args: { title: "Personal" } });
    expect(await signedIn.query(query, { op: "pages.tree", args: {} })).toMatchObject({ pages: [{ title: "Personal" }] });
    expect(await t.withIdentity({ subject: "bob" }).query(query, { op: "pages.tree", args: {} })).toMatchObject({ pages: [] });
  });
});
