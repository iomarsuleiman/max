import {
  canManageAutomationScope, nextAutomationRevision, validAutomationRuleRow,
  type AutomationRuleRow, type AutomationRuleStore,
} from "./workspaceAutomationRules";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";

/**
 * Max 2.0 PR41: inert, audited execution INTENTS only. These types do not
 * constitute an executor, delivery queue, scheduler or permission token.
 */
export const MAX_AUTOMATION_INTENTS_PER_DATABASE = 64;
export const MAX_AUTOMATION_DEPTH = 4;
export const MAX_AUTOMATION_ATTEMPTS = 3;
const MAX_TIME = 4102444800000;
const safeTime = (n: number): boolean =>
  Number.isSafeInteger(n) && n >= 0 && n <= MAX_TIME;

export type AutomationRunState = "recorded" | "canceled" | "dead_letter";
export type AutomationRunReason = "operator_cancelled" | "policy_blocked" | "retry_exhausted";
export interface AutomationRunRow {
  runId: string;
  workspaceId: string;
  databaseId: string;
  ruleKey: string;
  runKey: string;
  requestedByAccountId: string;
  ruleUpdatedAt: number;
  trigger: "manual_button";
  depth: number;
  attempt: number;
  state: AutomationRunState;
  reason: AutomationRunReason | null;
  createdAt: number;
  updatedAt: number;
  terminalAt: number | null;
}
export interface AutomationRunEvent {
  workspaceId: string;
  databaseId: string;
  runId: string;
  sequence: number;
  state: AutomationRunState;
  actorId: string;
  at: number;
}
export interface AutomationRunPreview {
  runKey: string;
  ruleKey: string;
  ruleUpdatedAt: number;
  state: AutomationRunState;
  createdAt: number;
  updatedAt: number;
}
export const validAutomationRunKey = (key: unknown): key is string =>
  typeof key === "string" && /^[a-zA-Z0-9_-]{12,64}$/.test(key);

export function validAutomationRunRow(row: AutomationRunRow): boolean {
  if (!row || !validScopeId(row.runId) || !validWorkspaceId(row.workspaceId) ||
      !validScopeId(row.databaseId) || !validScopeId(row.ruleKey) ||
      !validAutomationRunKey(row.runKey) ||
      !validPrincipalId(row.requestedByAccountId) ||
      !safeTime(row.ruleUpdatedAt) || !safeTime(row.createdAt) ||
      !safeTime(row.updatedAt) || row.updatedAt < row.createdAt ||
      row.trigger !== "manual_button" || !Number.isSafeInteger(row.depth) ||
      row.depth !== 0 || !Number.isSafeInteger(row.attempt) || row.attempt !== 0) {
    return false;
  }
  if (row.state === "recorded") return row.reason === null && row.terminalAt === null;
  if (row.state === "canceled" || row.state === "dead_letter") {
    return row.terminalAt !== null && safeTime(row.terminalAt) &&
      row.terminalAt >= row.createdAt && row.terminalAt <= row.updatedAt &&
      (row.state === "canceled" ? row.reason === "operator_cancelled" :
        row.reason === "policy_blocked" || row.reason === "retry_exhausted");
  }
  return false;
}

/** Always load one over the cap: corruption/duplicates never yield partial data. */
export function validAutomationRunRegistry(
  rows: readonly AutomationRunRow[], workspaceId: string, databaseId: string,
): boolean {
  if (!validWorkspaceId(workspaceId) || !validScopeId(databaseId) ||
      rows.length > MAX_AUTOMATION_INTENTS_PER_DATABASE) return false;
  const ids = new Set<string>(), keys = new Set<string>();
  for (const row of rows) {
    if (!validAutomationRunRow(row) || row.workspaceId !== workspaceId ||
        row.databaseId !== databaseId || ids.has(row.runId) || keys.has(row.runKey)) {
      return false;
    }
    ids.add(row.runId); keys.add(row.runKey);
  }
  return true;
}

/** Validate the append-only 1- or 2-event journal against the current row. */
export function validAutomationRunJournal(
  row: AutomationRunRow, events: readonly AutomationRunEvent[],
): boolean {
  if (!validAutomationRunRow(row) ||
      events.length !== (row.state === "recorded" ? 1 : 2)) return false;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.workspaceId !== row.workspaceId || e.databaseId !== row.databaseId ||
        e.runId !== row.runId || e.sequence !== i + 1 ||
        !validPrincipalId(e.actorId) || !safeTime(e.at) ||
        e.at < row.createdAt || e.at > row.updatedAt ||
        (i > 0 && e.at < events[i - 1].at)) return false;
  }
  return events[0].state === "recorded" && events[0].at === row.createdAt &&
    (events.length === 1 ||
      (events[1].state === row.state && events[1].at === row.terminalAt));
}

/** Identical authenticated replay returns the original intent; mismatches deny. */
export function sameAutomationIntent(
  row: AutomationRunRow, actor: string, ruleKey: string,
  ruleUpdatedAt: number, runKey: string,
): boolean {
  return validAutomationRunRow(row) && row.requestedByAccountId === actor &&
    row.ruleKey === ruleKey && row.ruleUpdatedAt === ruleUpdatedAt &&
    row.runKey === runKey;
}

/** Future internal event paths MUST reject repeated rule IDs and over-depth chains.
 * No external mutation can supply a lineage or a nonzero depth in PR41. */
export function validAutomationCausalLineage(
  ruleKey: string, ancestorRuleKeys: readonly string[],
): boolean {
  return validScopeId(ruleKey) &&
    ancestorRuleKeys.length < MAX_AUTOMATION_DEPTH &&
    ancestorRuleKeys.every(validScopeId) &&
    !ancestorRuleKeys.includes(ruleKey) &&
    new Set(ancestorRuleKeys).size === ancestorRuleKeys.length;
}

/** Deterministic, NON-SCHEDULING retry calculation for future review only. */
export function hypotheticalAutomationRetry(
  state: AutomationRunState, attemptsAlreadyMade: number,
  cause: "transient_dependency" | "rate_limited" | "auth_revoked" | "policy_denied",
  now: number,
): { nextAttempt: number; notBefore: number } | null {
  if (state !== "recorded" || !safeTime(now) ||
      !Number.isSafeInteger(attemptsAlreadyMade) ||
      attemptsAlreadyMade < 1 || attemptsAlreadyMade >= MAX_AUTOMATION_ATTEMPTS ||
      (cause !== "transient_dependency" && cause !== "rate_limited")) return null;
  const delay = 60000 * (2 ** (attemptsAlreadyMade - 1));
  return safeTime(now + delay)
    ? { nextAttempt: attemptsAlreadyMade + 1, notBefore: now + delay }
    : null;
}

/** A MANUAL intent may be recorded only with live management access for both
 * caller and author, exact immutable rule revision, and a draft manual rule.
 * This is NOT an authorization to execute the action itself. */
export async function canRecordAutomationIntent(
  store: AutomationRuleStore, actor: string | null, workspaceId: string,
  databaseId: string, rule: AutomationRuleRow, expectedUpdatedAt: number,
): Promise<boolean> {
  if (!actor || !validPrincipalId(actor) || !validAutomationRuleRow(rule) ||
      rule.workspaceId !== workspaceId || rule.databaseId !== databaseId ||
      rule.updatedAt !== expectedUpdatedAt || rule.state !== "draft" ||
      rule.trigger !== "manual_button") return false;
  try {
    if (!(await canManageAutomationScope(store, actor, workspaceId, databaseId))) return false;
    return await canManageAutomationScope(
      store, rule.createdByAccountId, workspaceId, databaseId
    );
  } catch { return false; }
}

/** Monotonic compare-and-set is required for the only exposed terminal mutation. */
export function cancellationRevision(
  run: AutomationRunRow, expectedUpdatedAt: number, now: number,
): number | null {
  if (!validAutomationRunRow(run) || run.state !== "recorded" ||
      run.updatedAt !== expectedUpdatedAt) return null;
  return nextAutomationRevision(run.updatedAt, now);
}

export const projectAutomationRun = (row: AutomationRunRow): AutomationRunPreview => ({
  runKey: row.runKey, ruleKey: row.ruleKey, ruleUpdatedAt: row.ruleUpdatedAt,
  state: row.state, createdAt: row.createdAt, updatedAt: row.updatedAt,
});
