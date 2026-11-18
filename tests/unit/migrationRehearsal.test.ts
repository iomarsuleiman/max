import { describe, expect, it } from "vitest";
import { rehearsePersonalMigration, UnsafeMigrationSnapshot, type PersonalMigrationSnapshot } from "@/lib/domain/migrationRehearsal";
import type { PageRow } from "@/lib/domain/types";

function page(_id: string, ownerId = "alice", parentId: string | null = null, kind: PageRow["kind"] = "page"): PageRow {
  return { _id, ownerId, parentId, kind, databaseId: null, title: _id, icon: null, cover: null,
    rank: "a", favoriteRank: null, archivedAt: null, archivedRootId: null, lastOpenedAt: null,
    fullWidth: false, smallText: false, locked: false, isTemplate: false, createdAt: 1, updatedAt: 2 };
}
const fixture = (): PersonalMigrationSnapshot => ({
  pages: [page("child", "alice", "root"), page("root"), page("foreign", "bob")],
  documents: [{ _id: "d1", ownerId: "alice", pageId: "child", content: '[{"id":"unchanged","type":"paragraph"}]', text: "ملاحظات", revision: 17, schemaVersion: 1, wordCount: 1, updatedAt: 2 }],
  assets: [{ _id: "asset1", ownerId: "alice", pageId: "child", storageId: "blob", name: "image.png", type: "image/png", size: 7, alt: "", createdAt: 1 }],
  comments: [{ _id: "comment1", ownerId: "alice", pageId: "child", blockId: "unchanged", body: "Saved", resolvedAt: null, createdAt: 1, updatedAt: 1, source: "ui" }],
  versions: [{ _id: "v1", ownerId: "alice", pageId: "child", revision: 16, title: "Old", content: "[]", wordCount: 0, at: 1, source: "ui", reason: "edit" }],
});

describe("Max 2.0 non-destructive migration rehearsal", () => {
  it("is deterministic and preserves IDs, revisions, blocks and all original bytes", () => {
    const source = fixture();
    const before = JSON.stringify(source);
    const a = rehearsePersonalMigration(source, "alice", "personal-alice");
    const b = rehearsePersonalMigration(source, "alice", "personal-alice", a.rollback);
    expect(a).toEqual(b);
    expect(a.dryRun).toBe(true);
    expect(a.pageIds).toEqual(["child", "root"]);
    expect(a.documentIds).toEqual(["d1"]);
    expect(a.assetIds).toEqual(["asset1"]);
    expect(a.commentIds).toEqual(["comment1"]);
    expect(a.versionIds).toEqual(["v1"]);
    expect(JSON.stringify(source)).toBe(before);
  });
  it("rejects conflicting reallocation of a user's personal workspace", () => {
    expect(() => rehearsePersonalMigration(fixture(), "alice", "new", { ownerId: "alice", personalWorkspaceId: "old" })).toThrow(UnsafeMigrationSnapshot);
  });
  it("rejects cross-owner, missing and cyclic ancestors", () => {
    for (const invalidParent of ["foreign", "missing", "child"]) {
      const source = fixture();
      source.pages = source.pages.map(p => p._id === "root" ? { ...p, parentId: invalidParent } : p);
      expect(() => rehearsePersonalMigration(source, "alice", "personal-alice")).toThrow(UnsafeMigrationSnapshot);
    }
  });
  it("rejects cross-owner related assets and documents", () => {
    const source = fixture();
    source.assets = [{ ...source.assets[0], pageId: "foreign" }];
    expect(() => rehearsePersonalMigration(source, "alice", "personal-alice")).toThrow(UnsafeMigrationSnapshot);
    const source2 = fixture();
    source2.documents = [{ ...source2.documents[0], pageId: "foreign" }];
    expect(() => rehearsePersonalMigration(source2, "alice", "personal-alice")).toThrow(UnsafeMigrationSnapshot);
  });
  it("rejects corrupt database ancestry or wrong relation targets", () => {
    const source = fixture();
    source.pages = [...source.pages, { ...page("record"), databaseId: "root" }];
    expect(() => rehearsePersonalMigration(source, "alice", "personal-alice")).toThrow(UnsafeMigrationSnapshot);
  });
});
