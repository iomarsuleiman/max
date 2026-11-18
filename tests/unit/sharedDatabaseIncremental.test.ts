import { describe, expect, it } from "vitest";
import { pageAuthorizedSharedRecords, previewAuthorizedSharedRecords, type SharedDatabaseReadStore, type SharedRecordCandidate } from "@/lib/domain/sharedDatabasePolicy";
import type { ScopeRow, GrantRow } from "@/lib/domain/workspaceAccessGateway";

const workspaceId = "tenant01", databaseId = "db1", ownerId = "clerk_owner", memberId = "clerk_member";
function fixture() {
  const scopes: ScopeRow[] = [{ workspaceId, pageId: databaseId, parentId: null, teamspaceId: null }];
  const grants: GrantRow[] = [{
    workspaceId, pageId: databaseId, subjectType: "account",
    subjectId: memberId, effect: "allow", level: "view",
  }];
  const records: SharedRecordCandidate[] = [];
  let active = true;
  let broken = false;
  const store: SharedDatabaseReadStore = {
    workspaces: async () => [{ workspaceId, ownerId, status: "active" }],
    memberships: async (_id, account) => active ? [{
      workspaceId, accountId: account, role: account === ownerId ? "owner" : "member", status: "active",
    }] : [],
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (_id, id) => scopes.filter((row) => row.pageId === id),
    grants: async (_id, id) => grants.filter((row) => row.pageId === id),
    databaseBindings: async () => [{ workspaceId, pageId: databaseId, kind: "database", archivedAt: null }],
    recordCandidates: async () => broken ? [...records, { ...records[0], pageId: "row_corrupt", workspaceId: "tenant02" }] : records,
  };
  const add = (id: string, title = id, hidden = false) => {
    records.push({ workspaceId, databaseId, pageId: id, kind: "record",
      archivedAt: null, title, updatedAt: 100 });
    scopes.push({ workspaceId, pageId: id, parentId: databaseId, teamspaceId: null });
    if (hidden) grants.push({ workspaceId, pageId: id, subjectType: "account",
      subjectId: memberId, effect: "deny", level: "view" });
  };
  const page = (limit = 2, after: string | null = null, account: string | null = memberId) =>
    pageAuthorizedSharedRecords(store, account, workspaceId, databaseId, limit, after);
  return { add, page, scopes, grants, store, records, revoke: () => { active = false; }, corrupt: () => { broken = true; } };
}
describe("PR32 authorized metadata and incremental reads (gated shadow contract)", () => {
  it("sorts visible records by stable ID and returns only authorized next cursors", async () => {
    const f = fixture(); f.add("rowD"); f.add("rowB", "PRIVATE", true); f.add("rowC"); f.add("rowA");
    expect(await f.page()).toEqual({ records: [
      { pageId: "rowA", title: "rowA", updatedAt: 100 },
      { pageId: "rowC", title: "rowC", updatedAt: 100 },
    ], nextCursor: "rowC" });
    expect(await f.page(2, "rowC")).toEqual({
      records: [{ pageId: "rowD", title: "rowD", updatedAt: 100 }], nextCursor: null,
    });
  });
  it("cannot use a denied, forged or revoked row as a cursor", async () => {
    const f = fixture(); f.add("rowA"); f.add("rowB", "private", true); f.add("rowC");
    expect(await f.page(1, "rowB")).toEqual({ records: [], nextCursor: null });
    expect(await f.page(1, "../escape")).toEqual({ records: [], nextCursor: null });
    expect(await f.page(1, "missing")).toEqual({ records: [], nextCursor: null });
    f.revoke();
    expect(await f.page(1, "rowA")).toEqual({ records: [], nextCursor: null });
  });
  it("rechecks cursor permissions across requests and does not skip a newly denied anchor", async () => {
    const f = fixture(); f.add("rowA"); f.add("rowB"); f.add("rowC");
    expect((await f.page(1)).nextCursor).toBe("rowA");
    f.grants.push({ workspaceId, pageId: "rowA", subjectType: "account",
      subjectId: memberId, effect: "deny", level: "view" });
    expect(await f.page(1, "rowA")).toEqual({ records: [], nextCursor: null });
  });
  it("discloses no hidden counts, properties, relations, titles or raw index cursors", async () => {
    const f = fixture(); f.add("rowA"); f.add("rowB", "secret-text", true);
    const payload = await f.page(1);
    expect(Object.keys(payload)).toEqual(["records", "nextCursor"]);
    expect(JSON.stringify(payload)).not.toContain("secret-text");
    expect(JSON.stringify(payload)).not.toContain("rowB");
    expect(Object.keys(payload.records[0])).toEqual(["pageId", "title", "updatedAt"]);
  });
  it("fails closed on malformed ancestry, duplicate metadata and wrong-tenant records", async () => {
    const f = fixture(); f.add("rowA"); f.add("rowB");
    f.scopes.find((row) => row.pageId === "rowB")!.parentId = "elsewhere";
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
    f.scopes.find((row) => row.pageId === "rowB")!.parentId = databaseId;
    f.records.push({ ...f.records[0] });
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
    f.records.pop();
    f.corrupt();
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
  });
  it("hard limits scans to 100 candidates and page size to 25", async () => {
    const f = fixture();
    for (let i = 0; i < 100; i++) f.add("row" + String(i).padStart(3, "0"));
    expect((await f.page(25)).records).toHaveLength(25);
    expect(await f.page(26)).toEqual({ records: [], nextCursor: null });
    f.add("overflow");
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
  });
  it("keeps existing PR31 preview semantics and denies invalid identity", async () => {
    const f = fixture(); f.add("rowA"); f.add("rowB");
    expect(await previewAuthorizedSharedRecords(f.store, memberId, workspaceId, databaseId, 1))
      .toEqual([{ pageId: "rowA", title: "rowA", updatedAt: 100 }]);
    expect(await f.page(2, null, null)).toEqual({ records: [], nextCursor: null });
  });
});
