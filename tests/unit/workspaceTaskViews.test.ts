import { describe, expect, it } from "vitest";
import {
  pageAuthorizedTaskView, validTaskViewRequest, type TaskViewKind, type TaskViewRequest,
} from "@/lib/domain/workspaceTaskViews";
import type { GrantRow, MembershipRow, ScopeRow } from "@/lib/domain/workspaceAccessGateway";
import type { RegisteredRecord, SemanticRow, SharedSemanticStore } from "@/lib/domain/workspaceRecordSemantics";
import type { SharedRecordCandidate } from "@/lib/domain/sharedDatabasePolicy";

const workspaceId = "tenant01", databaseId = "db1";
const ownerId = "clerk_owner", memberId = "clerk_alice", otherId = "clerk_bob";
const taskIds = ["taskA", "taskB", "taskC", "taskD", "hiddenTask"];
const allIds = [...taskIds, "wiki1", "project1", "privateProject", "untyped"];
const names: Record<string, string> = {
  taskA: "Alpha", taskB: "Beta", taskC: "Gamma", taskD: "Delta",
  hiddenTask: "SECRET TASK", wiki1: "Wiki", project1: "Project",
  privateProject: "SECRET PROJECT", untyped: "Untyped",
};

function fixture() {
  const scopes: ScopeRow[] = [
    { workspaceId, pageId: databaseId, parentId: null, teamspaceId: null },
    ...allIds.map((pageId) => ({ workspaceId, pageId, parentId: databaseId, teamspaceId: null })),
  ];
  const members: MembershipRow[] = [
    { workspaceId, accountId: ownerId, role: "owner", status: "active" },
    { workspaceId, accountId: memberId, role: "member", status: "active" },
    { workspaceId, accountId: otherId, role: "member", status: "active" },
  ];
  const grants: GrantRow[] = [
    { workspaceId, pageId: databaseId, subjectType: "account",
      subjectId: memberId, effect: "allow", level: "view" },
    ...["hiddenTask", "privateProject"].map((pageId) => ({
      workspaceId, pageId, subjectType: "account" as const,
      subjectId: memberId, effect: "deny" as const, level: "view" as const,
    })),
  ];
  const metadata: RegisteredRecord[] = allIds.map((pageId) => ({
    workspaceId, databaseId, pageId, kind: "record", archivedAt: null,
    title: names[pageId], updatedAt: 20,
  }));
  const semantics: SemanticRow[] = [
    { workspaceId, databaseId, recordId: "taskA", kind: "task", state: "todo",
      assigneeId: memberId, projectId: "privateProject", dueAt: 1000, archivedAt: null, updatedAt: 11 },
    { workspaceId, databaseId, recordId: "taskB", kind: "task", state: "done",
      assigneeId: otherId, projectId: "project1", dueAt: 2000, archivedAt: null, updatedAt: 12 },
    { workspaceId, databaseId, recordId: "taskC", kind: "task", state: "blocked",
      assigneeId: null, projectId: null, dueAt: null, archivedAt: null, updatedAt: 13 },
    { workspaceId, databaseId, recordId: "taskD", kind: "task", state: "in_progress",
      assigneeId: null, projectId: null, dueAt: 1500, archivedAt: null, updatedAt: 14 },
    { workspaceId, databaseId, recordId: "hiddenTask", kind: "task", state: "todo",
      assigneeId: memberId, projectId: null, dueAt: 1200, archivedAt: null, updatedAt: 15 },
    { workspaceId, databaseId, recordId: "wiki1", kind: "wiki", state: "approved",
      assigneeId: null, projectId: null, dueAt: null, archivedAt: null, updatedAt: 16 },
    ...["project1", "privateProject"].map((recordId): SemanticRow => ({
      workspaceId, databaseId, recordId, kind: "project", state: "active",
      assigneeId: null, projectId: null, dueAt: null, archivedAt: null, updatedAt: 17,
    })),
  ];
  let offline = false;
  const store: SharedSemanticStore = {
    workspaces: async () => [{ workspaceId, ownerId, status: "active" }],
    memberships: async (_id, account) => members.filter((row) => row.accountId === account),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (_id, id) => scopes.filter((row) => row.pageId === id),
    grants: async (_id, id) => grants.filter((row) => row.pageId === id),
    databaseBindings: async () => [{ workspaceId, pageId: databaseId, kind: "database", archivedAt: null }],
    recordCandidates: async () => metadata.map((row): SharedRecordCandidate => ({ ...row })),
    recordMetadata: async (id) => metadata.filter((row) => row.pageId === id),
    semanticRows: async (id) => {
      if (offline) throw new Error("backend unavailable");
      return semantics.filter((row) => row.recordId === id);
    },
  };
  const read = (view: TaskViewKind = "list", limit = 25, after: string | null = null,
    from: number | null = null, to: number | null = null, actor: string | null = memberId) =>
    pageAuthorizedTaskView(store, actor, workspaceId, databaseId, { view, limit, after, from, to });
  return { read, scopes, members, grants, metadata, semantics, store,
    offline: () => { offline = true; } };
}
const ids = (records: readonly { recordId: string }[]) => records.map((row) => row.recordId);
const empty = { records: [], nextCursor: null };

describe("Max 2.0 PR35 authorized read-only task view projections", () => {
  it("lists only visible typed tasks, sorted by title with stable ID ties", async () => {
    const f = fixture();
    const result = await f.read();
    expect(ids(result.records)).toEqual(["taskA", "taskB", "taskD", "taskC"]);
    expect(result.nextCursor).toBeNull();
    expect(JSON.stringify(result)).not.toContain("hiddenTask");
    expect(JSON.stringify(result)).not.toContain("SECRET");
    expect(result.records[0]).toEqual({
      recordId: "taskA", title: "Alpha", state: "todo", dueAt: 1000,
      assignedToMe: true, projectId: null, updatedAt: 20,
    });
    f.metadata.find((row) => row.pageId === "taskD")!.title = "Beta";
    expect(ids((await f.read()).records)).toEqual(["taskA", "taskB", "taskD", "taskC"]);
  });

  it("boards are grouped by fixed task states without hidden totals", async () => {
    const f = fixture();
    const page = await f.read("board");
    expect(ids(page.records)).toEqual(["taskA", "taskD", "taskC", "taskB"]);
    expect(Object.keys(page)).toEqual(["records", "nextCursor"]);
    expect(Object.keys(page.records[0])).toEqual([
      "recordId", "title", "state", "dueAt", "assignedToMe", "projectId", "updatedAt",
    ]);
  });

  it("calendar returns only due milestones in a bounded UTC window", async () => {
    const f = fixture();
    expect(ids((await f.read("calendar", 25, null, 900, 1900)).records))
      .toEqual(["taskA", "taskD"]);
    expect(ids((await f.read("calendar", 25, null, 1000, 1500)).records))
      .toEqual(["taskA"]);
    expect(ids((await f.read("calendar", 25, null, 1500, 2000)).records))
      .toEqual(["taskD"]);
  });

  it("timeline orders due-date milestones, not fabricated start/end spans", async () => {
    const f = fixture();
    expect(ids((await f.read("timeline", 25, null, 900, 2500)).records))
      .toEqual(["taskA", "taskD", "taskB"]);
  });

  it("pages by a currently visible task ID, not hidden/untyped index offsets", async () => {
    const f = fixture();
    expect(await f.read("list", 2)).toMatchObject({ nextCursor: "taskB" });
    expect(ids((await f.read("list", 2, "taskB")).records)).toEqual(["taskD", "taskC"]);
    expect(await f.read("list", 2, "hiddenTask")).toEqual(empty);
    expect(await f.read("list", 2, "wiki1")).toEqual(empty);
    expect(await f.read("list", 2, "untyped")).toEqual(empty);
    expect(await f.read("list", 2, "forged")).toEqual(empty);
  });

  it("revocation and record-level denial invalidate previously issued cursors", async () => {
    const f = fixture();
    expect((await f.read("list", 1)).nextCursor).toBe("taskA");
    f.grants.push({ workspaceId, pageId: "taskA", subjectType: "account",
      subjectId: memberId, effect: "deny", level: "view" });
    expect(await f.read("list", 1, "taskA")).toEqual(empty);
    f.grants.pop();
    f.members.find((row) => row.accountId === memberId)!.status = "revoked";
    expect(await f.read("list")).toEqual(empty);
  });

  it("redacts hidden linked project IDs and other assignees", async () => {
    const f = fixture();
    const page = await f.read();
    const taskA = page.records.find((row) => row.recordId === "taskA")!;
    const taskB = page.records.find((row) => row.recordId === "taskB")!;
    expect(taskA.projectId).toBeNull();
    expect(taskB.projectId).toBe("project1");
    expect(taskB.assignedToMe).toBe(false);
    expect(JSON.stringify(page)).not.toContain(otherId);
    expect(JSON.stringify(page)).not.toContain("privateProject");
  });

  it("rejects wrong tenant, duplicate and invalid record ancestry without partial rows", async () => {
    const f = fixture();
    f.metadata.find((row) => row.pageId === "taskB")!.workspaceId = "tenant02";
    expect(await f.read()).toEqual(empty);
    f.metadata.find((row) => row.pageId === "taskB")!.workspaceId = workspaceId;
    f.metadata.push({ ...f.metadata[0] });
    expect(await f.read()).toEqual(empty);
    f.metadata.pop();
    f.scopes.find((row) => row.pageId === "taskB")!.parentId = "otherdb";
    expect(await f.read()).toEqual(empty);
  });

  it("rejects duplicate or corrupt visible semantics and broken project targets", async () => {
    const f = fixture();
    f.semantics.push({ ...f.semantics[0] });
    expect(await f.read()).toEqual(empty);
    f.semantics.pop();
    f.semantics.find((row) => row.recordId === "project1")!.kind = "wiki";
    expect(await f.read()).toEqual(empty);
  });

  it("validates view names, limits, cursors, UTC dates and window budgets", () => {
    const base: TaskViewRequest = { view: "list", limit: 25, after: null, from: null, to: null };
    expect(validTaskViewRequest(base)).toBe(true);
    expect(validTaskViewRequest({ ...base, view: "board" })).toBe(true);
    expect(validTaskViewRequest({ ...base, limit: 26 })).toBe(false);
    expect(validTaskViewRequest({ ...base, limit: 0 })).toBe(false);
    expect(validTaskViewRequest({ ...base, after: "../secret" })).toBe(false);
    expect(validTaskViewRequest({ ...base, from: 0 })).toBe(false);
    expect(validTaskViewRequest({ ...base, view: "calendar" })).toBe(false);
    expect(validTaskViewRequest({ ...base, view: "calendar", from: 0, to: 46 * 86400000 })).toBe(false);
    expect(validTaskViewRequest({ ...base, view: "timeline", from: 0, to: 367 * 86400000 })).toBe(false);
    expect(validTaskViewRequest({ ...base, view: "timeline", from: 100, to: 100 })).toBe(false);
    expect(validTaskViewRequest({ ...base, view: "timeline", from: NaN, to: 1000 })).toBe(false);
    expect(validTaskViewRequest({ ...base, view: "calendar", from: 0, to: 86400000 })).toBe(true);
  });

  it("enforces 100-candidate ceiling before projecting or exposing cursors", async () => {
    const f = fixture();
    for (let i = 0; i < 92; i++) {
      const pageId = "overflow" + i;
      f.metadata.push({ workspaceId, databaseId, pageId, kind: "record",
        archivedAt: null, title: pageId, updatedAt: 20 });
      f.scopes.push({ workspaceId, pageId, parentId: databaseId, teamspaceId: null });
    }
    expect(await f.read()).toEqual(empty);
  });

  it("returns the same empty envelope for unknown identities and store failures", async () => {
    const f = fixture();
    expect(await f.read("list", 25, null, null, null, null)).toEqual(empty);
    expect(await f.read("list", 25, null, null, null, "clerk_unknown")).toEqual(empty);
    f.offline();
    expect(await f.read()).toEqual(empty);
  });
});
