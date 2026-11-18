import { describe, expect, it } from "vitest";
import {
  canLinkTask, readAuthorizedTaskRelations, validTaskRelationGraph,
  validTaskRelationInput, type TaskRelationRow, type TaskRelationStore,
} from "@/lib/domain/workspaceTaskRelations";
import type { GrantRow, MembershipRow, ScopeRow } from "@/lib/domain/workspaceAccessGateway";
import type { RegisteredRecord, SemanticRow } from "@/lib/domain/workspaceRecordSemantics";

const workspaceId = "tenant01", databaseId = "db1";
const ownerId = "clerk_owner", actorId = "clerk_alice";
const a = "taskA", b = "taskB", c = "taskC", hidden = "taskHidden";

function relation(recordId: string, parentTaskId: string | null = null,
  dependsOn: readonly string[] = [], updatedAt = 10): TaskRelationRow {
  return { workspaceId, databaseId, recordId, parentTaskId, dependsOn,
    archivedAt: null, updatedAt };
}

function fixture() {
  const scopes: ScopeRow[] = [
    { workspaceId, pageId: databaseId, parentId: null, teamspaceId: null },
    ...[a, b, c, hidden].map((pageId) => ({
      workspaceId, pageId, parentId: databaseId, teamspaceId: null,
    })),
  ];
  const members: MembershipRow[] = [
    { workspaceId, accountId: ownerId, role: "owner", status: "active" },
    { workspaceId, accountId: actorId, role: "member", status: "active" },
  ];
  const grants: GrantRow[] = [
    { workspaceId, pageId: databaseId, subjectType: "account",
      subjectId: actorId, effect: "allow", level: "view" },
    { workspaceId, pageId: hidden, subjectType: "account",
      subjectId: actorId, effect: "deny", level: "view" },
  ];
  const metadata: RegisteredRecord[] = [a, b, c, hidden].map((pageId) => ({
    workspaceId, databaseId, pageId, kind: "record", archivedAt: null,
    title: "Task metadata", updatedAt: 9,
  }));
  const semantics: SemanticRow[] = [a, b, c, hidden].map((recordId) => ({
    workspaceId, databaseId, recordId, kind: "task", state: "todo",
    assigneeId: null, projectId: null, dueAt: null,
    archivedAt: null, updatedAt: 9,
  }));
  const relations: TaskRelationRow[] = [
    relation(a, b, [hidden, c], 13),
    relation(b, null, [], 14),
    relation(c, null, [], 15),
    relation(hidden, null, [], 16),
  ];
  let offline = false;
  const store: TaskRelationStore = {
    workspaces: async () => [{ workspaceId, ownerId, status: "active" }],
    memberships: async (_ws, accountId) => members.filter((row) => row.accountId === accountId),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    scopes: async (_ws, pageId) => scopes.filter((row) => row.pageId === pageId),
    grants: async (_ws, pageId) => grants.filter((row) => row.pageId === pageId),
    databaseBindings: async () => [{ workspaceId, pageId: databaseId,
      kind: "database", archivedAt: null }],
    recordCandidates: async () => [],
    recordMetadata: async (id) => metadata.filter((row) => row.pageId === id),
    semanticRows: async (id) => semantics.filter((row) => row.recordId === id),
    taskRelations: async (id) => {
      if (offline) throw new Error("unavailable");
      return relations.filter((row) => row.recordId === id);
    },
  };
  const read = (id = a, principal: string | null = actorId) =>
    readAuthorizedTaskRelations(store, principal, workspaceId, databaseId, id);
  return { store, read, scopes, members, grants, metadata, semantics, relations,
    offline: () => { offline = true; } };
}

describe("Max 2.0 PR34 scoped task relations", () => {
  it("shows only visible task links, hiding inaccessible IDs without hidden counts", async () => {
    const f = fixture();
    expect(await f.read()).toEqual({
      recordId: a, parentTaskId: b, dependsOn: [c], updatedAt: 13,
    });
    expect(JSON.stringify(await f.read())).not.toContain(hidden);
  });
  it("redacts an inaccessible parent but retains authorized dependencies", async () => {
    const f = fixture();
    f.relations[0].parentTaskId = hidden;
    f.relations[0].dependsOn = [c];
    expect(await f.read()).toEqual({
      recordId: a, parentTaskId: null, dependsOn: [c], updatedAt: 13,
    });
  });
  it("never reads a revoked user's task or link, even with cached records", async () => {
    const f = fixture();
    f.members[1].status = "revoked";
    expect(await f.read()).toBeNull();
    expect(await canLinkTask(f.store, actorId, workspaceId, databaseId, b)).toBe(false);
  });
  it("rechecks record-level denial and requires an actual task semantic row", async () => {
    const f = fixture();
    f.grants.push({ workspaceId, pageId: a, subjectType: "account",
      subjectId: actorId, effect: "deny", level: "view" });
    expect(await f.read()).toBeNull();
    f.grants.pop();
    f.semantics[1].kind = "wiki";
    expect(await f.read()).toBeNull();
  });
  it("rejects foreign, unregistered, archived and duplicate linked tasks", async () => {
    const f = fixture();
    f.metadata[1].workspaceId = "tenant02";
    expect(await f.read()).toBeNull();
    f.metadata[1].workspaceId = workspaceId;
    f.metadata[1].archivedAt = 5;
    expect(await f.read()).toBeNull();
    f.metadata[1].archivedAt = null;
    f.semantics.push({ ...f.semantics[1] });
    expect(await f.read()).toBeNull();
  });
  it("fails closed for duplicate or corrupt relation rows and backend failures", async () => {
    const f = fixture();
    f.relations.push({ ...f.relations[0] });
    expect(await f.read()).toBeNull();
    f.relations.pop();
    f.relations[0].databaseId = "otherdb";
    expect(await f.read()).toBeNull();
    f.relations[0].databaseId = databaseId;
    f.offline();
    expect(await f.read()).toBeNull();
  });
  it("validates bounded, distinct, non-self task links", () => {
    expect(validTaskRelationInput({ parentTaskId: b, dependsOn: [c] }, a)).toBe(true);
    expect(validTaskRelationInput({ parentTaskId: a, dependsOn: [] }, a)).toBe(false);
    expect(validTaskRelationInput({ parentTaskId: b, dependsOn: [b] }, a)).toBe(false);
    expect(validTaskRelationInput({ parentTaskId: null, dependsOn: [c, c] }, a)).toBe(false);
    expect(validTaskRelationInput({ parentTaskId: null, dependsOn: Array.from({ length: 9 }, (_, i) => "task" + i) }, a)).toBe(false);
    expect(validTaskRelationInput({ parentTaskId: null, dependsOn: ["unsafe id"] }, a)).toBe(false);
  });
  it("prevents direct and indirect dependency cycles", () => {
    const existing = [relation(a, null, [b]), relation(b, null, [c])];
    expect(validTaskRelationGraph(existing, relation(c, null, [a]), workspaceId, databaseId)).toBe(false);
    expect(validTaskRelationGraph(existing, relation(c, null, []), workspaceId, databaseId)).toBe(true);
  });
  it("prevents parent cycles and mixed parent/dependency cycles", () => {
    const existing = [relation(a, b), relation(b, null, [c])];
    expect(validTaskRelationGraph(existing, relation(c, a), workspaceId, databaseId)).toBe(false);
    expect(validTaskRelationGraph(existing, relation(c), workspaceId, databaseId)).toBe(true);
  });
  it("rejects cross-tenant graph contamination, malformed timestamps and duplicate rows", () => {
    const rows = [relation(a), relation(b)];
    expect(validTaskRelationGraph(rows, relation(c), workspaceId, databaseId)).toBe(true);
    expect(validTaskRelationGraph([...rows, { ...rows[0] }], relation(c), workspaceId, databaseId)).toBe(false);
    expect(validTaskRelationGraph([{ ...rows[0], workspaceId: "tenant02" }], relation(c), workspaceId, databaseId)).toBe(false);
    expect(validTaskRelationGraph([{ ...rows[0], updatedAt: -1 }], relation(c), workspaceId, databaseId)).toBe(false);
    expect(validTaskRelationGraph(rows, { ...relation(c), archivedAt: 12 }, workspaceId, databaseId)).toBe(false);
  });
  it("preserves a 100-relation cap and permits CAS replacements of existing nodes", () => {
    const rows = Array.from({ length: 100 }, (_, i) => relation("task" + i));
    expect(validTaskRelationGraph(rows, relation("task100"), workspaceId, databaseId)).toBe(false);
    expect(validTaskRelationGraph(rows, relation("task0", null, ["task1"]), workspaceId, databaseId)).toBe(true);
  });
  it("rejects missing or untrusted identities without leaking target IDs", async () => {
    const f = fixture();
    expect(await f.read(a, null)).toBeNull();
    expect(await f.read(a, "clerk_unknown")).toBeNull();
    expect(await f.read("unregistered")).toBeNull();
  });
});
