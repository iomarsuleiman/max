import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { MAX_VERSIONS_PER_PAGE, VERSION_INTERVAL_MS } from "@/lib/domain/ops/versions";

const para = (text: string) => [{ type: "paragraph", content: text }];

async function edit(call: (op: string, args?: Record<string, unknown>) => Promise<any>, pageId: string, text: string) {
  const doc = await call("documents.get", { pageId });
  return call("documents.save", { pageId, blocks: para(text), baseRevision: doc.revision });
}

describe("page history", () => {
  it("keeps earlier states at most every 10 minutes while typing", async () => {
    const { as, advance } = setup();
    const call = as("alice");
    const id = (await call("pages.create", { title: "Essay" })).page._id;
    await edit(call, id, "draft one");
    await edit(call, id, "draft one and more");
    await edit(call, id, "draft one and even more");
    let h = await call("versions.list", { pageId: id });
    expect(h.versions).toHaveLength(1); // the first non-empty state only
    advance(VERSION_INTERVAL_MS);
    await edit(call, id, "draft two");
    h = await call("versions.list", { pageId: id });
    expect(h.versions).toHaveLength(2);
    const latest = await call("versions.get", { id: h.versions[0]._id, format: "markdown" });
    expect(latest.markdown).toContain("draft one and even more");
  });

  it("restores a version, and the restore itself can be undone", async () => {
    const { as, advance } = setup();
    const call = as("alice");
    const id = (await call("pages.create", { title: "Plan" })).page._id;
    await edit(call, id, "important original");
    advance(VERSION_INTERVAL_MS);
    await edit(call, id, "accidentally overwritten");
    const { versions } = await call("versions.list", { pageId: id });
    const original = versions.find((v: any) => v.revision === 2);
    const res = await call("versions.restore", { id: original._id });
    expect((await call("documents.get", { pageId: id, format: "markdown" })).markdown).toContain("important original");
    const after = await call("versions.list", { pageId: id });
    const before = after.versions.find((v: any) => v.reason === "before-restore");
    expect(before.revision).toBe(res.revision - 1);
    await call("versions.restore", { id: before._id });
    expect((await call("documents.get", { pageId: id, format: "markdown" })).markdown).toContain("accidentally overwritten");
  });

  it("keeps every assistant edit undoable", async () => {
    const { as } = setup();
    const ui = as("alice");
    const mcp = as("alice", "mcp");
    const id = (await ui("pages.create", { title: "Notes", markdown: "mine" })).page._id;
    await mcp("documents.writeMarkdown", { pageId: id, markdown: "rewritten by assistant" });
    await mcp("documents.writeMarkdown", { pageId: id, markdown: "rewritten again" });
    const { versions } = await ui("versions.list", { pageId: id });
    expect(versions.map((v: any) => v.reason)).toEqual(["assistant", "assistant"]);
    const first = await ui("versions.get", { id: versions[1]._id, format: "markdown" });
    expect(first.markdown).toContain("mine");
  });

  it("saves a version on demand and caps history per page", async () => {
    const { as, advance } = setup();
    const call = as("alice");
    const id = (await call("pages.create", { markdown: "v0" })).page._id;
    expect((await call("versions.create", { pageId: id })).saved).toBe(true);
    expect((await call("versions.create", { pageId: id })).saved).toBe(false);
    for (let i = 1; i <= MAX_VERSIONS_PER_PAGE + 5; i++) {
      advance(VERSION_INTERVAL_MS);
      await edit(call, id, `v${i}`);
    }
    expect((await call("versions.list", { pageId: id })).versions).toHaveLength(MAX_VERSIONS_PER_PAGE);
  });

  it("is private to its owner and removed with the page", async () => {
    const { as, db, advance } = setup();
    const alice = as("alice");
    const bob = as("bob");
    const id = (await alice("pages.create", { markdown: "secret" })).page._id;
    advance(VERSION_INTERVAL_MS);
    await edit(alice, id, "changed");
    const { versions } = await alice("versions.list", { pageId: id });
    await expect(bob("versions.list", { pageId: id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bob("versions.get", { id: versions[0]._id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(bob("versions.restore", { id: versions[0]._id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await alice("pages.archive", { id });
    await alice("pages.deletePermanently", { id, confirm: true });
    expect(await db.list("versions", "alice")).toEqual([]);
  });
});
