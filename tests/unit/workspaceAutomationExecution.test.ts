import { describe, expect, it } from "vitest";
import {
  canRecordAutomationIntent, cancellationRevision, hypotheticalAutomationRetry,
  projectAutomationRun, sameAutomationIntent, validAutomationCausalLineage,
  validAutomationRunJournal, validAutomationRunKey, validAutomationRunRegistry,
  validAutomationRunRow, MAX_AUTOMATION_ATTEMPTS, MAX_AUTOMATION_DEPTH,
  MAX_AUTOMATION_INTENTS_PER_DATABASE, type AutomationRunEvent, type AutomationRunRow,
} from "@/lib/domain/workspaceAutomationExecution";
import {
  type AutomationRuleRow, type AutomationRuleStore,
} from "@/lib/domain/workspaceAutomationRules";
import type { MembershipRow, ScopeRow, WorkspaceRow } from "@/lib/domain/workspaceAccessGateway";
import type { SharedDatabaseBinding } from "@/lib/domain/sharedDatabasePolicy";

const ws = "tenant01", db = "db01", owner = "clerk_owner", guest = "clerk_guest";
const now = 2000000000000, key = "manual-request-0001";
const run: AutomationRunRow = {
  runId: "run01", workspaceId: ws, databaseId: db,
  ruleKey: "rule01", runKey: key, requestedByAccountId: owner,
  ruleUpdatedAt: now - 100, trigger: "manual_button",
  depth: 0, attempt: 0, state: "recorded", reason: null,
  createdAt: now, updatedAt: now, terminalAt: null,
};
const recorded: AutomationRunEvent = {
  workspaceId: ws, databaseId: db, runId: run.runId,
  sequence: 1, state: "recorded", actorId: owner, at: now,
};
const rule: AutomationRuleRow = {
  ruleId: "rule01", workspaceId: ws, databaseId: db,
  ruleKey: run.ruleKey, createdByAccountId: owner, name: "Manual reminder",
  trigger: "manual_button", condition: "always", conditionValue: null,
  action: "notify_creator", actionValue: null, state: "draft",
  createdAt: now - 1000, updatedAt: now - 100, retiredAt: null,
};
function fixture() {
  const workspaces: WorkspaceRow[] = [{ workspaceId: ws, ownerId: owner, status: "active" }];
  const memberships: MembershipRow[] = [
    { workspaceId: ws, accountId: owner, role: "owner", status: "active" },
    { workspaceId: ws, accountId: guest, role: "guest", status: "active" },
  ];
  const scopes: ScopeRow[] = [{ workspaceId: ws, pageId: db, parentId: null, teamspaceId: null }];
  const bindings: SharedDatabaseBinding[] = [{
    workspaceId: ws, pageId: db, kind: "database", archivedAt: null,
  }];
  const store: AutomationRuleStore = {
    workspaces: async (id) => workspaces.filter((x) => x.workspaceId === id),
    memberships: async (id, actor) => memberships.filter((x) =>
      x.workspaceId === id && x.accountId === actor),
    groups: async () => [], teamspaces: async () => [],
    groupRegistrations: async () => [], teamspaceRegistrations: async () => [],
    grants: async () => [],
    scopes: async (id, page) => scopes.filter((x) =>
      x.workspaceId === id && x.pageId === page),
    globalScopes: async (page) => scopes.filter((x) => x.pageId === page),
    databaseBindings: async (id, page) => bindings.filter((x) =>
      x.workspaceId === id && x.pageId === page),
    recordCandidates: async () => [],
    automationRules: async () => [rule],
  };
  const can = (actor: string | null = owner, source: AutomationRuleRow = rule,
    revision: number = rule.updatedAt) =>
    canRecordAutomationIntent(store, actor, ws, db, source, revision);
  return { store, can, memberships, workspaces, scopes, bindings };
}
describe("Max 2.0 PR41 inert automation execution safety", () => {
  it("accepts strict opaque replay keys only", () => {
    expect(validAutomationRunKey(key)).toBe(true);
    for (const bad of ["x", " space keys 123", "http://example", "a".repeat(65), null, 123]) {
      expect(validAutomationRunKey(bad)).toBe(false);
    }
  });
  it("validates a freshly recorded, non-executed manual intent", () => {
    expect(validAutomationRunRow(run)).toBe(true);
    expect(validAutomationRunRegistry([run], ws, db)).toBe(true);
  });
  it("rejects fabricated executable states", () => {
    for (const state of ["running", "queued", "succeeded", "failed"] as const) {
      expect(validAutomationRunRow({ ...run, state: state as never })).toBe(false);
    }
  });
  it("rejects nonmanual sources, speculative attempts, and nonzero depth", () => {
    expect(validAutomationRunRow({ ...run, trigger: "task_state_changed" as never })).toBe(false);
    expect(validAutomationRunRow({ ...run, attempt: 1 })).toBe(false);
    expect(validAutomationRunRow({ ...run, depth: 1 })).toBe(false);
  });
  it("rejects invalid timestamps, actor IDs, status reason and terminal fields", () => {
    expect(validAutomationRunRow({ ...run, updatedAt: NaN })).toBe(false);
    expect(validAutomationRunRow({ ...run, requestedByAccountId: "bad user!" })).toBe(false);
    expect(validAutomationRunRow({ ...run, reason: "policy_blocked" })).toBe(false);
    expect(validAutomationRunRow({ ...run, terminalAt: now })).toBe(false);
  });
  it("validates only consistent terminal cancellation and dead-letter records", () => {
    const canceled = { ...run, state: "canceled" as const,
      reason: "operator_cancelled" as const, terminalAt: now, updatedAt: now + 1 };
    expect(validAutomationRunRow(canceled)).toBe(true);
    expect(validAutomationRunRow({ ...canceled, reason: "retry_exhausted" })).toBe(false);
    const dead = { ...canceled, state: "dead_letter" as const,
      reason: "retry_exhausted" as const };
    expect(validAutomationRunRow(dead)).toBe(true);
    expect(validAutomationRunRow({ ...dead, reason: "operator_cancelled" })).toBe(false);
  });
  it("rejects inconsistent tenant bindings, duplicate keys and duplicate IDs", () => {
    expect(validAutomationRunRegistry([{ ...run, workspaceId: "tenant02" }], ws, db)).toBe(false);
    expect(validAutomationRunRegistry([run, { ...run, runId: "run02" }], ws, db)).toBe(false);
    expect(validAutomationRunRegistry([run, { ...run, runKey: "manual-request-0002" }], ws, db))
      .toBe(false);
  });
  it("has a finite per-database hard cap, with fail-closed overflow", () => {
    const rows = Array.from({ length: MAX_AUTOMATION_INTENTS_PER_DATABASE }, (_, i) => ({
      ...run, runId: "run" + i, runKey: "manual-run-" + String(i).padStart(8, "0"),
    }));
    expect(validAutomationRunRegistry(rows, ws, db)).toBe(true);
    expect(validAutomationRunRegistry([...rows, run], ws, db)).toBe(false);
  });
  it("validates an atomic single-entry creation journal", () => {
    expect(validAutomationRunJournal(run, [recorded])).toBe(true);
    expect(validAutomationRunJournal(run, [])).toBe(false);
    expect(validAutomationRunJournal(run, [recorded, recorded])).toBe(false);
  });
  it("validates strictly sequenced cancellation journal", () => {
    const canceled = { ...run, state: "canceled" as const,
      reason: "operator_cancelled" as const, terminalAt: now + 2,
      updatedAt: now + 2 };
    const finish: AutomationRunEvent = { ...recorded, sequence: 2,
      state: "canceled", at: now + 2 };
    expect(validAutomationRunJournal(canceled, [recorded, finish])).toBe(true);
    expect(validAutomationRunJournal(canceled, [recorded, { ...finish, sequence: 3 }]))
      .toBe(false);
    expect(validAutomationRunJournal(canceled, [recorded, { ...finish, at: now + 1 }]))
      .toBe(false);
  });
  it("rejects cross-tenant, forged actor and out-of-order audit events", () => {
    expect(validAutomationRunJournal(run, [{ ...recorded, workspaceId: "tenant02" }]))
      .toBe(false);
    expect(validAutomationRunJournal(run, [{ ...recorded, actorId: "bad actor" }]))
      .toBe(false);
    expect(validAutomationRunJournal(run, [{ ...recorded, at: now - 1 }]))
      .toBe(false);
  });
  it("accepts exact authorized idempotent replays regardless of terminal status", () => {
    expect(sameAutomationIntent(run, owner, run.ruleKey, run.ruleUpdatedAt, key)).toBe(true);
    const canceled = { ...run, state: "canceled" as const,
      reason: "operator_cancelled" as const, terminalAt: now, updatedAt: now + 1 };
    expect(sameAutomationIntent(canceled, owner, run.ruleKey, run.ruleUpdatedAt, key))
      .toBe(true);
  });
  it("rejects replay with another user, rule, version or key", () => {
    expect(sameAutomationIntent(run, guest, run.ruleKey, run.ruleUpdatedAt, key)).toBe(false);
    expect(sameAutomationIntent(run, owner, "other", run.ruleUpdatedAt, key)).toBe(false);
    expect(sameAutomationIntent(run, owner, run.ruleKey, now, key)).toBe(false);
    expect(sameAutomationIntent(run, owner, run.ruleKey, run.ruleUpdatedAt,
      "manual-request-0002")).toBe(false);
  });
  it("permits recording only for a manager and live rule creator", async () => {
    const f = fixture();
    expect(await f.can()).toBe(true);
    expect(await f.can(guest)).toBe(false);
    expect(await f.can(null)).toBe(false);
    expect(await f.can(owner, rule, now)).toBe(false);
  });
  it("denies paused, retired and state-change-triggered rule intents", async () => {
    const f = fixture();
    expect(await f.can(owner, { ...rule, state: "paused" })).toBe(false);
    expect(await f.can(owner, { ...rule, state: "retired", retiredAt: now - 100 }))
      .toBe(false);
    expect(await f.can(owner, { ...rule, trigger: "task_state_changed" })).toBe(false);
  });
  it("denies revoked accounts and disabled workspace", async () => {
    const f = fixture(); f.memberships[0].status = "revoked";
    expect(await f.can()).toBe(false);
    f.memberships[0].status = "active";
    f.workspaces[0].status = "disabled";
    expect(await f.can()).toBe(false);
  });
  it("denies duplicate/cross-tenant scopes and missing live database bindings", async () => {
    const f = fixture(); f.scopes.push({ ...f.scopes[0] });
    expect(await f.can()).toBe(false);
    f.scopes.pop(); f.bindings[0].archivedAt = now;
    expect(await f.can()).toBe(false);
  });
  it("allows exact CAS cancellation once but refuses stale or terminal updates", () => {
    expect(cancellationRevision(run, now, now)).toBe(now + 1);
    expect(cancellationRevision(run, now - 1, now)).toBeNull();
    expect(cancellationRevision({ ...run, state: "canceled", reason: "operator_cancelled",
      terminalAt: now }, now, now)).toBeNull();
  });
  it("fences direct and indirect recursion with a strict depth budget", () => {
    expect(validAutomationCausalLineage("rule01", [])).toBe(true);
    expect(validAutomationCausalLineage("rule01", ["rule02", "rule03"])).toBe(true);
    expect(validAutomationCausalLineage("rule01", ["rule02", "rule01"])).toBe(false);
    expect(validAutomationCausalLineage("rule01", ["rule02", "rule02"])).toBe(false);
    expect(validAutomationCausalLineage("rule01",
      Array.from({ length: MAX_AUTOMATION_DEPTH }, (_, i) => "ancestor" + i))).toBe(false);
  });
  it("computes finite backoff without scheduling work or exposing an executor", () => {
    expect(MAX_AUTOMATION_ATTEMPTS).toBe(3);
    expect(hypotheticalAutomationRetry("recorded", 1, "transient_dependency", now))
      .toEqual({ nextAttempt: 2, notBefore: now + 60000 });
    expect(hypotheticalAutomationRetry("recorded", 2, "rate_limited", now))
      .toEqual({ nextAttempt: 3, notBefore: now + 120000 });
    expect(hypotheticalAutomationRetry("recorded", 3, "rate_limited", now)).toBeNull();
  });
  it("never retries auth revocation, policy denial, terminal entries or bad time", () => {
    expect(hypotheticalAutomationRetry("recorded", 1, "auth_revoked", now)).toBeNull();
    expect(hypotheticalAutomationRetry("recorded", 1, "policy_denied", now)).toBeNull();
    expect(hypotheticalAutomationRetry("canceled", 1, "rate_limited", now)).toBeNull();
    expect(hypotheticalAutomationRetry("dead_letter", 1, "rate_limited", now)).toBeNull();
    expect(hypotheticalAutomationRetry("recorded", 0, "rate_limited", now)).toBeNull();
    expect(hypotheticalAutomationRetry("recorded", 1, "rate_limited", NaN)).toBeNull();
  });
  it("manager previews exclude actor identities, body text and credentials", () => {
    const preview = projectAutomationRun(run);
    const serialized = JSON.stringify(preview);
    expect(serialized).not.toContain(owner);
    expect(serialized).not.toContain(ws);
    expect(serialized).not.toContain(db);
    expect(serialized).not.toContain("payload");
    expect(serialized).not.toContain("token");
  });
});
