/**
 * What happens after a database row is created or changed, in the same transaction:
 *  1. the database's automations (deterministic rules, no AI), and
 *  2. notifications to people newly assigned through Person properties.
 *
 * Automations are bounded on purpose: changes they make never trigger other automations (so
 * rules can't loop or cascade), each database has at most 20 rules with 10 actions each, and
 * every run is counted on the rule with its last error, so failures can be seen and explained.
 * A failing action rolls back the whole change, exactly like a failed edit.
 */
import { MaxError } from "../errors";
import { notify } from "../notifications";
import type { AutomationRule, PageRow, PropertyValue } from "../types";
import type { OpContext } from "./define";
import { actorOf } from "./helpers";
import { applyValues } from "./databases";

export const AUTOMATION_LIMITS = { rules: 20, actions: 10 };

const ids = (v: PropertyValue | undefined) => (Array.isArray(v) ? v : []);

function triggered(rule: AutomationRule, before: PageRow | null, after: PageRow): boolean {
  if (!rule.enabled) return false;
  if (rule.trigger.type === "created") return before === null;
  if (rule.trigger.type === "schedule") return false;
  if (rule.trigger.type !== "changed" || !before) return false;
  const { propertyId, to } = rule.trigger;
  const was = before.values?.[propertyId] ?? null;
  const now = after.values?.[propertyId] ?? null;
  if (JSON.stringify(was) === JSON.stringify(now)) return false;
  if (to === undefined) return true;
  return Array.isArray(now) ? now.includes(String(to)) : now === to;
}

/** Runs one rule's actions on a row. Returns the values it set. */
export async function runRule(ctx: OpContext, db: PageRow, rule: AutomationRule, record: PageRow): Promise<PageRow> {
  const set: Record<string, unknown> = {};
  const notes: { to: string[]; message: string }[] = [];
  const props = db.properties ?? [];
  for (const action of rule.actions.slice(0, AUTOMATION_LIMITS.actions)) {
    if (action.type === "set") set[action.propertyId] = action.value;
    else if (action.type === "set_now") set[action.propertyId] = new Date(ctx.now).toISOString().slice(0, 16);
    else if (action.type === "assign_actor") {
      const me = actorOf(ctx);
      if (me) set[action.propertyId] = [...new Set([...ids(record.values?.[action.propertyId]), me])];
    } else if (action.type === "notify") {
      const to =
        action.to === "creator"
          ? [record.createdBy ?? ""]
          : action.to === "assignees"
            ? props.filter((p) => p.type === "person").flatMap((p) => ids({ ...record.values, ...(set as Record<string, PropertyValue>) }[p.id]))
            : action.to;
      notes.push({ to, message: action.message });
    }
  }
  let next = record;
  if (Object.keys(set).length) {
    const { values } = await applyValues(ctx, db, set);
    const patch = { values: { ...record.values, ...values }, updatedAt: ctx.now };
    await ctx.db.patch("pages", record._id, patch);
    next = { ...record, ...patch };
  }
  for (const n of notes) {
    await notify(ctx.db, n.to, { kind: "automation", ownerId: ctx.ownerId, pageId: record._id, actor: ctx.actor ?? null, title: `${rule.name}: ${record.title || "Untitled"}`, body: n.message.slice(0, 500) }, ctx.now);
  }
  return next;
}

async function recordRun(ctx: OpContext, db: PageRow, ruleIds: string[]) {
  if (!ruleIds.length) return;
  const automations = (db.automations ?? []).map((r) => (ruleIds.includes(r.id) ? { ...r, runs: (r.runs ?? 0) + 1, lastRunAt: ctx.now, lastError: null } : r));
  await ctx.db.patch("pages", db._id, { automations });
  db.automations = automations;
}

export async function afterRecordChange(ctx: OpContext, db: PageRow, before: PageRow | null, after: PageRow) {
  let record = after;
  const fired: string[] = [];
  for (const rule of db.automations ?? []) {
    if (!triggered(rule, before, after)) continue;
    try {
      record = await runRule(ctx, db, rule, record);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new MaxError("VALIDATION", `The automation “${rule.name}” couldn't run: ${msg}`, { ruleId: rule.id });
    }
    fired.push(rule.id);
  }
  await recordRun(ctx, db, fired);
  // Newly assigned people hear about it (not the person who assigned them).
  for (const prop of (db.properties ?? []).filter((p) => p.type === "person")) {
    const was = new Set(ids(before?.values?.[prop.id]));
    const added = ids(record.values?.[prop.id]).filter((id) => !was.has(id));
    if (added.length) {
      await notify(ctx.db, added, { kind: "assigned", ownerId: ctx.ownerId, pageId: record._id, actor: ctx.actor ?? { id: actorOf(ctx) ?? "" }, title: `${ctx.actor?.name ?? "Someone"} assigned you to “${record.title || "Untitled"}”`, key: `assigned:${record._id}:${prop.id}` }, ctx.now);
    }
  }
  return record;
}
