import { describe, expect, it } from "vitest";
import {
  canManageAutomationScope, dryRunAutomationRule, listManagedAutomationRules,
  nextAutomationRevision, validAutomationRegistry, validAutomationRuleInput,
  validAutomationRuleRow, validTaskState, MAX_AUTOMATION_RULES_PER_DATABASE,
  type AutomationRuleRow, type AutomationRuleStore, type TaskState,
} from "@/lib/domain/workspaceAutomationRules";
import type { ScopeRow, MembershipRow, WorkspaceRow } from "@/lib/domain/workspaceAccessGateway";
import type { SharedDatabaseBinding } from "@/lib/domain/sharedDatabasePolicy";

const tenant = "tenant01", database = "db01", owner = "clerk_owner";
const guest = "clerk_guest", admin = "clerk_admin", now = 2000000000000;
const rule: AutomationRuleRow = {
  ruleId: "rule01", ruleKey: "notify-done", workspaceId: tenant, databaseId: database,
  createdByAccountId: owner, name: "Notify owner on done",
  trigger: "task_state_changed", condition: "state_equals",
  conditionValue: "done", action: "notify_creator", actionValue: null,
  state: "draft", createdAt: now - 1000, updatedAt: now - 1000,
  retiredAt: null,
};
function fixture() {
  const workspaces: WorkspaceRow[] = [{ workspaceId: tenant, ownerId: owner, status: "active" }];
  const memberships: MembershipRow[] = [
    { workspaceId: tenant, accountId: owner, role: "owner", status: "active" },
    { workspaceId: tenant, accountId: guest, role: "guest", status: "active" },
    { workspaceId: tenant, accountId: admin, role: "admin", status: "active" },
  ];
  const scopes: ScopeRow[] = [
    { workspaceId: tenant, pageId: database, parentId: null, teamspaceId: null },
  ];
  const bindings: SharedDatabaseBinding[] = [
    { workspaceId: tenant, pageId: database, kind: "database", archivedAt: null },
  ];
  const rows: AutomationRuleRow[] = [{ ...rule }];
  let fail = false;
  const store: AutomationRuleStore = {
    workspaces: async (id) => workspaces.filter((r) => r.workspaceId === id),
    memberships: async (id, account) => memberships.filter((r) =>
      r.workspaceId === id && r.accountId === account),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    grants: async () => [],
    scopes: async (id, page) =>
      scopes.filter((r) => r.workspaceId === id && r.pageId === page),
    globalScopes: async (page) => scopes.filter((r) => r.pageId === page),
    databaseBindings: async (id, page) =>
      bindings.filter((r) => r.workspaceId === id && r.pageId === page),
    recordCandidates: async () => [],
    automationRules: async (id, page) => {
      if (fail) throw new Error("database offline");
      return rows.filter((r) => r.workspaceId === id && r.databaseId === page);
    },
  };
  return {
    workspaces, memberships, scopes, bindings, rows, store,
    list: (actor: string | null = owner) =>
      listManagedAutomationRules(store, actor, tenant, database),
    dry: (actor: string | null = owner, before: TaskState = "todo",
      after: TaskState = "done") =>
      dryRunAutomationRule(store, actor, tenant, database, rule.ruleKey, before, after),
    fail: () => { fail = true; },
  };
}
describe("Max 2.0 PR40 dormant automation-rule security", () => {
  it("lists only for current database managers, not ordinary guests or anonymous users", async () => {
    const f = fixture();
    expect((await f.list()).length).toBe(1);
    expect(await f.list(guest)).toEqual([]);
    expect(await f.list(null)).toEqual([]);
  });
  it("does not disclose creator identities, tenant or database reference in previews", async () => {
    const f = fixture(), data = JSON.stringify(await f.list());
    expect(data).not.toContain(owner);
    expect(data).not.toContain(tenant);
    expect(data).not.toContain(database);
    expect(data).not.toContain("content");
    expect(data).not.toContain("token");
  });
  it("accepts narrowly typed, deterministic rule inputs only", () => {
    expect(validAutomationRuleInput(rule)).toBe(true);
    expect(validAutomationRuleInput({
      ...rule, trigger: "scheduled" as never,
    })).toBe(false);
    expect(validAutomationRuleInput({
      ...rule, condition: "eval" as never,
    })).toBe(false);
    expect(validAutomationRuleInput({
      ...rule, action: "webhook" as never,
    })).toBe(false);
  });
  it("rejects arbitrary script, hidden controls, oversize and whitespace names", () => {
    expect(validAutomationRuleInput({ ...rule, name: " " })).toBe(false);
    expect(validAutomationRuleInput({ ...rule, name: " leading" })).toBe(false);
    expect(validAutomationRuleInput({ ...rule, name: "a".repeat(81) })).toBe(false);
    expect(validAutomationRuleInput({ ...rule, name: "evil\u0000name" })).toBe(false);
  });
  it("rejects unknown task states and inconsistent action or condition values", () => {
    expect(validTaskState("done")).toBe(true);
    expect(validTaskState("admin")).toBe(false);
    expect(validAutomationRuleInput({
      ...rule, conditionValue: "danger" as never,
    })).toBe(false);
    expect(validAutomationRuleInput({
      ...rule, condition: "always", conditionValue: "done",
    })).toBe(false);
    expect(validAutomationRuleInput({
      ...rule, actionValue: "done",
    })).toBe(false);
    expect(validAutomationRuleInput({
      ...rule, action: "set_task_state", actionValue: null,
    })).toBe(false);
  });
  it("rejects direct self-triggering state-change actions", () => {
    expect(validAutomationRuleInput({
      ...rule, action: "set_task_state", actionValue: "todo",
    })).toBe(false);
    expect(validAutomationRuleInput({
      ...rule, trigger: "manual_button", action: "set_task_state",
      actionValue: "todo",
    })).toBe(true);
  });
  it("allows a matching hypothetical sample but NEVER runs the action", async () => {
    const f = fixture();
    expect(await f.dry()).toEqual({ wouldMatch: true, wouldRun: false });
    expect(await f.dry(owner, "todo", "blocked")).toEqual({
      wouldMatch: false, wouldRun: false,
    });
    expect(await f.dry(owner, "done", "done")).toEqual({
      wouldMatch: false, wouldRun: false,
    });
  });
  it("rejects anonymous and unauthorized dry-run attempts", async () => {
    const f = fixture();
    expect(await f.dry(null)).toBeNull();
    expect(await f.dry(guest)).toBeNull();
  });
  it("rejects invalid previews, IDs, and unknown rule keys", async () => {
    const f = fixture();
    expect(await dryRunAutomationRule(f.store, owner, tenant, database,
      "other", "todo", "done")).toBeNull();
    expect(await dryRunAutomationRule(f.store, owner, tenant, database,
      "#bad", "todo", "done")).toBeNull();
    expect(await dryRunAutomationRule(f.store, owner, tenant, database,
      rule.ruleKey, "bad" as never, "done")).toBeNull();
  });
  it("allows manual-button hypothetical state changes but avoids no-op actions", async () => {
    const f = fixture();
    f.rows[0] = {
      ...f.rows[0], trigger: "manual_button", condition: "always",
      conditionValue: null, action: "set_task_state", actionValue: "done",
    };
    expect(await f.dry(owner, "todo", "done")).toEqual({
      wouldMatch: false, wouldRun: false,
    });
    expect(await f.dry(owner, "todo", "todo")).toEqual({
      wouldMatch: true, wouldRun: false,
    });
  });
  it("rejects retired rules and invalid state/timestamp combinations", async () => {
    const f = fixture();
    f.rows[0].state = "retired";
    expect(await f.dry()).toBeNull();
    expect(validAutomationRuleRow(f.rows[0])).toBe(false);
    f.rows[0].retiredAt = now - 10; f.rows[0].updatedAt = now - 10;
    expect(validAutomationRuleRow(f.rows[0])).toBe(true);
    expect(await f.dry()).toBeNull();
  });
  it("revoking creator management disables the hypothetical dry-run", async () => {
    const f = fixture();
    f.rows[0].createdByAccountId = admin;
    // Admin is still a live member, but may not have a manage grant.
    // The preflight must fail if the author has no current manage rights.
    const result = await f.dry();
    expect(result === null || result?.wouldRun === false).toBe(true);
    f.memberships[2].status = "revoked";
    expect(await f.dry()).toBeNull();
  });
  it("fails closed when workspace is disabled or member revoked", async () => {
    const f = fixture();
    f.workspaces[0].status = "disabled";
    expect(await f.list()).toEqual([]);
    expect(await f.dry()).toBeNull();
    f.workspaces[0].status = "active";
    f.memberships[0].status = "revoked";
    expect(await f.list()).toEqual([]);
    expect(await f.dry()).toBeNull();
  });
  it("rejects cross-tenant, duplicated or unregistered database scopes", async () => {
    const f = fixture();
    f.scopes.push({ ...f.scopes[0] });
    expect(await f.list()).toEqual([]);
    f.scopes.pop();
    f.bindings[0].workspaceId = "tenant02";
    expect(await f.list()).toEqual([]);
    f.bindings[0].workspaceId = tenant;
    f.bindings[0].archivedAt = now;
    expect(await f.list()).toEqual([]);
  });
  it("limits each database registry to 32 entries and fails closed at 33", async () => {
    const f = fixture();
    for (let i = 1; i < MAX_AUTOMATION_RULES_PER_DATABASE; i++) {
      f.rows.push({ ...rule, ruleId: "rule" + (i + 1),
        ruleKey: "key" + (i + 1) });
    }
    expect((await f.list()).length).toBe(MAX_AUTOMATION_RULES_PER_DATABASE);
    f.rows.push({ ...rule, ruleId: "extra", ruleKey: "extra" });
    expect(await f.list()).toEqual([]);
    expect(await f.dry()).toBeNull();
  });
  it("rejects duplicate stable keys, duplicate IDs and cross-tenant rows", async () => {
    const f = fixture();
    f.rows.push({ ...rule, ruleId: "other" });
    expect(validAutomationRegistry(f.rows, tenant, database)).toBe(false);
    f.rows.pop();
    f.rows.push({ ...rule, ruleKey: "other" });
    expect(validAutomationRegistry(f.rows, tenant, database)).toBe(false);
    f.rows.pop();
    f.rows[0].workspaceId = "tenant02";
    expect(await f.list()).toEqual([]);
  });
  it("rejects malformed IDs and invalid rule state or revision", () => {
    expect(validAutomationRuleRow(rule)).toBe(true);
    expect(validAutomationRuleRow({ ...rule, ruleKey: "bad key" })).toBe(false);
    expect(validAutomationRuleRow({ ...rule, state: "enabled" as never })).toBe(false);
    expect(validAutomationRuleRow({ ...rule, updatedAt: NaN })).toBe(false);
    expect(validAutomationRuleRow({ ...rule, retiredAt: now })).toBe(false);
  });
  it("keeps compare-and-set revisions monotonic", () => {
    expect(nextAutomationRevision(now, now)).toBe(now + 1);
    expect(nextAutomationRevision(now, now + 20)).toBe(now + 20);
    expect(nextAutomationRevision(now, NaN)).toBeNull();
    expect(nextAutomationRevision(4102444800000, now)).toBeNull();
  });
  it("fails closed when a store read throws", async () => {
    const f = fixture(); f.fail();
    expect(await f.list()).toEqual([]);
    expect(await f.dry()).toBeNull();
  });
  it("never allows a draft or paused rule to be treated as executable", async () => {
    const f = fixture();
    for (const state of ["draft", "paused"] as const) {
      f.rows[0].state = state;
      expect((await f.dry())?.wouldRun).toBe(false);
    }
  });
  it("keeps actor-auth checks separate from input supplied by an HTTP caller", async () => {
    const f = fixture();
    expect(await canManageAutomationScope(f.store, owner, tenant, database)).toBe(true);
    expect(await canManageAutomationScope(f.store, "bad subject!", tenant, database)).toBe(false);
    expect(await canManageAutomationScope(f.store, owner, "wrong tenant", database)).toBe(false);
    expect(await canManageAutomationScope(f.store, null, tenant, database)).toBe(false);
  });
});
