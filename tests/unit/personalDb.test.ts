import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Storage } from "@/lib/domain/db";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { execute, type OpContext } from "@/lib/domain/ops";
import { createPersonalDb } from "@/lib/domain/collaboration/personalDb";

const createdPage = z.object({ page: z.object({ _id: z.string() }) });
const createdAsset = z.object({ id: z.string() });
const createdVersion = z.object({ versionId: z.string() });
const createdComment = z.object({ comment: z.object({ _id: z.string() }) });

async function fixture() {
  const raw = new MemoryDb();
  const removed: string[] = [];
  const storage: Storage = {
    createUploadUrl: async () => "https://upload.invalid",
    getUrl: async (id) => `https://download.invalid/${id}`,
    remove: async (id) => {
      removed.push(id);
    },
  };
  const original: OpContext = { db: raw, storage, ownerId: "actor", source: "ui", now: 100 };
  const runRaw = (op: string, args: unknown) => raw.transaction(() => execute(op, args, original));
  const personalId = createdPage.parse(await runRaw("pages.create", { title: "Personal", markdown: "Private personal content" })).page._id;
  const sharedId = createdPage.parse(await runRaw("pages.create", { title: "Shared secret", markdown: "Secret shared content" })).page._id;
  const childId = createdPage.parse(await runRaw("pages.create", { title: "Shared child", parentId: sharedId, markdown: "Hidden child content" })).page._id;
  const sharedAsset = createdAsset.parse(
    await runRaw("assets.register", { pageId: sharedId, storageId: "shared-bytes", name: "shared.txt", type: "text/plain", size: 10 }),
  ).id;
  const personalAsset = createdAsset.parse(
    await runRaw("assets.register", { pageId: personalId, storageId: "personal-bytes", name: "personal.txt", type: "text/plain", size: 10 }),
  ).id;
  const version = createdVersion.parse(await runRaw("versions.create", { pageId: sharedId })).versionId;
  const comment = createdComment.parse(await runRaw("comments.add", { pageId: sharedId, body: "Shared comment" })).comment._id;
  await raw.patch("pages", personalId, { workspaceId: "personal-workspace" });
  await raw.patch("pages", sharedId, { workspaceId: "organization-workspace" });
  const personal = createPersonalDb({ db: raw, ownerId: "actor", personalWorkspaceId: "personal-workspace" });
  const ctx: OpContext = { ...original, db: personal };
  const run = (op: string, args: unknown = {}) => raw.transaction(() => execute(op, args, ctx));
  return { raw, personal, original, ctx, run, runRaw, removed, personalId, sharedId, childId, sharedAsset, personalAsset, version, comment };
}

describe("legacy personal Db scope boundary", () => {
  it("never deletes request-selected bytes when upload registration fails validation", async () => {
    const f = await fixture();
    for (const input of [
      { type: "application/unsupported", size: 1 },
      { type: "text/plain", size: 100_000_000 },
    ]) {
      await expect(f.run("assets.register", {
        storageId: "shared-bytes", pageId: f.sharedId, name: "untrusted.txt", ...input,
      })).rejects.toMatchObject({ code: input.size === 1 ? "VALIDATION" : "LIMIT" });
    }
    expect(f.removed).toEqual([]);
    expect(await f.raw.get("assets", f.sharedAsset)).not.toBeNull();
  });
  it("hides creator-owned shared pages and untagged children from page/search/graph/export discovery", async () => {
    const f = await fixture();
    expect(await f.personal.get("pages", f.sharedId)).toBeNull();
    expect(await f.personal.get("pages", f.childId)).toBeNull();
    const tree = z.object({ pages: z.array(z.object({ _id: z.string() })) }).parse(await f.run("pages.tree"));
    expect(tree.pages.map((page) => page._id)).toEqual([f.personalId]);
    expect(JSON.stringify(await f.run("search.query", { query: "Secret" }))).not.toContain("Shared secret");
    expect(JSON.stringify(await f.run("graph.get"))).not.toContain(f.sharedId);
    const exported = z.object({ content: z.string() }).parse(await f.run("export.all"));
    expect(exported.content).toContain("Private personal content");
    expect(exported.content).not.toContain("Secret shared content");
    expect(exported.content).not.toContain("Hidden child content");
    for (const op of ["pages.get", "export.page"]) await expect(f.run(op, { id: f.sharedId })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scopes untagged assets, history, comments and documents through their actual page", async () => {
    const f = await fixture();
    for (const [op, args] of [
      ["documents.get", { pageId: f.sharedId }],
      ["documents.get", { pageId: f.childId }],
      ["assets.getUrl", { id: f.sharedAsset }],
      ["versions.get", { id: f.version }],
      ["comments.update", { id: f.comment, body: "Changed" }],
      ["comments.list", { pageId: f.sharedId }],
      ["versions.list", { pageId: f.sharedId }],
    ])
      await expect(f.run(String(op), args)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await f.personal.list("assets", "actor")).map((row) => row._id)).toEqual([f.personalAsset]);
    expect(await f.personal.list("versions", "actor")).toEqual([]);
    expect(await f.personal.list("comments", "actor")).toEqual([]);
    expect((await f.personal.list("documents", "actor")).map((row) => row.pageId)).toEqual([f.personalId]);
  });

  it("rejects both source and destination mutations without touching shared bytes", async () => {
    const f = await fixture();
    const before = f.raw.snapshot();
    for (const [op, args] of [
      ["pages.move", { id: f.sharedId, parentId: f.personalId }],
      ["pages.move", { id: f.personalId, parentId: f.sharedId }],
      ["pages.create", { parentId: f.sharedId, title: "Injected" }],
      ["documents.writeMarkdown", { pageId: f.sharedId, markdown: "Overwrite" }],
      ["assets.remove", { id: f.sharedAsset, confirm: true }],
      ["versions.restore", { id: f.version }],
      ["comments.delete", { id: f.comment, confirm: true }],
    ])
      await expect(f.run(String(op), args)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.raw.snapshot()).toBe(before);
    expect(f.removed).toEqual([]);
  });

  it("guards raw facade inserts, patches and deletes, including ownership and effective undefined patches", async () => {
    const f = await fixture();
    const page = await f.raw.get("pages", f.personalId);
    if (!page) throw new Error("Missing fixture page");
    await expect(f.personal.insert("pages", { ...page, ownerId: "another-actor" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.personal.insert("pages", { ...page, workspaceId: "organization-workspace" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.personal.patch("pages", f.personalId, { workspaceId: "organization-workspace" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.personal.patch("pages", f.personalId, { parentId: f.sharedId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.personal.patch("pages", f.personalId, { databaseId: f.sharedId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.personal.patch("assets", f.personalAsset, { pageId: f.sharedId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(f.personal.delete("pages", f.sharedId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await f.personal.patch("pages", f.personalId, { workspaceId: undefined, title: "Still personal" });
    expect((await f.raw.get("pages", f.personalId))?.workspaceId).toBe("personal-workspace");
    expect(await f.personal.list("pages", "another-actor")).toEqual([]);
  });

  it("recognizes future child workspace markers structurally without relying on current row types", async () => {
    const f = await fixture();
    const docs = await f.raw.list("documents", "actor", { field: "pageId", value: f.personalId });
    const futureMarker = { ownerId: "actor", workspaceId: "organization-workspace" };
    await f.raw.patch("documents", docs[0]._id, futureMarker);
    expect(await f.personal.get("documents", docs[0]._id)).toBeNull();
    expect(await f.personal.list("documents", "actor")).toEqual([]);
    await expect(f.personal.patch("documents", docs[0]._id, { text: "Changed" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const invalidMarker = { ownerId: "actor", workspaceId: null };
    await f.raw.patch("documents", docs[0]._id, invalidMarker);
    expect(await f.personal.get("documents", docs[0]._id)).toBeNull();
    await expect(f.personal.insert("documents", { ...docs[0], ...futureMarker })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rereads scope after writes rather than caching previously personal pages", async () => {
    const f = await fixture();
    expect(await f.personal.get("pages", f.personalId)).not.toBeNull();
    await f.raw.patch("pages", f.personalId, { workspaceId: "organization-workspace" });
    expect(await f.personal.get("pages", f.personalId)).toBeNull();
    expect(await f.personal.list("assets", "actor")).toEqual([]);
    await expect(f.run("assets.remove", { id: f.personalAsset, confirm: true })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.removed).toEqual([]);
  });

  it("keeps unscoped personal roots and unbound files usable without a canonical marker", async () => {
    const raw = new MemoryDb();
    const db = createPersonalDb({ db: raw, ownerId: "actor" });
    const context: OpContext = { db, storage: null, ownerId: "actor", source: "ui", now: 1 };
    const id = createdPage.parse(await raw.transaction(() => execute("pages.create", { title: "Legacy" }, context))).page._id;
    expect((await db.get("pages", id))?.title).toBe("Legacy");
    const asset = await db.insert("assets", {
      ownerId: "actor",
      pageId: null,
      storageId: "unbound",
      name: "file.txt",
      type: "text/plain",
      size: 1,
      alt: "",
      createdAt: 1,
    });
    expect(await db.get("assets", asset)).not.toBeNull();
    await db.preflightAccountDeletion();
    await raw.patch("pages", id, { workspaceId: "personal-workspace" });
    expect(await db.get("pages", id)).toBeNull();
  });

  it("preserves unscoped orphans in raw storage but refuses deletion until their scope is recovered", async () => {
    const f = await fixture();
    await f.raw.patch("pages", f.personalId, { parentId: "missing-parent" });
    expect(await f.personal.get("pages", f.personalId)).toBeNull();
    expect(await f.personal.get("assets", f.personalAsset)).toBeNull();
    const before = f.raw.snapshot();
    await expect(f.personal.preflightAccountDeletion()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.raw.snapshot()).toBe(before);
    expect(await f.raw.get("pages", f.personalId)).not.toBeNull();
    await f.raw.patch("pages", f.personalId, { parentId: null });
    expect(await f.personal.get("pages", f.personalId)).not.toBeNull();
  });

  it("preflights mixed account deletion before any personal rows or shared files can be removed", async () => {
    const f = await fixture();
    const before = f.raw.snapshot();
    await expect(
      f.raw.transaction(async () => {
        await f.personal.preflightAccountDeletion();
        await execute("account.deleteAllData", { confirm: true }, f.ctx);
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.raw.snapshot()).toBe(before);
    expect(f.removed).toEqual([]);
    await expect(f.run("account.deleteAllData", { confirm: true })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      f.run("batch", {
        operations: [
          { op: "pages.update", args: { id: f.personalId, title: "Temporary before wipe" } },
          { op: "account.deleteAllData", args: { confirm: true } },
        ],
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.raw.snapshot()).toBe(before);
    expect(f.removed).toEqual([]);
  });

  it("preserves account-table and token lookup behavior and allows a clean personal deletion", async () => {
    const raw = new MemoryDb();
    const db = createPersonalDb({ db: raw, ownerId: "actor" });
    const token = await raw.insert("tokens", {
      ownerId: "other",
      name: "Other token",
      hash: "other-hash",
      prefix: "max_test",
      createdAt: 1,
      lastUsedAt: null,
      revokedAt: null,
    });
    expect(await db.findTokenByHash("other-hash")).toEqual(await raw.findTokenByHash("other-hash"));
    expect(await db.get("tokens", token)).toEqual(await raw.get("tokens", token));
    expect(await db.list("tokens", "other")).toEqual(await raw.list("tokens", "other"));
    const ctx: OpContext = { db, storage: null, ownerId: "actor", source: "ui", now: 1 };
    await execute("pages.create", { title: "Personal" }, ctx);
    await raw.transaction(async () => {
      await db.preflightAccountDeletion();
      await execute("account.deleteAllData", { confirm: true }, ctx);
    });
    expect(await raw.list("pages", "actor")).toEqual([]);
    expect(await db.findTokenByHash("other-hash")).not.toBeNull();
  });

  it("rolls back earlier batch writes when a later item targets shared content", async () => {
    const f = await fixture();
    const before = f.raw.snapshot();
    await expect(
      f.run("batch", {
        operations: [
          { op: "pages.update", args: { id: f.personalId, title: "Temporary change" } },
          { op: "pages.update", args: { id: f.sharedId, title: "Unauthorized" } },
        ],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(f.raw.snapshot()).toBe(before);
  });

  it("rejects cross-owner ancestry, cycles and teamspace markers on nominally personal rows", async () => {
    const f = await fixture();
    await f.raw.patch("pages", f.personalId, { parentId: f.personalId });
    expect(await f.personal.get("pages", f.personalId)).toBeNull();
    await f.raw.patch("pages", f.personalId, { parentId: null, teamspaceId: "team" });
    expect(await f.personal.get("pages", f.personalId)).toBeNull();
    await f.raw.patch("pages", f.personalId, { teamspaceId: null, parentId: f.childId });
    await f.raw.patch("pages", f.childId, { parentId: null, ownerId: "other" });
    expect(await f.personal.get("pages", f.personalId)).toBeNull();
  });

  it("blocks stale cached-result replay before it bypasses scope checks in the real dispatcher", async () => {
    const f = await fixture();
    await f.runRaw("pages.update", { id: f.sharedId, title: "Shared cached title", idempotencyKey: "old-shared-result" });
    const before = f.raw.snapshot();
    await expect(f.run("pages.update", { id: f.sharedId, title: "Do not replay", idempotencyKey: "old-shared-result" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const receipts = await f.raw.list("idempotency", "actor");
    await expect(f.personal.get("idempotency", receipts[0]._id)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.raw.snapshot()).toBe(before);
    expect(f.removed).toEqual([]);
    await f.run("pages.update", { id: f.personalId, title: "Fresh personal edit", idempotencyKey: "fresh-personal-result" });
    expect((await f.raw.get("pages", f.personalId))?.title).toBe("Fresh personal edit");
  });

  it("preserves idempotent replay in a fully personal workspace", async () => {
    const raw = new MemoryDb();
    const db = createPersonalDb({ db: raw, ownerId: "actor" });
    const context: OpContext = { db, storage: null, ownerId: "actor", source: "ui", now: 1 };
    const args = { title: "Once", idempotencyKey: "personal-only-result" };
    await raw.transaction(() => execute("pages.create", args, context));
    const replay = await raw.transaction(() => execute("pages.create", args, context));
    expect(replay).toMatchObject({ idempotentReplay: true });
    expect((await raw.list("pages", "actor")).length).toBe(1);
  });

  it("fully wipes nested personal pages, documents, history, comments and assets without orphan leftovers", async () => {
    const raw = new MemoryDb();
    const db = createPersonalDb({ db: raw, ownerId: "actor" });
    const removed: string[] = [];
    const storage: Storage = {
      createUploadUrl: async () => "unused",
      getUrl: async () => "unused",
      remove: async (id) => {
        removed.push(id);
      },
    };
    const context: OpContext = { db, storage, ownerId: "actor", source: "ui", now: 1 };
    const root = createdPage.parse(await execute("pages.create", { title: "Root", markdown: "Root text" }, context)).page._id;
    const child = createdPage.parse(await execute("pages.create", { title: "Child", parentId: root, markdown: "Child text" }, context)).page._id;
    await execute("versions.create", { pageId: child }, context);
    await execute("comments.add", { pageId: child, body: "Comment" }, context);
    await execute("assets.register", { pageId: child, storageId: "child-file", name: "child.txt", type: "text/plain", size: 1 }, context);
    await raw.transaction(async () => {
      await db.preflightAccountDeletion();
      await execute("account.deleteAllData", { confirm: true }, context);
    });
    for (const table of ["pages", "documents", "versions", "comments", "assets"] as const) expect(await raw.list(table, "actor"), table).toEqual([]);
    expect(removed).toEqual(["child-file"]);
  });

  it("permanently deletes nested trash and database rows leaves-first without leaving files or metadata", async () => {
    for (const operation of ["pages.deletePermanently", "trash.empty"]) {
      const raw = new MemoryDb();
      const db = createPersonalDb({ db: raw, ownerId: "actor" });
      const removed: string[] = [];
      const storage: Storage = {
        createUploadUrl: async () => "unused",
        getUrl: async () => "unused",
        remove: async (id) => {
          removed.push(id);
        },
      };
      const context: OpContext = { db, storage, ownerId: "actor", source: "ui", now: 1 };
      const root = createdPage.parse(await execute("pages.create", { title: "Root", markdown: "Root content" }, context)).page._id;
      const child = createdPage.parse(await execute("pages.create", { title: "Child", parentId: root, markdown: "Child content" }, context)).page._id;
      const database = createdPage.parse(await execute("pages.create", { title: "DB", parentId: root, kind: "database" }, context)).page._id;
      const record = z
        .object({ record: z.object({ _id: z.string() }) })
        .parse(await execute("records.create", { databaseId: database, title: "Record" }, context)).record._id;
      await execute("versions.create", { pageId: child }, context);
      await execute("comments.add", { pageId: child, body: "Comment" }, context);
      await execute("assets.register", { pageId: record, storageId: "record-file", name: "row.txt", type: "text/plain", size: 1 }, context);
      await execute("pages.archive", { id: root }, context);
      await raw.transaction(() => execute(operation, { id: root, confirm: true }, context));
      for (const table of ["pages", "documents", "versions", "comments", "assets"] as const)
        expect(await raw.list(table, "actor"), `${operation}: ${table}`).toEqual([]);
      expect(removed).toEqual(["record-file"]);
    }
  });
});
