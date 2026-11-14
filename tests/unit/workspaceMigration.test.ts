import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { MemoryDb } from "@/lib/domain/memoryDb";
import { canPage, type PolicyPage, type PolicySnapshot } from "@/lib/domain/collaboration/policy";
import {
  applyWorkspaceMigration,
  planPersonalWorkspaceMigration,
  rollbackWorkspaceMigration,
  verifyWorkspaceMigrationPlan,
} from "@/lib/domain/collaboration/migration";
import type { PageRow } from "@/lib/domain/types";
import { setup } from "./harness";

async function fixture() {
  const { db, as } = setup();
  const alice = as("alice", "mcp");
  const { page } = await alice<{ page: PageRow }>("pages.create", { title: "English العربية" });
  const { page: child } = await alice<{ page: PageRow }>("pages.create", { title: "Child", parentId: page._id });
  const corpus = await readFile(new URL("../fixtures/editor-document.json", import.meta.url), "utf8");
  await alice("documents.save", { pageId: page._id, blocks: JSON.parse(corpus) });
  await alice("comments.add", { pageId: page._id, body: "Private comment", blockId: "gold-paragraph" });
  await alice("versions.create", { pageId: page._id });
  await as("bob")("pages.create", { title: "Bob's notes" });
  await db.insert("assets", {
    ownerId: "alice",
    pageId: child._id,
    storageId: "unchangedstorageid",
    name: "file",
    type: "text/plain",
    size: 8,
    alt: "",
    createdAt: 0,
  });
  await db.insert("assets", {
    ownerId: "alice",
    pageId: null,
    storageId: "unattachedfileid",
    name: "cover",
    type: "text/plain",
    size: 0,
    alt: "",
    createdAt: 0,
  });
  await db.insert("tokens", {
    ownerId: "alice",
    name: "Existing token",
    hash: "private-hash",
    prefix: "max_",
    createdAt: 0,
    revokedAt: null,
    lastUsedAt: null,
  });
  return { db, original: db.snapshot(), page, child };
}

describe("personal workspace migration rehearsal", () => {
  it("maps each original owner to an isolated personal policy context", async () => {
    const { db, original } = await fixture();
    const plan = await planPersonalWorkspaceMigration(original);
    const pages: PolicyPage[] = [];
    for (const mapping of plan.mappings) {
      for (const page of await db.list("pages", mapping.ownerId)) {
        pages.push({
          id: page._id,
          workspaceId: mapping.workspaceId,
          parentId: page.parentId ?? page.databaseId,
          teamspaceId: null,
          access: { mode: "inherit", grants: [] },
        });
      }
    }
    for (const mapping of plan.mappings) {
      const context: PolicySnapshot = {
        workspace: { id: mapping.workspaceId, kind: "personal", state: "active", ownerId: mapping.ownerId },
        userId: mapping.ownerId,
        membership: { workspaceId: mapping.workspaceId, userId: mapping.ownerId, role: "owner", state: "active" },
        groupMemberships: [],
        teamspaces: [],
        pages,
        now: 0,
      };
      for (const page of pages) expect(canPage(context, page.id, "page.share")).toBe(page.workspaceId === mapping.workspaceId);
      const expanded = JSON.parse(plan.expanded);
      expect(expanded.memberships).toContainEqual({ _id: mapping.membershipId, ...context.membership });
    }
  });

  it("preserves every original row, ID, revision and corpus byte, and reverses exactly", async () => {
    const { db, original } = await fixture();
    const plan = await planPersonalWorkspaceMigration(original);
    const expanded = JSON.parse(await applyWorkspaceMigration(original, plan));
    const before = JSON.parse(original);
    expect(plan.mappings.map((mapping) => mapping.ownerId)).toEqual(["alice", "bob"]);
    expect(new Set(plan.mappings.map((mapping) => mapping.workspaceId)).size).toBe(2);
    for (const [table, rows] of Object.entries(before)) {
      expect(expanded.tables[table]).toHaveLength((rows as unknown[]).length);
      for (const [index, value] of (rows as Record<string, unknown>[]).entries()) {
        const { workspaceId, ...copy } = expanded.tables[table][index];
        expect(copy).toEqual(value);
        if (["pages", "documents", "assets", "versions", "comments"].includes(table)) {
          expect(workspaceId).toBe(plan.mappings.find((mapping) => mapping.ownerId === value.ownerId)?.workspaceId);
        } else expect(workspaceId).toBeUndefined();
      }
    }
    expect(expanded.memberships.map((member: { role: string }) => member.role)).toEqual(["owner", "owner"]);
    expect(db.snapshot()).toBe(original);
    const restored = new MemoryDb();
    restored.restore(await rollbackWorkspaceMigration(plan.expanded, plan));
    expect(restored.snapshot()).toBe(original);
  });

  it("is deterministic, retry-safe and retains the exact source formatting", async () => {
    const { original } = await fixture();
    const formatted = JSON.stringify(JSON.parse(original), null, 4) + "\n";
    const first = await planPersonalWorkspaceMigration(formatted);
    expect(await planPersonalWorkspaceMigration(formatted)).toEqual(first);
    expect(await applyWorkspaceMigration(first.expanded, first)).toBe(first.expanded);
    expect(await rollbackWorkspaceMigration(first.original, first)).toBe(formatted);
    expect(await rollbackWorkspaceMigration(first.expanded, first)).toBe(formatted);
  });

  it("keeps workspace mappings stable when new owners are added", async () => {
    const { db, original } = await fixture();
    const plan = await planPersonalWorkspaceMigration(original);
    await db.insert("audit", { ownerId: "aaa", op: "test", source: "ui", targetId: null, ok: true, code: null, at: 0 });
    const next = await planPersonalWorkspaceMigration(db.snapshot());
    for (const mapping of plan.mappings) expect(next.mappings).toContainEqual(mapping);
  });

  it("refuses stale application, edited rollback and tampered artifacts", async () => {
    const { original } = await fixture();
    const plan = await planPersonalWorkspaceMigration(original);
    await expect(applyWorkspaceMigration(original + " ", plan)).rejects.toThrow("changed");
    await expect(rollbackWorkspaceMigration(plan.expanded + " ", plan)).rejects.toThrow("changed");
    await expect(verifyWorkspaceMigrationPlan({ ...plan, expanded: plan.expanded.replace("Child", "Changed") })).rejects.toThrow("does not match");
    await expect(verifyWorkspaceMigrationPlan({ ...plan, mappings: [] })).rejects.toThrow("does not match");
    await expect(verifyWorkspaceMigrationPlan({ ...plan, counts: {} })).rejects.toThrow("does not match");
  });

  it("rejects duplicate IDs/documents, damaged JSON, unknown tables and incomplete snapshots", async () => {
    const { original } = await fixture();
    const source = JSON.parse(original);
    for (const bad of [
      { ...source, pages: [...source.pages, source.pages[0]] },
      { ...source, documents: [...source.documents, { ...source.documents[0], _id: "duplicate-doc" }] },
      { ...source, documents: [{ ...source.documents[0], content: "broken" }] },
      { ...source, documents: [{ ...source.documents[0], revision: -1 }] },
      { ...source, futureTable: [] },
      { pages: [], documents: [] },
    ])
      await expect(planPersonalWorkspaceMigration(JSON.stringify(bad))).rejects.toThrow();
  });

  it("rejects cross-owner, missing and cyclic references without changing source data", async () => {
    const { db, original, page, child } = await fixture();
    for (const patch of [{ parentId: "missing" }, { parentId: child._id }, { ownerId: "other" }, { databaseId: child._id }]) {
      await db.patch("pages", page._id, patch);
      await expect(planPersonalWorkspaceMigration(db.snapshot())).rejects.toThrow();
      db.restore(original);
    }
    const doc = (await db.list("documents", "alice"))[0];
    await db.patch("documents", doc._id, { ownerId: "bob" });
    await expect(planPersonalWorkspaceMigration(db.snapshot())).rejects.toThrow("cross-owner");
    expect((await planPersonalWorkspaceMigration(original)).original).toBe(original);
  });

  it("rejects already scoped input and preserves unrecognized row fields in v1 snapshots", async () => {
    const { original } = await fixture();
    const source = JSON.parse(original);
    source.pages[0].futureMetadata = { nested: ["retain", "العربية"] };
    const plan = await planPersonalWorkspaceMigration(JSON.stringify(source));
    expect(JSON.parse(plan.expanded).tables.pages[0].futureMetadata).toEqual(source.pages[0].futureMetadata);
    source.pages[0].workspaceId = "caller-supplied";
    await expect(planPersonalWorkspaceMigration(JSON.stringify(source))).rejects.toThrow("unmigrated");
  });
});
