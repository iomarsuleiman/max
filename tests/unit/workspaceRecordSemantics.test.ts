import { describe, expect, it } from "vitest";
import {
  readAuthorizedRecordSemantics, validSemanticInput,
  type RegisteredRecord, type SemanticRow, type SharedSemanticStore,
} from "@/lib/domain/workspaceRecordSemantics";
import type { GrantRow, ScopeRow, MembershipRow } from "@/lib/domain/workspaceAccessGateway";

const workspaceId = "tenant01";
const databaseId = "db1";
const ownerId = "clerk_owner";
const accountId = "clerk_alice";
const otherId = "clerk_bob";
const taskId = "task1";
const projectId = "project1";

function fixture() {
  const scopes: ScopeRow[] = [
    { workspaceId, pageId: databaseId, parentId: null, teamspaceId: null },
    ...[taskId, projectId, "wiki1", "secretProject"].map((pageId) => ({
      workspaceId, pageId, parentId: databaseId, teamspaceId: null,
    })),
  ];
  const members: MembershipRow[] = [
    { workspaceId, accountId: ownerId, role: "owner", status: "active" },
    { workspaceId, accountId, role: "member", status: "active" },
    { workspaceId, accountId: otherId, role: "member", status: "active" },
  ];
  const grants: GrantRow[] = [
    { workspaceId, pageId: databaseId, subjectType: "account", subjectId: accountId, effect: "allow", level: "view" },
    { workspaceId, pageId: "secretProject", subjectType: "account", subjectId: accountId, effect: "deny", level: "view" },
  ];
  const metadata: RegisteredRecord[] = [taskId, projectId, "wiki1", "secretProject"].map((pageId) => ({
    workspaceId, databaseId, pageId, kind: "record", archivedAt: null,
    title: "metadata only", updatedAt: 10,
  }));
  const semanticRows: SemanticRow[] = [
    { workspaceId, databaseId, recordId: taskId, kind: "task", state: "todo",
      assigneeId: accountId, projectId, dueAt: 2000000000000, archivedAt: null, updatedAt: 11 },
    { workspaceId, databaseId, recordId: projectId, kind: "project", state: "active",
      assigneeId: null, projectId: null, dueAt: null, archivedAt: null, updatedAt: 12 },
    { workspaceId, databaseId, recordId: "wiki1", kind: "wiki", state: "in_review",
      assigneeId: null, projectId: null, dueAt: null, archivedAt: null, updatedAt: 13 },
    { workspaceId, databaseId, recordId: "secretProject", kind: "project", state: "active",
      assigneeId: null, projectId: null, dueAt: null, archivedAt: null, updatedAt: 14 },
  ];
  let throwStore = false;
  const store: SharedSemanticStore = {
    workspaces: async () => [{ workspaceId, ownerId, status: "active" }],
    memberships: async (_id, account) => members.filter((row) => row.accountId === account),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (_id, pageId) => scopes.filter((row) => row.pageId === pageId),
    grants: async (_id, pageId) => grants.filter((row) => row.pageId === pageId),
    databaseBindings: async () => [{ workspaceId, pageId: databaseId, kind: "database", archivedAt: null }],
    recordCandidates: async () => [],
    recordMetadata: async (recordId) => metadata.filter((row) => row.pageId === recordId),
    semanticRows: async (recordId) => {
      if (throwStore) throw new Error("backend unavailable");
      return semanticRows.filter((row) => row.recordId === recordId);
    },
  };
  const read = (recordId = taskId, actor: string | null = accountId) =>
    readAuthorizedRecordSemantics(store, actor, workspaceId, databaseId, recordId);
  return {
    read, scopes, members, grants, metadata, semanticRows,
    corruptStore: () => { throwStore = true; },
  };
}

describe("Max 2.0 PR33 scoped task, project and wiki semantics", () => {
  it("returns only whitelisted visible task semantics and self-assignment", async () => {
    const f = fixture();
    expect(await f.read()).toEqual({
      recordId: taskId, kind: "task", state: "todo", dueAt: 2000000000000,
      assignedToMe: true, projectId, updatedAt: 11,
    });
    expect(Object.keys((await f.read())!)).toEqual([
      "recordId", "kind", "state", "dueAt", "assignedToMe", "projectId", "updatedAt",
    ]);
  });
  it("does not disclose third-party assignee identities", async () => {
    const f = fixture();
    f.semanticRows[0].assigneeId = otherId;
    const result = await f.read();
    expect(result?.assignedToMe).toBe(false);
    expect(JSON.stringify(result)).not.toContain(otherId);
  });
  it("redacts project IDs when the project has an explicit per-record deny", async () => {
    const f = fixture();
    f.semanticRows[0].projectId = "secretProject";
    const result = await f.read();
    expect(result?.projectId).toBeNull();
    expect(JSON.stringify(result)).not.toContain("secretProject");
  });
  it("does not expose records after membership revocation or record denial", async () => {
    const f = fixture();
    f.members.find((row) => row.accountId === accountId)!.status = "revoked";
    expect(await f.read()).toBeNull();
    f.members.find((row) => row.accountId === accountId)!.status = "active";
    f.grants.push({ workspaceId, pageId: taskId, subjectType: "account",
      subjectId: accountId, effect: "deny", level: "view" });
    expect(await f.read()).toBeNull();
  });
  it("requires database and record ancestry and rejects cross-tenant metadata", async () => {
    const f = fixture();
    f.scopes.find((row) => row.pageId === taskId)!.parentId = "otherdb";
    expect(await f.read()).toBeNull();
    f.scopes.find((row) => row.pageId === taskId)!.parentId = databaseId;
    f.metadata.find((row) => row.pageId === taskId)!.workspaceId = "tenant02";
    expect(await f.read()).toBeNull();
  });
  it("rejects duplicate, malformed and mismatched project semantics", async () => {
    const f = fixture();
    f.semanticRows.push({ ...f.semanticRows[0] });
    expect(await f.read()).toBeNull();
    f.semanticRows.pop();
    f.semanticRows.find((row) => row.recordId === projectId)!.kind = "wiki";
    expect(await f.read()).toBeNull();
    f.semanticRows.find((row) => row.recordId === projectId)!.kind = "project";
    f.semanticRows.find((row) => row.recordId === projectId)!.workspaceId = "tenant02";
    expect(await f.read()).toBeNull();
  });
  it("validates bounded statuses, dates and kind-specific fields", () => {
    const task = { kind: "task" as const, state: "blocked", assigneeId: accountId,
      projectId, dueAt: 1000 };
    expect(validSemanticInput(task, taskId)).toBe(true);
    expect(validSemanticInput({ ...task, dueAt: Infinity }, taskId)).toBe(false);
    expect(validSemanticInput({ ...task, dueAt: 4102444800001 }, taskId)).toBe(false);
    expect(validSemanticInput({ ...task, projectId: taskId }, taskId)).toBe(false);
    expect(validSemanticInput({ ...task, state: "published" }, taskId)).toBe(false);
    expect(validSemanticInput({ kind: "wiki", state: "approved", assigneeId: null,
      projectId: null, dueAt: null }, "wiki1")).toBe(true);
    expect(validSemanticInput({ kind: "wiki", state: "approved", assigneeId: accountId,
      projectId: null, dueAt: null }, "wiki1")).toBe(false);
    expect(validSemanticInput({ kind: "project", state: "active", assigneeId: null,
      projectId: null, dueAt: null }, projectId)).toBe(true);
  });
  it("fails closed for unknown accounts and backend failures", async () => {
    const f = fixture();
    expect(await f.read(taskId, null)).toBeNull();
    expect(await f.read(taskId, "not_member")).toBeNull();
    f.corruptStore();
    expect(await f.read()).toBeNull();
  });
  it("reads project and wiki states without task fields or personal content", async () => {
    const f = fixture();
    expect(await f.read("wiki1")).toEqual({
      recordId: "wiki1", kind: "wiki", state: "in_review", dueAt: null,
      assignedToMe: false, projectId: null, updatedAt: 13,
    });
    expect((await f.read(projectId))?.state).toBe("active");
  });
});
