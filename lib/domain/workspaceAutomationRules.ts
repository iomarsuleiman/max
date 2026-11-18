import { canAccessWorkspacePageFromServer } from "./workspaceAccessGateway";
import type { SharedDatabaseReadStore } from "./sharedDatabasePolicy";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";

/**
 * PR40: dormant rule definitions for registered SHADOW workspace databases.
 * No runner, event subscription, timer, notification, webhook, task write,
 * content read, public route or MCP operation consumes these definitions.
 */
export type AutomationTrigger = "task_state_changed" | "manual_button";
export type AutomationCondition = "always" | "state_equals";
export type AutomationAction = "notify_creator" | "set_task_state";
export type AutomationState = "draft" | "paused" | "retired";
export type TaskState = "todo" | "in_progress" | "blocked" | "done";
export interface AutomationRuleInput {
  name: string;
  trigger: AutomationTrigger;
  condition: AutomationCondition;
  conditionValue: TaskState | null;
  action: AutomationAction;
  actionValue: TaskState | null;
}
export interface AutomationRuleRow extends AutomationRuleInput {
  ruleId: string;
  workspaceId: string;
  databaseId: string;
  ruleKey: string;
  createdByAccountId: string;
  state: AutomationState;
  createdAt: number;
  updatedAt: number;
  retiredAt: number | null;
}
export interface AutomationRuleStore extends SharedDatabaseReadStore {
  globalScopes(pageId: string): Promise<readonly { workspaceId: string; pageId: string }[]>;
  automationRules(workspaceId: string, databaseId: string): Promise<readonly AutomationRuleRow[]>;
}
export interface AutomationRulePreview {
  ruleKey: string;
  name: string;
  trigger: AutomationTrigger;
  condition: AutomationCondition;
  conditionValue: TaskState | null;
  action: AutomationAction;
  actionValue: TaskState | null;
  state: AutomationState;
  updatedAt: number;
}
export const MAX_AUTOMATION_RULES_PER_DATABASE = 32;
const LIMIT_TIME = 4102444800000;
const TASK_STATES: readonly string[] = ["todo", "in_progress", "blocked", "done"];
const validTime = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= 0 && n <= LIMIT_TIME;
export const validTaskState = (s: unknown): s is TaskState =>
  typeof s === "string" && TASK_STATES.includes(s);

export function validAutomationRuleInput(rule: AutomationRuleInput): boolean {
  return !!rule &&
    typeof rule.name === "string" && rule.name === rule.name.trim() &&
    rule.name.length >= 1 && rule.name.length <= 80 &&
    !/[\u0000-\u001F\u007F]/.test(rule.name) &&
    (rule.trigger === "task_state_changed" || rule.trigger === "manual_button") &&
    (rule.condition === "always" || rule.condition === "state_equals") &&
    (rule.condition === "always" ? rule.conditionValue === null
      : validTaskState(rule.conditionValue)) &&
    (rule.action === "notify_creator" || rule.action === "set_task_state") &&
    (rule.action === "notify_creator" ? rule.actionValue === null
      : validTaskState(rule.actionValue)) &&
    // A state-change action may trigger another state-change event. Until an
    // idempotent, loop-fenced executor is independently reviewed, forbid it.
    !(rule.trigger === "task_state_changed" && rule.action === "set_task_state");
}

export function validAutomationRuleRow(row: AutomationRuleRow): boolean {
  return !!row && validScopeId(row.ruleId) && validScopeId(row.ruleKey) &&
    validWorkspaceId(row.workspaceId) && validScopeId(row.databaseId) &&
    validPrincipalId(row.createdByAccountId) &&
    validAutomationRuleInput(row) &&
    (row.state === "draft" || row.state === "paused" || row.state === "retired") &&
    validTime(row.createdAt) && validTime(row.updatedAt) &&
    row.updatedAt >= row.createdAt &&
    (row.state === "retired"
      ? row.retiredAt !== null && validTime(row.retiredAt) &&
        row.retiredAt >= row.createdAt && row.retiredAt <= row.updatedAt
      : row.retiredAt === null);
}
export function nextAutomationRevision(previous: number, now: number): number | null {
  if (!validTime(previous) || !validTime(now)) return null;
  const next = Math.max(previous + 1, now);
  return validTime(next) ? next : null;
}

/** A unique active shadow binding and CURRENT database manage ACL are required.
 * A rule registry never grants permissions to the underlying records. */
export async function canManageAutomationScope(
  store: AutomationRuleStore, actor: string | null,
  workspaceId: string, databaseId: string,
): Promise<boolean> {
  if (!actor || !validPrincipalId(actor) ||
      !validWorkspaceId(workspaceId) || !validScopeId(databaseId)) return false;
  try {
    const [scopes, bindings] = await Promise.all([
      store.globalScopes(databaseId), store.databaseBindings(workspaceId, databaseId),
    ]);
    if (scopes.length !== 1 || scopes[0].workspaceId !== workspaceId ||
        scopes[0].pageId !== databaseId ||
        bindings.length !== 1 || bindings[0].workspaceId !== workspaceId ||
        bindings[0].pageId !== databaseId ||
        bindings[0].kind !== "database" || bindings[0].archivedAt !== null) return false;
    return await canAccessWorkspacePageFromServer(
      store, actor, workspaceId, databaseId, "manage"
    );
  } catch { return false; }
}

/** Corrupt/overfull registries fail CLOSED instead of yielding partial rows. */
export function validAutomationRegistry(
  rows: readonly AutomationRuleRow[], workspaceId: string, databaseId: string,
): boolean {
  if (rows.length > MAX_AUTOMATION_RULES_PER_DATABASE) return false;
  const ids = new Set<string>(), keys = new Set<string>();
  for (const row of rows) {
    if (!validAutomationRuleRow(row) || row.workspaceId !== workspaceId ||
        row.databaseId !== databaseId || ids.has(row.ruleId) ||
        keys.has(row.ruleKey)) return false;
    ids.add(row.ruleId); keys.add(row.ruleKey);
  }
  return true;
}
const project = (r: AutomationRuleRow): AutomationRulePreview => ({
  ruleKey: r.ruleKey, name: r.name, trigger: r.trigger,
  condition: r.condition, conditionValue: r.conditionValue,
  action: r.action, actionValue: r.actionValue,
  state: r.state, updatedAt: r.updatedAt,
});

/** Manager-only metadata, without actor identities, workspace titles or bodies. */
export async function listManagedAutomationRules(
  store: AutomationRuleStore, actor: string | null,
  workspaceId: string, databaseId: string,
): Promise<readonly AutomationRulePreview[]> {
  try {
    if (!(await canManageAutomationScope(store, actor, workspaceId, databaseId))) return [];
    const rows = await store.automationRules(workspaceId, databaseId);
    if (!validAutomationRegistry(rows, workspaceId, databaseId)) return [];
    return rows.map(project).sort((a, b) => a.ruleKey.localeCompare(b.ruleKey));
  } catch { return []; }
}

/** Hypothetical, non-executable preview. The caller supplies the sample states.
 * Even a match NEVER schedules work; the eventual executor must re-authorize.
 * Returning null deliberately conflates missing, revoked and forbidden rules.
 */
export async function dryRunAutomationRule(
  store: AutomationRuleStore, actor: string | null,
  workspaceId: string, databaseId: string, ruleKey: string,
  before: TaskState, after: TaskState,
): Promise<{ wouldMatch: boolean; wouldRun: false } | null> {
  if (!validScopeId(ruleKey) || !validTaskState(before) || !validTaskState(after)) return null;
  try {
    if (!(await canManageAutomationScope(store, actor, workspaceId, databaseId))) return null;
    const rows = await store.automationRules(workspaceId, databaseId);
    if (!validAutomationRegistry(rows, workspaceId, databaseId)) return null;
    const row = rows.find((r) => r.ruleKey === ruleKey);
    if (!row || row.state === "retired" ||
        !(await canManageAutomationScope(
          store, row.createdByAccountId, workspaceId, databaseId
        ))) return null;
    const triggerMatches = row.trigger === "manual_button" || before !== after;
    const conditionMatches = row.condition === "always" || row.conditionValue === after;
    const noOpStateAction = row.action === "set_task_state" && row.actionValue === after;
    return { wouldMatch: triggerMatches && conditionMatches && !noOpStateAction, wouldRun: false };
  } catch { return null; }
}
