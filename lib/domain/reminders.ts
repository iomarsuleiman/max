import type { OpContext } from "./ops/define";

const DAY = 86_400_000;

/**
 * Due-date reminders, worked out when you open the inbox (so there's no background job to fail
 * or duplicate): rows in this workspace that are assigned to you through a Person property, have
 * a date that's overdue or within the next two days, and aren't done (a checked checkbox, or a
 * status option named Done, Complete or similar).
 */
export async function dueReminders(ctx: OpContext, me: string, scan = 5000) {
  if (!me) return [];
  const pages = await ctx.db.list("pages", ctx.ownerId);
  const databases = new Map(pages.filter((p) => p.kind === "database" && !p.archivedAt).map((d) => [d._id, d]));
  const out: { pageId: string; title: string; database: string; due: string; overdue: boolean }[] = [];
  let seen = 0;
  for (const row of pages) {
    if (!row.databaseId || row.archivedAt || row.isTemplate || ++seen > scan) continue;
    const db = databases.get(row.databaseId);
    const props = db?.properties ?? [];
    const person = props.filter((p) => p.type === "person");
    if (!person.length || !person.some((p) => Array.isArray(row.values?.[p.id]) && (row.values![p.id] as string[]).includes(me))) continue;
    const done = props.some((p) => (p.type === "checkbox" && row.values?.[p.id] === true) || (p.type === "status" && /^(done|complete|completed|closed|shipped)$/i.test(p.options?.find((o) => o.id === row.values?.[p.id])?.name ?? "")));
    if (done) continue;
    const date = props.find((p) => p.type === "date" && typeof row.values?.[p.id] === "string");
    if (!date) continue;
    const due = String(row.values![date.id]);
    const at = Date.parse(due.length <= 10 ? `${due}T23:59` : due);
    if (Number.isNaN(at) || at - ctx.now > 2 * DAY) continue;
    out.push({ pageId: row._id, title: row.title || "Untitled", database: db?.title || "Untitled", due, overdue: at < ctx.now });
  }
  return out.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 50);
}
