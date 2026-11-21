import { z } from "zod";
import { MaxError, notFound } from "../errors";
import type { AutomationRule } from "../types";
import { defineOp, id, type OpContext } from "./define";
import { requireDatabase, requirePage } from "./helpers";
import { shortId } from "./databaseDefaults";
import { AUTOMATION_LIMITS, runRule } from "./recordHooks";

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set"), propertyId: z.string().max(64), value: z.unknown() }),
  z.object({ type: z.literal("set_now"), propertyId: z.string().max(64) }),
  z.object({ type: z.literal("assign_actor"), propertyId: z.string().max(64) }),
  z.object({ type: z.literal("notify"), to: z.union([z.enum(["assignees", "creator"]), z.array(z.string().max(256)).max(20)]), message: z.string().trim().min(1).max(500) }),
]);
const trigger = z.discriminatedUnion("type", [
  z.object({ type: z.literal("created") }),
  z.object({ type: z.literal("changed"), propertyId: z.string().max(64), to: z.union([z.string().max(100), z.boolean(), z.null()]).optional() }),
  z.object({ type: z.literal("button"), label: z.string().trim().min(1).max(40) }),
  z.object({ type: z.literal("schedule"), every: z.enum(["day", "week", "month"]), title: z.string().trim().min(1).max(200) }),
]);

const PERIOD = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

/** Keeps the schedule index in step with a database's recurring rules. */
async function syncSchedules(ctx: OpContext, databaseId: string, rules: AutomationRule[]) {
  const existing = (await ctx.db.list("schedules", ctx.ownerId)).filter((r) => r.databaseId === databaseId);
  const wanted = rules.filter((r) => r.enabled && r.trigger.type === "schedule");
  for (const row of existing) if (!wanted.some((r) => r.id === row.ruleId)) await ctx.db.delete("schedules", row._id);
  for (const r of wanted) {
    if (existing.some((e) => e.ruleId === r.id)) continue;
    await ctx.db.insert("schedules", { ownerId: ctx.ownerId, databaseId, ruleId: r.id, nextAt: ctx.now + PERIOD[(r.trigger as { every: keyof typeof PERIOD }).every] });
  }
}

/**
 * Runs recurring automations that are due (the daily job): each creates its row with the rule's
 * title, then applies the rule's actions to it, and is scheduled for its next period. Bounded.
 */
export async function runDueSchedules(db: OpContext["db"], storage: OpContext["storage"], now: number, budget = 200) {
  let ran = 0;
  for (const s of (await db.listAll("schedules", 5000)).filter((x) => x.nextAt <= now)) {
    if (ran >= budget) break;
    const ctx: OpContext = { db, storage, ownerId: s.ownerId, now, source: "ui", actor: { id: "system", name: "Max", image: null } };
    const database = await db.get("pages", s.databaseId);
    const rule = database?.ownerId === s.ownerId && !database.archivedAt ? (database.automations ?? []).find((r) => r.id === s.ruleId && r.enabled && r.trigger.type === "schedule") : null;
    if (!database || !rule || rule.trigger.type !== "schedule") {
      await db.delete("schedules", s._id);
      continue;
    }
    const { recordsCreate } = await import("./databases");
    const { record } = await recordsCreate.run(ctx, { databaseId: database._id, title: rule.trigger.title });
    const row = await db.get("pages", record._id);
    if (row) await runRule(ctx, database, rule, row);
    // Catch up without flooding: the next run is one period after now.
    await db.patch("schedules", s._id, { nextAt: Math.max(s.nextAt + PERIOD[rule.trigger.every], now + 60_000) });
    ran++;
  }
  return { ran };
}

export const automationsList = defineOp({
  name: "automations.list",
  kind: "query",
  title: "List automations",
  description: "A database's automations: when a row is created, a property changes (optionally to a value), or a button is pressed, then set properties, stamp the date, assign the person acting, or notify people. With run counts and the last error.",
  input: z.object({ databaseId: id }),
  async run(ctx, { databaseId }) {
    const db = await requireDatabase(ctx, databaseId);
    return { automations: db.automations ?? [] };
  },
});

export const automationsSave = defineOp({
  name: "automations.save",
  kind: "mutation",
  title: "Save automation",
  description: "Creates or replaces one automation on a database. A schedule trigger creates a row with its title every day, week or month (recurring tasks). Other rules run in the same transaction as the change that triggers them and never trigger each other. Up to 20 per database, 10 actions each.",
  input: z.object({ databaseId: id, automation: z.object({ id: z.string().max(32).optional(), name: z.string().trim().min(1).max(80), enabled: z.boolean().default(true), trigger, actions: z.array(action).min(1).max(AUTOMATION_LIMITS.actions) }) }),
  async run(ctx, { databaseId, automation }) {
    const db = await requireDatabase(ctx, databaseId);
    const props = new Set((db.properties ?? []).map((p) => p.id));
    const refs = [...(automation.trigger.type === "changed" ? [automation.trigger.propertyId] : []), ...automation.actions.flatMap((a) => ("propertyId" in a ? [a.propertyId] : []))];
    const missing = refs.find((r) => !props.has(r));
    if (missing) throw new MaxError("VALIDATION", `"${missing}" isn't a property of this database.`);
    const list = db.automations ?? [];
    const rule: AutomationRule = { ...list.find((r) => r.id === automation.id), ...automation, id: automation.id ?? shortId() } as AutomationRule;
    const next = list.some((r) => r.id === rule.id) ? list.map((r) => (r.id === rule.id ? rule : r)) : [...list, rule];
    if (next.length > AUTOMATION_LIMITS.rules) throw new MaxError("LIMIT", `A database can have up to ${AUTOMATION_LIMITS.rules} automations.`);
    await ctx.db.patch("pages", db._id, { automations: next, updatedAt: ctx.now });
    await syncSchedules(ctx, db._id, next);
    return { automation: rule };
  },
});

export const automationsDelete = defineOp({
  name: "automations.delete",
  kind: "mutation",
  title: "Delete automation",
  description: "Removes one automation from a database.",
  input: z.object({ databaseId: id, automationId: z.string().max(32) }),
  async run(ctx, { databaseId, automationId }) {
    const db = await requireDatabase(ctx, databaseId);
    const next = (db.automations ?? []).filter((r) => r.id !== automationId);
    await ctx.db.patch("pages", db._id, { automations: next, updatedAt: ctx.now });
    await syncSchedules(ctx, db._id, next);
    return { ok: true };
  },
});

export const automationsPress = defineOp({
  name: "automations.press",
  kind: "mutation",
  title: "Press an automation button",
  description: "Runs a button automation on one row, as if someone pressed its button.",
  input: z.object({ recordId: id, automationId: z.string().max(32) }),
  async run(ctx, { recordId, automationId }) {
    const record = await requirePage(ctx, recordId);
    if (!record.databaseId) throw new MaxError("VALIDATION", "That page isn't a database row.");
    const db = await requireDatabase(ctx, record.databaseId);
    const rule = (db.automations ?? []).find((r) => r.id === automationId && r.trigger.type === "button");
    if (!rule) throw notFound("button");
    if (!rule.enabled) throw new MaxError("VALIDATION", "That button is turned off.");
    await runRule(ctx, db, rule, record);
    await ctx.db.patch("pages", db._id, { automations: (db.automations ?? []).map((r) => (r.id === rule.id ? { ...r, runs: (r.runs ?? 0) + 1, lastRunAt: ctx.now } : r)) });
    return { ok: true };
  },
});
