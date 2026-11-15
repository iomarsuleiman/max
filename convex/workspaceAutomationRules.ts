import {
  mutationGeneric, queryGeneric, type GenericDataModel, type GenericQueryCtx,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { sharedStore } from "./workspaceDatabases";
import {
  canManageAutomationScope, dryRunAutomationRule, listManagedAutomationRules,
  nextAutomationRevision, validAutomationRegistry, validAutomationRuleInput,
  validAutomationRuleRow, validTaskState, MAX_AUTOMATION_RULES_PER_DATABASE,
  type AutomationRuleInput, type AutomationRuleRow, type AutomationRuleStore,
} from "../lib/domain/workspaceAutomationRules";
import { validPrincipalId, validScopeId, validWorkspaceId } from "../lib/domain/workspaceManagementPolicy";

/**
 * Max 2.0 PR40. These are authenticated, opt-in SHADOW registry endpoints.
 * No rule runner, scheduling, webhooks, notifications or state mutations
 * execute from a rule. It is not a page/document or MCP authorization grant.
 */
type Ctx = Pick<GenericQueryCtx<GenericDataModel>, "db" | "auth">;
const READ_GATE = "MAX_V2_AUTOMATION_RULES_READS_ENABLED";
const WRITE_GATE = "MAX_V2_AUTOMATION_RULES_WRITES_ENABLED";
const taskStateV = v.union(
  v.literal("todo"), v.literal("in_progress"), v.literal("blocked"), v.literal("done"),
);
const nullableTaskStateV = v.union(taskStateV, v.null());
const triggerV = v.union(v.literal("task_state_changed"), v.literal("manual_button"));
const conditionV = v.union(v.literal("always"), v.literal("state_equals"));
const actionV = v.union(v.literal("notify_creator"), v.literal("set_task_state"));
const ruleInputV = {
  name: v.string(), trigger: triggerV, condition: conditionV,
  conditionValue: nullableTaskStateV, action: actionV, actionValue: nullableTaskStateV,
};
const previewV = v.object({
  ruleKey: v.string(), ...ruleInputV,
  state: v.union(v.literal("draft"), v.literal("paused"), v.literal("retired")),
  updatedAt: v.number(),
});
function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "Automation rule operation denied." });
}
function canRead(): boolean {
  return process.env[READ_GATE] === "true" &&
    process.env.MAX_V2_SHARED_DATABASE_READS_ENABLED === "true";
}
function canWrite(): void {
  if (process.env[WRITE_GATE] !== "true" ||
      process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true" ||
      process.env.MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED !== "true") denied();
}
async function who(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}
export function automationStore(ctx: Ctx): AutomationRuleStore {
  return {
    ...sharedStore(ctx),
    globalScopes: async (pageId: string) =>
      (await ctx.db.query("workspacePageScopes")
        .withIndex("by_pageId", (q) => q.eq("pageId", pageId)).take(2))
        .map((row) => ({ workspaceId: row.workspaceId, pageId: row.pageId })),
    automationRules: async (workspaceId: string, databaseId: string) =>
      (await ctx.db.query("workspaceAutomationRules")
        .withIndex("by_workspace_database", (q) =>
          (q.eq("workspaceId", workspaceId) as unknown as {
            eq(field: string, value: string): never;
          }).eq("databaseId", databaseId))
        .take(MAX_AUTOMATION_RULES_PER_DATABASE + 1))
        .map((row) => ({
          ruleId: row._id as string, workspaceId: row.workspaceId,
          databaseId: row.databaseId, ruleKey: row.ruleKey,
          createdByAccountId: row.createdByAccountId,
          name: row.name, trigger: row.trigger, condition: row.condition,
          conditionValue: row.conditionValue, action: row.action,
          actionValue: row.actionValue, state: row.state, createdAt: row.createdAt,
          updatedAt: row.updatedAt, retiredAt: row.retiredAt,
        } as AutomationRuleRow)),
  };
}
async function manager(ctx: Ctx, actor: string, workspaceId: string, databaseId: string) {
  if (!validWorkspaceId(workspaceId) || !validScopeId(databaseId) ||
      !(await canManageAutomationScope(
        automationStore(ctx), actor, workspaceId, databaseId
      ))) denied();
}
async function boundedRows(ctx: Ctx, workspaceId: string, databaseId: string) {
  const rows = await automationStore(ctx).automationRules(workspaceId, databaseId);
  if (!validAutomationRegistry(rows, workspaceId, databaseId)) denied();
  return rows;
}

/** Only current database managers can list rule configuration; no other identities. */
export const listAutomationRules = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string() },
  returns: v.array(previewV),
  handler: async (ctx, a) => {
    if (!canRead()) return [];
    try {
      return [...await listManagedAutomationRules(
        automationStore(ctx), await who(ctx), a.workspaceId, a.databaseId
      )];
    } catch { return []; }
  },
});

/** Hypothetical samples ONLY. wouldRun is *always false*, even on a match. */
export const dryRunAutomation = queryGeneric({
  args: {
    workspaceId: v.string(), databaseId: v.string(), ruleKey: v.string(),
    before: taskStateV, after: taskStateV,
  },
  returns: v.union(v.null(), v.object({
    wouldMatch: v.boolean(), wouldRun: v.literal(false),
  })),
  handler: async (ctx, a) => {
    if (!canRead()) return null;
    try {
      if (!validTaskState(a.before) || !validTaskState(a.after)) return null;
      return await dryRunAutomationRule(
        automationStore(ctx), await who(ctx), a.workspaceId, a.databaseId,
        a.ruleKey, a.before, a.after
      );
    } catch { return null; }
  },
});

/** Immutable key; 32 rules per database, drafts only; no executable state. */
export const createAutomationRule = mutationGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(),
    ruleKey: v.string(), ...ruleInputV },
  returns: v.id("workspaceAutomationRules"),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    await manager(ctx, actor, a.workspaceId, a.databaseId);
    const input: AutomationRuleInput = {
      name: a.name, trigger: a.trigger, condition: a.condition,
      conditionValue: a.conditionValue, action: a.action, actionValue: a.actionValue,
    };
    if (!validScopeId(a.ruleKey) || !validAutomationRuleInput(input)) denied();
    const rows = await boundedRows(ctx, a.workspaceId, a.databaseId);
    if (rows.length >= MAX_AUTOMATION_RULES_PER_DATABASE ||
        rows.some((r) => r.ruleKey === a.ruleKey)) denied();
    const id = await ctx.db.insert("workspaceAutomationRules", {
      workspaceId: a.workspaceId, databaseId: a.databaseId, ruleKey: a.ruleKey,
      createdByAccountId: actor, ...input, state: "draft" as const,
      createdAt: now, updatedAt: now, retiredAt: null,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.workspaceId, actorId: actor,
      operation: "automation_rule.draft_created", targetId: a.databaseId,
      previous: null, next: "draft", at: now,
    });
    return id;
  },
});

/** Revision-fenced metadata updates, including explicit pause. No enable API. */
export const updateAutomationRule = mutationGeneric({
  args: {
    workspaceId: v.string(), databaseId: v.string(), ruleKey: v.string(),
    expectedUpdatedAt: v.number(), state: v.union(v.literal("draft"), v.literal("paused")),
    ...ruleInputV,
  },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    await manager(ctx, actor, a.workspaceId, a.databaseId);
    const input: AutomationRuleInput = {
      name: a.name, trigger: a.trigger, condition: a.condition,
      conditionValue: a.conditionValue, action: a.action, actionValue: a.actionValue,
    };
    if (!validScopeId(a.ruleKey) || !validAutomationRuleInput(input)) denied();
    const rows = await boundedRows(ctx, a.workspaceId, a.databaseId);
    const old = rows.find((r) => r.ruleKey === a.ruleKey);
    if (!old || old.state === "retired" || old.updatedAt !== a.expectedUpdatedAt ||
        !(await canManageAutomationScope(
          automationStore(ctx), old.createdByAccountId, a.workspaceId, a.databaseId
        ))) denied();
    const updatedAt = nextAutomationRevision(old.updatedAt, now);
    if (updatedAt === null) denied();
    await ctx.db.patch(old.ruleId as never, { ...input, state: a.state, updatedAt });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.workspaceId, actorId: actor,
      operation: "automation_rule.draft_updated", targetId: a.databaseId,
      previous: old.state, next: a.state, at: now,
    });
    return updatedAt;
  },
});

/** Terminal retirement. Cannot be reversed by a stale writer. */
export const retireAutomationRule = mutationGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(),
    ruleKey: v.string(), expectedUpdatedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    await manager(ctx, actor, a.workspaceId, a.databaseId);
    if (!validScopeId(a.ruleKey)) denied();
    const rows = await boundedRows(ctx, a.workspaceId, a.databaseId);
    const old = rows.find((r) => r.ruleKey === a.ruleKey);
    if (!old || !validAutomationRuleRow(old) || old.state === "retired" ||
        old.updatedAt !== a.expectedUpdatedAt) denied();
    const updatedAt = nextAutomationRevision(old.updatedAt, now);
    if (updatedAt === null) denied();
    await ctx.db.patch(old.ruleId as never, {
      state: "retired" as const, retiredAt: now, updatedAt,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.workspaceId, actorId: actor,
      operation: "automation_rule.retired", targetId: a.databaseId,
      previous: old.state, next: "retired", at: now,
    });
    return updatedAt;
  },
});
