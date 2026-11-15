import { describe, expect, it } from "vitest";
import {
  readAuthorizedTaskViewPage, type TaskViewState,
} from "@/lib/domain/workspaceTaskViews";
import type {
  RegisteredRecord, SemanticRow, SharedSemanticStore,
} from "@/lib/domain/workspaceRecordSemantics";
import type { ScopeRow, GrantRow, MembershipRow } from "@/lib/domain/workspaceAccessGateway";

const workspaceId = "tenant01", databaseId = "database01";
const memberId = "clerk_member", ownerId = "clerk_owner";
const a = "taskA", b = "taskB", hidden = "taskHidden";
const project = "zzProject", hiddenProject = "zzSecretProject", untyped = "zzUntyped";

function fixture() {
  const ids = [a, b, hidden, project, hiddenProject, untyped];
  const scopes: ScopeRow[] = [
    { workspaceId, pageId: databaseId, parentId: null, teamspaceId: null },
    ...ids.map((pageId) => ({ workspaceId, pageId,
      parentId: databaseId, teamspaceId: null })),
  ];
  const memberships: MembershipRow[] = [
    { workspaceId, accountId: ownerId, role: "owner", status: "active" },
    { workspaceId, accountId: memberId, role: "member", status: "active" },
  ];
  const grants: GrantRow[] = [
    { workspaceId, pageId: databaseId, subjectType: "account",
      subjectId: memberId, effect: "allow", level: "view" },
    ...[hidden, hiddenProject].map((pageId): GrantRow => ({
      workspaceId, pageId, subjectType: "account",
      subjectId: memberId, effect: "deny", level: "view",
    })),
  ];
  const metadata: RegisteredRecord[] = ids.map((pageId) => ({
    workspaceId, databaseId, pageId, kind: "record", archivedAt: null,
    title: pageId + " title", updatedAt: 10,
  }));
  const semanticRows: SemanticRow[] = [
    { workspaceId, databaseId, recordId: a, kind: "task", state: "todo",
      assigneeId: memberId, projectId: project, dueAt: 2000000000000,
      archivedAt: null, updatedAt: 20 },
    { workspaceId, databaseId, recordId: b, kind: "task", state: "blocked",
      assigneeId: ownerId, projectId: null, dueAt: null,
      archivedAt: null, updatedAt: 21 },
    { workspaceId, databaseId, recordId: hidden, kind: "task", state: "done",
      assigneeId: null, projectId: null, dueAt: null,
      archivedAt: null, updatedAt: 22 },
    ...[project, hiddenProject].map((recordId): SemanticRow => ({
      workspaceId, databaseId, recordId, kind: "project", state: "active",
      assigneeId: null, projectId: null, dueAt: null,
      archivedAt: null, updatedAt: 23,
    })),
  ];
  let fail = false;
  const store: SharedSemanticStore = {
    workspaces: async () => [{ workspaceId, ownerId, status: "active" }],
    memberships: async (_ws, id) => memberships.filter((row) => row.accountId === id),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (_ws, id) => scopes.filter((row) => row.pageId === id),
    grants: async (_ws, id) => grants.filter((row) => row.pageId === id),
    databaseBindings: async () => [{ workspaceId, pageId: databaseId,
      kind: "database", archivedAt: null }],
    recordCandidates: async () => metadata,
    recordMetadata: async (id) => metadata.filter((row) => row.pageId === id),
    semanticRows: async (id) => {
      if (fail) throw new Error("temporary Convex failure");
      return semanticRows.filter((row) => row.recordId === id);
    },
  };
  const page = (
    limit = 2, after: string | null = null, state: TaskViewState | null = null,
    principal: string | null = memberId,
  ) => readAuthorizedTaskViewPage(store, principal, workspaceId, databaseId,
    limit, after, state);
  return {
    page, metadata, semanticRows, scopes, grants, memberships,
    offline: () => { fail = true; },
  };
}

describe("Max 2.0 PR35 bounded authorized task views", () => {
  it("returns list/board-ready task fields and self-assignment only", async () => {
    const f = fixture();
    expect(await f.page()).toEqual({
      records: [
        { recordId: a, title: "taskA title", state: "todo",
          dueAt: 2000000000000, assignedToMe: true, projectId: project,
          updatedAt: 20 },
        { recordId: b, title: "taskB title", state: "blocked",
          dueAt: null, assignedToMe: false, projectId: null, updatedAt: 21 },
      ],
      nextCursor: b,
    });
  });

  it("exposes neither hidden task metadata nor third-party assignee IDs", async () => {
    const f = fixture();
    const serialized = JSON.stringify(await f.page(20));
    expect(serialized).not.toContain(hidden);
    expect(serialized).not.toContain(ownerId);
    expect(serialized).not.toContain("taskHidden title");
    expect(serialized).not.toContain("counts");
  });

  it("redacts a valid private project relationship without revealing its ID", async () => {
    const f = fixture();
    f.semanticRows[0].projectId = hiddenProject;
    const output = await f.page();
    expect(output.records[0].projectId).toBeNull();
    expect(JSON.stringify(output)).not.toContain(hiddenProject);
  });

  it("filters task status without leaking unrelated project or untyped records", async () => {
    const f = fixture();
    expect(await f.page(2, null, "blocked")).toEqual({
      records: [{ recordId: b, title: "taskB title", state: "blocked",
        dueAt: null, assignedToMe: false, projectId: null, updatedAt: 21 }],
      nextCursor: b,
    });
    expect(await f.page(20, b)).toEqual({ records: [], nextCursor: null });
  });

  it("keeps cursor anchored to a visible metadata row even on a filtered empty page", async () => {
    const f = fixture();
    expect(await f.page(1, null, "done")).toEqual({
      records: [], nextCursor: a,
    });
    expect(await f.page(1, a, "done")).toEqual({
      records: [], nextCursor: b,
    });
    expect(await f.page(1, b, "done")).toEqual({
      records: [], nextCursor: "zzProject",
    });
  });

  it("rejects denied, invented, malformed or revoked pagination cursors", async () => {
    const f = fixture();
    expect(await f.page(2, hidden)).toEqual({ records: [], nextCursor: null });
    expect(await f.page(2, "forged")).toEqual({ records: [], nextCursor: null });
    expect(await f.page(2, "../../bad")).toEqual({ records: [], nextCursor: null });
    f.memberships[1].status = "revoked";
    expect(await f.page(2, a)).toEqual({ records: [], nextCursor: null });
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
  });

  it("fails closed on duplicate, foreign or corrupt typed records", async () => {
    const f = fixture();
    f.semanticRows.push({ ...f.semanticRows[0] });
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
    f.semanticRows.pop();
    f.semanticRows[0].workspaceId = "tenantOther";
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
    f.semanticRows[0].workspaceId = workspaceId;
    f.semanticRows[0].projectId = untyped; // not a typed project
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
  });

  it("fails closed for damaged database ancestry or duplicate metadata", async () => {
    const f = fixture();
    f.scopes.find((row) => row.pageId === b)!.parentId = "other";
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
    f.scopes.find((row) => row.pageId === b)!.parentId = databaseId;
    f.metadata.push({ ...f.metadata[0] });
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
  });

  it("rejects out-of-bounds requests and missing identities", async () => {
    const f = fixture();
    expect(await f.page(0)).toEqual({ records: [], nextCursor: null });
    expect(await f.page(26)).toEqual({ records: [], nextCursor: null });
    expect(await f.page(2, null, "deleted" as TaskViewState))
      .toEqual({ records: [], nextCursor: null });
    expect(await f.page(2, null, null, null))
      .toEqual({ records: [], nextCursor: null });
    expect(await f.page(2, null, null, "clerk_stranger"))
      .toEqual({ records: [], nextCursor: null });
  });

  it("returns no partially computed response after backend failure", async () => {
    const f = fixture();
    f.offline();
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
  });

  it("rejects more than the preexisting 100 registered metadata records", async () => {
    const f = fixture();
    for (let i = 0; i < 95; i++) {
      f.metadata.push({
        workspaceId, databaseId, pageId: "zzExtra" + i,
        kind: "record", title: "test", archivedAt: null, updatedAt: 1,
      });
    }
    expect(await f.page()).toEqual({ records: [], nextCursor: null });
  });
});
