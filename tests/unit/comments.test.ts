import { describe, expect, it } from "vitest";
import { setup } from "./harness";

describe("comments", () => {
  it("adds page and block comments, resolves, edits and deletes", async () => {
    const { as } = setup();
    const call = as("alice");
    const id = (await call("pages.create", { title: "Draft", markdown: "First paragraph\n\nSecond paragraph" })).page._id;
    const { blocks } = await call("documents.get", { pageId: id });
    const page = await call("comments.add", { pageId: id, body: "Check the intro" });
    const block = await call("comments.add", { pageId: id, blockId: blocks[1].id, body: "Tighten this" });
    await expect(call("comments.add", { pageId: id, blockId: "nope", body: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(call("comments.add", { pageId: id, body: "   " })).rejects.toMatchObject({ code: "VALIDATION" });
    let list = await call("comments.list", { pageId: id });
    expect(list.comments.map((c: any) => [c.body, c.blockExcerpt])).toEqual([["Check the intro", null], ["Tighten this", "Second paragraph"]]);
    await call("comments.resolve", { id: page.comment._id, resolved: true });
    await call("comments.update", { id: block.comment._id, body: "Tighten this a lot" });
    list = await call("comments.list", { pageId: id });
    expect(list).toMatchObject({ openCount: 1, resolvedCount: 1 });
    expect(list.comments.map((c: any) => c.body)).toEqual(["Tighten this a lot"]);
    await expect(call("comments.delete", { id: block.comment._id })).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    await call("comments.delete", { id: block.comment._id, confirm: true });
    expect((await call("comments.list", { pageId: id, includeResolved: true })).comments).toHaveLength(1);
  });

  it("keeps comments private", async () => {
    const { as } = setup();
    const alice = as("alice");
    const bob = as("bob");
    const id = (await alice("pages.create", { title: "Mine" })).page._id;
    const c = await alice("comments.add", { pageId: id, body: "secret note" });
    await expect(bob("comments.list", { pageId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bob("comments.update", { id: c.comment._id, body: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("column calculations", () => {
  it("computes footer calculations over all matching rows", async () => {
    const { as } = setup();
    const call = as("alice");
    const dbId = (await call("databases.create", { title: "Sales" })).database._id;
    const amount = (await call("properties.add", { databaseId: dbId, name: "Amount", type: "number" })).property.id;
    const paid = (await call("properties.add", { databaseId: dbId, name: "Paid", type: "checkbox" })).property.id;
    for (const [n, a, p] of [["A", 10, true], ["B", 30, false], ["C", 20, true], ["D", null, false]] as const) await call("records.create", { databaseId: dbId, values: { Name: n, Amount: a, Paid: p } });
    const { views } = await call("databases.get", { databaseId: dbId });
    await call("views.update", { databaseId: dbId, viewId: views[0].id, patch: { calculations: { [amount]: "sum", [paid]: "percent_checked", title: "count_all" } } });
    const res = await call("databases.query", { databaseId: dbId, viewId: views[0].id, limit: 2 });
    expect(res.records).toHaveLength(2);
    expect(res.calculations).toEqual({ [amount]: 60, [paid]: 50, title: 4 });
  });
});
