import {
  mutationGeneric, queryGeneric, type GenericDataModel, type GenericQueryCtx,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { automationStore } from "./workspaceAutomationRules";
import {
  canManageAutomationScope, validAutomationRegistry, type AutomationRuleRow,
} from "../lib/domain/workspaceAutomationRules";
import {
  canRecordAutomationIntent, cancellationRevision, projectAutomationRun,
  sameAutomationIntent, validAutomationRunJournal, validAutomationRunKey,
  validAutomationRunRegistry, MAX_AUTOMATION_INTENTS_PER_DATABASE,
  type AutomationRunEvent, type AutomationRunRow,
} from "../lib/domain/workspaceAutomationExecution";
import {
  validPrincipalId, validScopeId, validWorkspaceId,
} from "../lib/domain/workspaceManagementPolicy";

/**
 * PR41: transactional and INERT intent/journal records for shadow databases.
 * No active rule, worker, scheduler, retry enqueue, webhook, notification,
 * actual task change, editor route, or MCP tool exists here.
 */
type Ctx = Pick<GenericQueryCtx<GenericDataModel>, "db" | "auth">;
const stateV = v.union(
  v.literal("recorded"), v.literal("canceled"), v.literal("dead_letter"),
);
const READ_GATE = "MAX_V2_AUTOMATION_RUN_INTENTS_READS_ENABLED";
const WRITE_GATE = "MAX_V2_AUTOMATION_RUN_INTENTS_WRITES_ENABLED";

function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "Automation intent operation denied." });
}
function canRead(): boolean {
  return process.env[READ_GATE] === "true" &&
    process.env.MAX_V2_AUTOMATION_RULES_READS_ENABLED === "true" &&
    process.env.MAX_V2_SHARED_DATABASE_READS_ENABLED === "true";
}
function canWrite(): void {
  if (process.env[WRITE_GATE] !== "true" ||
      process.env.MAX_V2_AUTOMATION_RULES_WRITES_ENABLED !== "true" ||
      process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true" ||
      process.env.MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED !== "true") denied();
}
async function who(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}
async function manager(ctx: Ctx, actor: string, ws: string, db: string): Promise<void> {
  if (!validWorkspaceId(ws) || !validScopeId(db) ||
      !(await canManageAutomationScope(automationStore(ctx), actor, ws, db))) denied();
}
async function allRuns(ctx: Ctx, ws: string, db: string): Promise<AutomationRunRow[]> {
  const rows = await ctx.db.query("workspaceAutomationRunIntents")
    .withIndex("by_workspace_database", (q) =>
      (q.eq("workspaceId", ws) as unknown as {
        eq(field: string, value: string): never;
      }).eq("databaseId", db))
    .take(MAX_AUTOMATION_INTENTS_PER_DATABASE + 1);
  const mapped: AutomationRunRow[] = rows.map((r) => ({
    runId: r._id as string, workspaceId: r.workspaceId, databaseId: r.databaseId,
    ruleKey: r.ruleKey, runKey: r.runKey,
    requestedByAccountId: r.requestedByAccountId,
    ruleUpdatedAt: r.ruleUpdatedAt, trigger: r.trigger, depth: r.depth,
    attempt: r.attempt, state: r.state, reason: r.reason,
    createdAt: r.createdAt, updatedAt: r.updatedAt, terminalAt: r.terminalAt,
  } as AutomationRunRow));
  if (!validAutomationRunRegistry(mapped, ws, db)) denied();
  return mapped;
}
async function eventsFor(ctx: Ctx, run: AutomationRunRow): Promise<AutomationRunEvent[]> {
  const rows = await ctx.db.query("workspaceAutomationRunEvents")
    .withIndex("by_runId", (q) => q.eq("runId", run.runId)).take(3);
  return rows.map((e) => ({
    workspaceId: e.workspaceId, databaseId: e.databaseId, runId: e.runId,
    sequence: e.sequence, state: e.state, actorId: e.actorId, at: e.at,
  } as AutomationRunEvent)).sort((a, b) => a.sequence - b.sequence);
}
async function findRule(ctx: Ctx, ws: string, db: string,
  ruleKey: string): Promise<AutomationRuleRow> {
  const rows = await automationStore(ctx).automationRules(ws, db);
  if (!validAutomationRegistry(rows, ws, db)) denied();
  const rule = rows.find((r) => r.ruleKey === ruleKey);
  if (!rule) denied();
  return rule;
}

/** Metadata-only manager list; contains no actor IDs, content or run payloads. */
export const listAutomationRunIntents = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string() },
  returns: v.array(v.object({
    runKey: v.string(), ruleKey: v.string(), ruleUpdatedAt: v.number(),
    state: stateV, createdAt: v.number(), updatedAt: v.number(),
  })),
  handler: async (ctx, a) => {
    if (!canRead()) return [];
    try {
      await manager(ctx, await who(ctx), a.workspaceId, a.databaseId);
      const runs = await allRuns(ctx, a.workspaceId, a.databaseId);
      return runs.map(projectAutomationRun).sort((a, b) => a.runKey.localeCompare(b.runKey));
    } catch { return []; }
  },
});

/** Authenticated manual registry intent. ALWAYS inert; no action is invoked. */
export const recordManualAutomationIntent = mutationGeneric({
  args: {
    workspaceId: v.string(), databaseId: v.string(), ruleKey: v.string(),
    expectedRuleUpdatedAt: v.number(), runKey: v.string(),
  },
  returns: v.object({ runId: v.string(), replay: v.boolean() }),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    if (!validScopeId(a.ruleKey) || !validAutomationRunKey(a.runKey)) denied();
    await manager(ctx, actor, a.workspaceId, a.databaseId);
    const rule = await findRule(ctx, a.workspaceId, a.databaseId, a.ruleKey);
    if (!(await canRecordAutomationIntent(
      automationStore(ctx), actor, a.workspaceId, a.databaseId,
      rule, a.expectedRuleUpdatedAt
    ))) denied();
    const runs = await allRuns(ctx, a.workspaceId, a.databaseId);
    const previous = runs.find((r) => r.runKey === a.runKey);
    if (previous) {
      if (!sameAutomationIntent(
        previous, actor, a.ruleKey, a.expectedRuleUpdatedAt, a.runKey
      ) || !validAutomationRunJournal(previous, await eventsFor(ctx, previous))) denied();
      return { runId: previous.runId, replay: true };
    }
    if (runs.length >= MAX_AUTOMATION_INTENTS_PER_DATABASE) denied();
    const id = await ctx.db.insert("workspaceAutomationRunIntents", {
      workspaceId: a.workspaceId, databaseId: a.databaseId,
      ruleKey: a.ruleKey, runKey: a.runKey, requestedByAccountId: actor,
      ruleUpdatedAt: a.expectedRuleUpdatedAt, trigger: "manual_button" as const,
      depth: 0, attempt: 0, state: "recorded" as const, reason: null,
      createdAt: now, updatedAt: now, terminalAt: null,
    });
    await ctx.db.insert("workspaceAutomationRunEvents", {
      workspaceId: a.workspaceId, databaseId: a.databaseId,
      runId: id as string, sequence: 1, state: "recorded" as const,
      actorId: actor, at: now,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.workspaceId, actorId: actor,
      operation: "automation_intent.recorded", targetId: a.databaseId,
      previous: null, next: "recorded", at: now,
    });
    return { runId: id as string, replay: false };
  },
});

/** Operator cancellation is the ONLY exposed transition; no retry/execute. */
export const cancelAutomationIntent = mutationGeneric({
  args: {
    workspaceId: v.string(), databaseId: v.string(),
    runKey: v.string(), expectedUpdatedAt: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    if (!validAutomationRunKey(a.runKey)) denied();
    await manager(ctx, actor, a.workspaceId, a.databaseId);
    const runs = await allRuns(ctx, a.workspaceId, a.databaseId);
    const run = runs.find((r) => r.runKey === a.runKey);
    if (!run || now < run.createdAt ||
        !validAutomationRunJournal(run, await eventsFor(ctx, run))) denied();
    const updatedAt = cancellationRevision(run, a.expectedUpdatedAt, now);
    if (updatedAt === null) denied();
    await ctx.db.patch(run.runId as never, {
      state: "canceled" as const, reason: "operator_cancelled" as const,
      terminalAt: now, updatedAt,
    });
    await ctx.db.insert("workspaceAutomationRunEvents", {
      workspaceId: a.workspaceId, databaseId: a.databaseId,
      runId: run.runId, sequence: 2, state: "canceled" as const,
      actorId: actor, at: now,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.workspaceId, actorId: actor,
      operation: "automation_intent.canceled", targetId: a.databaseId,
      previous: "recorded", next: "canceled", at: now,
    });
    return updatedAt;
  },
});

/** Fail-closed, manager-only journal without contributor identity disclosure. */
export const readAutomationRunJournal = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(), runKey: v.string() },
  returns: v.array(v.object({ sequence: v.number(), state: stateV, at: v.number() })),
  handler: async (ctx, a) => {
    if (!canRead() || !validAutomationRunKey(a.runKey)) return [];
    try {
      await manager(ctx, await who(ctx), a.workspaceId, a.databaseId);
      const run = (await allRuns(ctx, a.workspaceId, a.databaseId))
        .find((r) => r.runKey === a.runKey);
      if (!run) return [];
      const entries = await eventsFor(ctx, run);
      if (!validAutomationRunJournal(run, entries)) return [];
      return entries.map((e) => ({ sequence: e.sequence, state: e.state, at: e.at }));
    } catch { return []; }
  },
});
