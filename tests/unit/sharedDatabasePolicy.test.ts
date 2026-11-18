import { describe, expect, it } from "vitest";
import {
  canEditSharedRecord,
  previewAuthorizedSharedRecords,
  type SharedDatabaseReadStore,
  type SharedDatabaseBinding,
  type SharedRecordCandidate,
} from "@/lib/domain/sharedDatabasePolicy";
import type { GrantRow, MembershipRow, ScopeRow, WorkspaceRow } from "@/lib/domain/workspaceAccessGateway";

const workspaceId = "tenant01";
const databaseId = "db1";
const memberId = "clerk_alice";
const ownerId = "clerk_owner";
const rowA: SharedRecordCandidate = {
  workspaceId, databaseId, pageId: "rowA", kind: "record",
  archivedAt: null, title: "Visible task", updatedAt: 100,
  values: { confidentialRollup: "NEVER EXPOSE", hiddenRelation: ["private-record"] },
  privateField: "NEVER EXPOSE",
};

function fixture() {
  const state: {
    workspaces: WorkspaceRow[];
    memberships: MembershipRow[];
    bindings: SharedDatabaseBinding[];
    scopes: ScopeRow[];
    grants: GrantRow[];
    records: SharedRecordCandidate[];
    throwOnRecords: boolean;
  } = {
    workspaces: [{ workspaceId, ownerId, status: "active" }],
    memberships: [
      { workspaceId, accountId: ownerId, role: "owner", status: "active" },
      { workspaceId, accountId: memberId, role: "member", status: "active" },
    ],
    bindings: [{ workspaceId, pageId: databaseId, kind: "database", archivedAt: null }],
    scopes: [
      { workspaceId, pageId: databaseId, parentId: null, teamspaceId: null },
      { workspaceId, pageId: "rowA", parentId: databaseId, teamspaceId: null },
      { workspaceId, pageId: "rowB", parentId: databaseId, teamspaceId: null },
    ],
    grants: [
      { workspaceId, pageId: databaseId, subjectType: "account", subjectId: memberId, effect: "allow", level: "view" },
      { workspaceId, pageId: "rowB", subjectType: "account", subjectId: memberId, effect: "deny", level: "view" },
    ],
    records: [rowA, { ...rowA, pageId: "rowB", title: "Hidden task" }],
    throwOnRecords: false,
  };
  const store: SharedDatabaseReadStore = {
    workspaces: async () => state.workspaces,
    memberships: async (_workspaceId, accountId) => state.memberships.filter((r) => r.accountId === accountId),
    groups: async () => [],
    teamspaces: async () => [],
    groupRegistrations: async () => [],
    teamspaceRegistrations: async () => [],
    scopes: async (_workspaceId, pageId) => state.scopes.filter((r) => r.pageId === pageId),
    grants: async (_workspaceId, pageId) => state.grants.filter((r) => r.pageId === pageId),
    databaseBindings: async () => state.bindings,
    recordCandidates: async () => {
      if (state.throwOnRecords) throw new Error("unavailable");
      return state.records;
    },
  };
  const read = (accountId: string | null = memberId, limit = 25) =>
    previewAuthorizedSharedRecords(store, accountId, workspaceId, databaseId, limit);
  const edit = (accountId: string | null = memberId, recordId = "rowA") =>
    canEditSharedRecord(store, accountId, workspaceId, databaseId, recordId);
  return { state, store, read, edit };
}

describe("Max 2.0 PR31 shared database security contract (unwired)", () => {
  it("checks every record, including explicit inherited-deny overrides", async () => {
    const { read } = fixture();
    expect(await read()).toEqual([{ pageId: "rowA", title: "Visible task", updatedAt: 100 }]);
  });

  it("never exposes raw values, relations, computed fields, extra metadata or hidden counts", async () => {
    const { read } = fixture();
    const response = await read();
    expect(JSON.stringify(response)).not.toContain("NEVER EXPOSE");
    expect(JSON.stringify(response)).not.toContain("Hidden task");
    expect(JSON.stringify(response)).not.toContain("private-record");
    expect(Object.keys(response[0])).toEqual(["pageId", "title", "updatedAt"]);
  });

  it("denies unauthenticated, suspended and revoked accounts", async () => {
    const { read, state } = fixture();
    expect(await read(null)).toEqual([]);
    state.memberships[1].status = "suspended";
    expect(await read()).toEqual([]);
    state.memberships[1].status = "revoked";
    expect(await read()).toEqual([]);
  });

  it("requires separate permission on the database itself", async () => {
    const { read, state } = fixture();
    state.grants = state.grants.filter((g) => g.pageId !== databaseId);
    expect(await read()).toEqual([]);
  });

  it("rejects cross-tenant and mismatched database record bindings without partial output", async () => {
    for (const change of [{ workspaceId: "tenant02" }, { databaseId: "other-db" }, { kind: "database" }]) {
      const { state, read } = fixture();
      state.records[1] = { ...state.records[1], ...change } as SharedRecordCandidate;
      expect(await read()).toEqual([]);
    }
  });

  it("rejects duplicate IDs, invalid IDs, oversized batches and invalid limits", async () => {
    const { state, read } = fixture();
    expect(await read(memberId, 0)).toEqual([]);
    expect(await read(memberId, 51)).toEqual([]);
    state.records[1] = { ...rowA };
    expect(await read()).toEqual([]);
    state.records = [{ ...rowA, pageId: "../escape" }];
    expect(await read()).toEqual([]);
    state.records = Array.from({ length: 101 }, (_, i) => ({ ...rowA, pageId: `row_${i}` }));
    expect(await read()).toEqual([]);
  });

  it("fails closed when the scope is missing, duplicated or linked to another parent", async () => {
    for (const kind of ["missing", "duplicate", "wrong-parent"] as const) {
      const { state, read } = fixture();
      if (kind === "missing") state.scopes = state.scopes.filter((r) => r.pageId !== "rowB");
      if (kind === "duplicate") state.scopes.push({ ...state.scopes[2] });
      if (kind === "wrong-parent") state.scopes[2].parentId = "unrelated";
      expect(await read()).toEqual([]);
    }
  });

  it("excludes archived rows without revealing their titles", async () => {
    const { state, read } = fixture();
    state.records[0] = { ...rowA, archivedAt: 123 };
    expect(await read()).toEqual([]);
    state.bindings[0].archivedAt = 123;
    expect(await read(ownerId)).toEqual([]);
  });

  it("treats corrupted bindings and backend exceptions as empty rather than partial success", async () => {
    const { state, read } = fixture();
    state.bindings.push({ ...state.bindings[0] });
    expect(await read()).toEqual([]);
    state.bindings.pop();
    state.throwOnRecords = true;
    expect(await read()).toEqual([]);
  });

  it("requires database AND record edit capability for the future mutation preflight", async () => {
    const { state, edit } = fixture();
    expect(await edit()).toBe(false);
    state.grants[0].level = "edit_content";
    expect(await edit()).toBe(true);
    expect(await edit(memberId, "rowB")).toBe(false);
    expect(await edit(null)).toBe(false);
    state.scopes[1].parentId = "unrelated";
    expect(await edit()).toBe(false);
  });

  it("rejects identity forgery, broken ancestry and cross-tenant workspace status", async () => {
    const { state, read, edit } = fixture();
    expect(await read("../forged")).toEqual([]);
    state.scopes[0].parentId = "rowA";
    expect(await read()).toEqual([]);
    expect(await edit()).toBe(false);
    state.scopes[0].parentId = null;
    state.workspaces[0].status = "disabled";
    expect(await read(ownerId)).toEqual([]);
  });
});
