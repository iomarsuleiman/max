import { z } from "zod";
import { MaxError } from "../errors";
import type { DatabaseView, FilterOperator, PageRow, PropertyDef, PropertyType, PropertyValue, SelectOption, ViewFilter, ViewSort } from "../types";
import { defineOp, id, title, type OpContext } from "./define";
import { allPages, byRank, cleanTitle, LIMITS, newPageRow, rankAt, requireDatabase, requirePage, summary, templateMembers } from "./helpers";
import { insertDocument, pagesArchive, pagesCreate } from "./pages";
import { TITLE_PROPERTY_ID, defaultView, shortId } from "./databaseDefaults";
import { markdownToBlocks } from "../blocks";
import { evaluateFormula, parseFormula, FormulaError, type FValue } from "../formula";
import type { RollupFn } from "../types";

const PROPERTY_TYPES = ["text", "number", "select", "multi_select", "status", "checkbox", "date", "url", "email", "phone", "relation", "formula", "rollup", "created_time", "updated_time"] as const;
const COLORS = ["gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
const OPERATORS = ["contains", "not_contains", "equals", "not_equals", "is_empty", "is_not_empty", "gt", "lt", "is_checked", "is_not_checked", "before", "after"] as const;

const optionInput = z.object({ id: z.string().optional(), name: z.string().min(1).max(100), color: z.enum(COLORS).optional() });
const filterInput = z.object({ id: z.string().optional(), propertyId: z.string(), operator: z.enum(OPERATORS), value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional() });
const sortInput = z.object({ propertyId: z.string(), direction: z.enum(["asc", "desc"]) });

function records(pages: PageRow[], databaseId: string) {
  return pages.filter((p) => p.databaseId === databaseId && !p.parentId && !p.archivedAt && !p.isTemplate);
}

function normalizeOptions(options: z.infer<typeof optionInput>[] | undefined, existing: SelectOption[] = []): SelectOption[] {
  if (!options) return existing;
  if (options.length > LIMITS.optionsPerProperty) throw new MaxError("LIMIT", `A property can have up to ${LIMITS.optionsPerProperty} options.`);
  return options.map((o, i) => ({
    id: o.id ?? existing.find((e) => e.name === o.name)?.id ?? shortId(),
    name: o.name.trim(),
    color: o.color ?? existing.find((e) => e.name === o.name)?.color ?? COLORS[i % COLORS.length],
  }));
}

/** Coerces and validates a value for a property. Select names that don't exist yet become new options. */
async function coerceValue(ctx: OpContext, prop: PropertyDef, raw: unknown, newOptions: Map<string, SelectOption[]>): Promise<PropertyValue> {
  if (raw === null || raw === undefined || raw === "") return null;
  const fail = (msg: string) => new MaxError("VALIDATION", `${prop.name}: ${msg}`, { propertyId: prop.id });
  switch (prop.type) {
    case "title":
    case "text":
      return String(raw).slice(0, 10_000);
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
      if (!Number.isFinite(n)) throw fail("enter a number.");
      return n;
    }
    case "checkbox":
      return raw === true || raw === "true" || raw === 1;
    case "date": {
      const s = String(raw);
      if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(s) || Number.isNaN(Date.parse(s))) throw fail("use a date like 2026-11-08.");
      return s.slice(0, 19);
    }
    case "url": {
      const s = String(raw).trim();
      const withScheme = /^[a-z]+:/i.test(s) ? s : `https://${s}`;
      if (!/^https?:\/\/[^\s]+\.[^\s]+/.test(withScheme)) throw fail("enter a web address.");
      return withScheme;
    }
    case "email": {
      const s = String(raw).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw fail("enter an email address.");
      return s;
    }
    case "select":
    case "status":
    case "multi_select": {
      const values = (Array.isArray(raw) ? raw : prop.type === "multi_select" ? String(raw).split(",") : [raw]).map((v) => String(v).trim()).filter(Boolean);
      const options = newOptions.get(prop.id) ?? [...(prop.options ?? [])];
      const ids = values.map((v) => {
        const found = options.find((o) => o.id === v || o.name.toLowerCase() === v.toLowerCase());
        if (found) return found.id;
        if (prop.type === "status") throw fail(`"${v}" isn't one of: ${options.map((o) => o.name).join(", ")}.`);
        const created = { id: shortId(), name: v.slice(0, 100), color: COLORS[options.length % COLORS.length] };
        options.push(created);
        return created.id;
      });
      newOptions.set(prop.id, options);
      return prop.type === "multi_select" ? [...new Set(ids)] : (ids[0] ?? null);
    }
    case "relation": {
      const ids = (Array.isArray(raw) ? raw : [raw]).map(String);
      for (const rid of ids) {
        const target = await ctx.db.get("pages", rid);
        if (!target || target.ownerId !== ctx.ownerId || target.archivedAt || (prop.relationDatabaseId && target.databaseId !== prop.relationDatabaseId)) {
          throw fail(`row ${rid} isn't in the related database.`);
        }
      }
      return [...new Set(ids)];
    }
    case "phone": {
      const s = String(raw).trim();
      if (!/^[+()\d\s.-]{3,32}$/.test(s)) throw fail("enter a phone number.");
      return s;
    }
    case "formula":
    case "rollup":
    case "created_time":
    case "updated_time":
      throw fail("this property is calculated automatically.");
  }
}

async function applyValues(ctx: OpContext, db: PageRow, input: Record<string, unknown>) {
  const props = db.properties ?? [];
  const values: Record<string, PropertyValue> = {};
  const newOptions = new Map<string, SelectOption[]>();
  let titleValue: string | undefined;
  for (const [key, raw] of Object.entries(input)) {
    const prop = props.find((p) => p.id === key) ?? props.find((p) => p.name.toLowerCase() === key.toLowerCase());
    if (!prop) throw new MaxError("VALIDATION", `"${key}" isn't a property of this database. Properties: ${props.map((p) => p.name).join(", ")}.`);
    const value = await coerceValue(ctx, prop, raw, newOptions);
    if (prop.type === "title") titleValue = cleanTitle(String(value ?? ""));
    else values[prop.id] = value;
  }
  if (newOptions.size) {
    const properties = props.map((p) => (newOptions.has(p.id) ? { ...p, options: newOptions.get(p.id) } : p));
    await ctx.db.patch("pages", db._id, { properties, updatedAt: ctx.now });
    db.properties = properties;
  }
  return { values, titleValue };
}

function recordView(r: PageRow) {
  return { ...summary(r), values: r.values ?? {} };
}

const rollupInput = z.object({
  relationPropertyId: z.string(),
  targetPropertyId: z.string(),
  fn: z.enum(["count", "count_values", "sum", "average", "min", "max", "percent_checked", "show_original"]),
});

async function validateComputed(ctx: OpContext, props: PropertyDef[], type: string, formula?: string, rollup?: z.infer<typeof rollupInput>) {
  if (type === "formula") {
    try {
      parseFormula(formula ?? "");
    } catch (err) {
      throw new MaxError("VALIDATION", `Formula: ${err instanceof FormulaError ? err.message : "couldn't be read"}.`);
    }
  }
  if (type === "rollup") {
    if (!rollup) throw new MaxError("VALIDATION", "Choose a relation and a property to roll up.");
    const rel = props.find((p) => p.id === rollup.relationPropertyId && p.type === "relation");
    if (!rel?.relationDatabaseId) throw new MaxError("VALIDATION", "Rollups need a relation property in this database.");
    const target = await requireDatabase(ctx, rel.relationDatabaseId);
    if (!target.properties?.some((p) => p.id === rollup.targetPropertyId)) throw new MaxError("VALIDATION", "That property doesn't exist in the related database.");
  }
}

function plainValue(prop: PropertyDef, record: PageRow): FValue {
  const v = prop.type === "title" ? record.title : record.values?.[prop.id];
  const shown = displayValue(prop, (v ?? null) as PropertyValue, record);
  if (prop.type === "created_time" || prop.type === "updated_time") return new Date(Number(shown)).toISOString().slice(0, 16);
  return (shown ?? null) as FValue;
}

function aggregate(fn: RollupFn, values: FValue[]): FValue {
  const present = values.filter((v) => v !== null && v !== "");
  const nums = present.map(Number).filter(Number.isFinite);
  switch (fn) {
    case "count": return values.length;
    case "count_values": return present.length;
    case "sum": return nums.reduce((a, b) => a + b, 0);
    case "average": return nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 100) / 100 : null;
    case "min": return nums.length ? Math.min(...nums) : null;
    case "max": return nums.length ? Math.max(...nums) : null;
    case "percent_checked": return values.length ? Math.round((values.filter((v) => v === true).length / values.length) * 100) : null;
    case "show_original": return present.map(String).join(", ");
  }
}

/** Rows with formula and rollup values filled in (never stored; always calculated from current data). */
export function withComputed(props: PropertyDef[], rows: PageRow[], pages: PageRow[], now = Date.now()): PageRow[] {
  const computed = props.filter((p) => p.type === "formula" || p.type === "rollup");
  if (!computed.length) return rows;
  const byId = new Map(pages.map((p) => [p._id, p]));
  const dbProps = new Map<string, PropertyDef[]>();
  for (const p of pages) if (p.kind === "database") dbProps.set(p._id, p.properties ?? []);
  return rows.map((row) => {
    const values = { ...row.values };
    const current = { ...row, values };
    for (const prop of computed) {
      try {
        if (prop.type === "rollup" && prop.rollup) {
          const rel = props.find((p) => p.id === prop.rollup!.relationPropertyId);
          const targetProp = rel?.relationDatabaseId ? dbProps.get(rel.relationDatabaseId)?.find((p) => p.id === prop.rollup!.targetPropertyId) : undefined;
          const linked = ((row.values?.[rel?.id ?? ""] as string[] | null) ?? []).map((rid) => byId.get(rid)).filter((r): r is PageRow => !!r && !r.archivedAt);
          values[prop.id] = targetProp ? (aggregate(prop.rollup.fn, linked.map((r) => plainValue(targetProp, r))) as PropertyValue) : null;
        } else if (prop.type === "formula" && prop.formula) {
          values[prop.id] = evaluateFormula(prop.formula, (name) => {
            const target = props.find((p) => p.name.toLowerCase() === name.toLowerCase());
            if (!target) throw new FormulaError(`No property named "${name}"`);
            if (target.id === prop.id) throw new FormulaError("A formula can't refer to itself");
            return plainValue(target, current);
          }, now) as PropertyValue;
        }
      } catch {
        values[prop.id] = null;
      }
    }
    return current;
  });
}

/* ── Database lifecycle ──────────────────────────────────────────────────── */

export const databasesCreate = defineOp({
  name: "databases.create",
  kind: "mutation",
  title: "Create database",
  description: "Creates a personal database (a table of rows, each row is also a page) with Name, Status, Tags and Date properties and one table view.",
  input: z.object({ title: title.optional(), parentId: id.nullable().optional(), icon: z.string().max(64).nullable().optional(), index: z.number().int().min(0).optional() }),
  async run(ctx, input) {
    const { page } = await pagesCreate.run(ctx, { ...input, kind: "database", title: input.title ?? "" });
    return { database: page };
  },
});

export const databasesGet = defineOp({
  name: "databases.get",
  kind: "query",
  title: "Get database schema",
  description: "Returns a database's properties (with option ids/names) and saved views.",
  input: z.object({ databaseId: id }),
  async run(ctx, { databaseId }) {
    const db = await requirePage(ctx, databaseId, { allowArchived: true });
    if (db.kind !== "database") throw new MaxError("VALIDATION", "That page isn't a database.");
    const pages = await allPages(ctx);
    return { database: summary(db), properties: db.properties ?? [], views: db.views ?? [], recordCount: records(pages, databaseId).length };
  },
});

export const databasesList = defineOp({
  name: "databases.list",
  kind: "query",
  title: "List databases",
  description: "Lists all live personal databases with row counts.",
  input: z.object({}),
  async run(ctx) {
    const pages = await allPages(ctx);
    return {
      databases: pages
        .filter((p) => p.kind === "database" && !p.archivedAt && !templateMembers(pages).has(p._id))
        .map((p) => ({ ...summary(p), recordCount: records(pages, p._id).length, properties: (p.properties ?? []).map((x) => ({ id: x.id, name: x.name, type: x.type })) })),
    };
  },
});

/* ── Properties ──────────────────────────────────────────────────────────── */

export const propertiesAdd = defineOp({
  name: "properties.add",
  kind: "mutation",
  title: "Add property",
  description: "Adds a property (column) to a database. Types: text, number, select, multi_select, status, checkbox, date, url, email, relation (needs relationDatabaseId), created_time, updated_time.",
  input: z.object({
    databaseId: id,
    name: z.string().min(1).max(100),
    type: z.enum(PROPERTY_TYPES),
    options: z.array(optionInput).optional(),
    relationDatabaseId: id.optional(),
    numberFormat: z.enum(["number", "percent", "currency"]).optional(),
    formula: z.string().max(2000).optional().describe('Formula properties, e.g. prop("Price") * prop("Qty")'),
    rollup: rollupInput.optional(),
  }),
  async run(ctx, input) {
    const db = await requireDatabase(ctx, input.databaseId);
    const props = db.properties ?? [];
    await validateComputed(ctx, props, input.type, input.formula, input.rollup);
    if (props.length >= LIMITS.propertiesPerDatabase) throw new MaxError("LIMIT", `A database can have up to ${LIMITS.propertiesPerDatabase} properties.`);
    if (props.some((p) => p.name.toLowerCase() === input.name.trim().toLowerCase())) throw new MaxError("VALIDATION", `There's already a property named "${input.name}".`);
    if (input.type === "relation") {
      if (!input.relationDatabaseId) throw new MaxError("VALIDATION", "Choose which database this relation points to.");
      await requireDatabase(ctx, input.relationDatabaseId);
    }
    const prop: PropertyDef = {
      id: shortId(),
      name: input.name.trim(),
      type: input.type as PropertyType,
      ...(["select", "multi_select", "status"].includes(input.type) ? { options: normalizeOptions(input.options) } : {}),
      ...(input.relationDatabaseId ? { relationDatabaseId: input.relationDatabaseId } : {}),
      ...(input.numberFormat ? { numberFormat: input.numberFormat } : {}),
      ...(input.type === "formula" ? { formula: input.formula ?? "" } : {}),
      ...(input.type === "rollup" && input.rollup ? { rollup: input.rollup } : {}),
    };
    const views = (db.views ?? []).map((v) => ({ ...v, propertyOrder: [...v.propertyOrder, prop.id] }));
    await ctx.db.patch("pages", db._id, { properties: [...props, prop], views, updatedAt: ctx.now });
    return { property: prop };
  },
});

export const propertiesUpdate = defineOp({
  name: "properties.update",
  kind: "mutation",
  title: "Update property",
  description:
    "Renames a property, changes its type, or replaces its select options. Changing type converts existing values where possible (values that can't convert are cleared).",
  input: z.object({
    databaseId: id,
    propertyId: z.string(),
    name: z.string().min(1).max(100).optional(),
    type: z.enum(PROPERTY_TYPES).optional(),
    options: z.array(optionInput).optional(),
    numberFormat: z.enum(["number", "percent", "currency"]).optional(),
    formula: z.string().max(2000).optional(),
    rollup: rollupInput.optional(),
  }),
  async run(ctx, input) {
    const db = await requireDatabase(ctx, input.databaseId);
    const props = db.properties ?? [];
    const prop = props.find((p) => p.id === input.propertyId);
    if (!prop) throw new MaxError("NOT_FOUND", "That property doesn't exist.");
    const targetType = input.type ?? prop.type;
    if (targetType === "formula" || targetType === "rollup") {
      await validateComputed(ctx, props, targetType, input.formula ?? prop.formula, input.rollup ?? prop.rollup);
    }
    if (prop.type === "title" && input.type && input.type !== ("title" as never)) throw new MaxError("VALIDATION", "The Name property can't change type.");
    if (input.name && props.some((p) => p.id !== prop.id && p.name.toLowerCase() === input.name!.trim().toLowerCase())) throw new MaxError("VALIDATION", `There's already a property named "${input.name}".`);
    const next: PropertyDef = { ...prop, ...(input.name ? { name: input.name.trim() } : {}), ...(input.numberFormat ? { numberFormat: input.numberFormat } : {}) };
    if (input.options) next.options = normalizeOptions(input.options, prop.options);
    if (input.formula !== undefined) next.formula = input.formula;
    if (input.rollup) next.rollup = input.rollup;
    let converted = 0;
    if (input.type && (input.type === "formula" || input.type === "rollup" || prop.type === "formula" || prop.type === "rollup")) {
      // Calculated values aren't stored, so there's nothing to convert.
      next.type = input.type as PropertyType;
      if (input.type !== "formula") delete next.formula;
      if (input.type !== "rollup") delete next.rollup;
      if (input.type === "formula") next.formula = input.formula ?? prop.formula ?? "";
      await ctx.db.patch("pages", db._id, { properties: props.map((p) => (p.id === prop.id ? next : p)), updatedAt: ctx.now });
      return { property: next, converted };
    }
    if (input.type && input.type !== prop.type) {
      if (input.type === "relation") throw new MaxError("VALIDATION", "Add a new relation property instead of converting an existing one.");
      next.type = input.type;
      const isSelect = (t: string) => ["select", "multi_select", "status"].includes(t);
      if (isSelect(input.type) && !next.options) next.options = isSelect(prop.type) ? prop.options : [];
      if (!isSelect(input.type)) delete next.options;
      const pages = await allPages(ctx);
      const newOptions = new Map<string, SelectOption[]>();
      for (const r of records(pages, db._id)) {
        const old = r.values?.[prop.id];
        if (old === undefined || old === null) continue;
        const asText = Array.isArray(old)
          ? old.map((o) => prop.options?.find((x) => x.id === o)?.name ?? o).join(",")
          : isSelect(prop.type)
            ? (prop.options?.find((x) => x.id === old)?.name ?? String(old))
            : String(old);
        let value: PropertyValue = null;
        try {
          value = await coerceValue(ctx, { ...next, options: newOptions.get(next.id) ?? next.options }, input.type === "checkbox" ? asText === "true" : asText, newOptions);
        } catch {
          value = null;
        }
        if (newOptions.has(next.id)) next.options = newOptions.get(next.id);
        await ctx.db.patch("pages", r._id, { values: { ...r.values, [prop.id]: value } });
        converted++;
      }
    }
    // Removed options are cleared from rows.
    if (input.options && prop.options) {
      const keep = new Set(next.options!.map((o) => o.id));
      const pages = await allPages(ctx);
      for (const r of records(pages, db._id)) {
        const v = r.values?.[prop.id];
        const cleaned = Array.isArray(v) ? v.filter((x) => keep.has(x)) : typeof v === "string" && !keep.has(v) ? null : v;
        if (JSON.stringify(cleaned) !== JSON.stringify(v)) await ctx.db.patch("pages", r._id, { values: { ...r.values, [prop.id]: cleaned ?? null } });
      }
    }
    await ctx.db.patch("pages", db._id, { properties: props.map((p) => (p.id === prop.id ? next : p)), updatedAt: ctx.now });
    return { property: next, converted };
  },
});

export const propertiesDelete = defineOp({
  name: "properties.delete",
  kind: "mutation",
  title: "Delete property",
  destructive: true,
  description: "Deletes a property and its values from every row. The Name property can't be deleted. This can't be undone.",
  input: z.object({ databaseId: id, propertyId: z.string(), confirm: z.boolean().optional() }),
  async run(ctx, { databaseId, propertyId }) {
    const db = await requireDatabase(ctx, databaseId);
    const prop = db.properties?.find((p) => p.id === propertyId);
    if (!prop) throw new MaxError("NOT_FOUND", "That property doesn't exist.");
    if (prop.type === "title") throw new MaxError("VALIDATION", "The Name property can't be deleted.");
    const pages = await allPages(ctx);
    for (const r of records(pages, databaseId)) {
      if (r.values && propertyId in r.values) {
        const { [propertyId]: _removed, ...rest } = r.values;
        await ctx.db.patch("pages", r._id, { values: rest });
      }
    }
    const views = (db.views ?? []).map((v) => ({
      ...v,
      propertyOrder: v.propertyOrder.filter((x) => x !== propertyId),
      hiddenPropertyIds: v.hiddenPropertyIds.filter((x) => x !== propertyId),
      filters: v.filters.filter((f) => f.propertyId !== propertyId),
      sorts: v.sorts.filter((s) => s.propertyId !== propertyId),
      groupByPropertyId: v.groupByPropertyId === propertyId ? null : v.groupByPropertyId,
    }));
    await ctx.db.patch("pages", databaseId, { properties: db.properties!.filter((p) => p.id !== propertyId), views, updatedAt: ctx.now });
    return { deleted: propertyId };
  },
});

/* ── Records ─────────────────────────────────────────────────────────────── */

export const recordsCreate = defineOp({
  name: "records.create",
  kind: "mutation",
  title: "Create row",
  description: "Adds a row to a database. `values` is keyed by property id or name (select values by option name; new names become options). Each row is a page and can have content via markdown.",
  input: z.object({
    databaseId: id,
    values: z.record(z.string(), z.unknown()).optional(),
    title: title.optional(),
    markdown: z.string().max(200_000).optional(),
    index: z.number().int().min(0).optional(),
  }),
  async run(ctx, input) {
    const db = await requireDatabase(ctx, input.databaseId);
    const pages = await allPages(ctx);
    if (pages.length >= LIMITS.pagesPerAccount) throw new MaxError("LIMIT", "You've reached your page limit. Empty the trash to make room.");
    const { values, titleValue } = await applyValues(ctx, db, input.values ?? {});
    const siblings = records(pages, db._id).sort(byRank);
    const row = newPageRow(ctx, { databaseId: db._id, title: titleValue ?? cleanTitle(input.title), rank: rankAt(siblings, input.index), values });
    const recordId = await ctx.db.insert("pages", row);
    await insertDocument(ctx, recordId, input.markdown ? markdownToBlocks(input.markdown) : []);
    return { record: recordView({ _id: recordId, ...row }) };
  },
});

export const recordsCreateMany = defineOp({
  name: "records.createMany",
  kind: "mutation",
  title: "Create rows in bulk",
  description: "Adds up to 200 rows at once. All rows are validated first; if any is invalid, none are added.",
  input: z.object({ databaseId: id, rows: z.array(z.record(z.string(), z.unknown())).min(1).max(200) }),
  async run(ctx, { databaseId, rows }) {
    const created: string[] = [];
    for (const values of rows) {
      const { record } = await recordsCreate.run(ctx, { databaseId, values });
      created.push(record._id);
    }
    return { created };
  },
});

export const recordsUpdate = defineOp({
  name: "records.update",
  kind: "mutation",
  title: "Update row",
  description: "Sets property values on a row (keyed by property id or name). Pass null to clear a value.",
  input: z.object({ id, values: z.record(z.string(), z.unknown()) }),
  async run(ctx, { id: recordId, values: input }) {
    const record = await requirePage(ctx, recordId);
    if (!record.databaseId) throw new MaxError("VALIDATION", "That page isn't a database row.");
    const db = await requireDatabase(ctx, record.databaseId);
    const { values, titleValue } = await applyValues(ctx, db, input);
    const patch: Partial<PageRow> = { values: { ...record.values, ...values }, updatedAt: ctx.now };
    if (titleValue !== undefined) patch.title = titleValue;
    await ctx.db.patch("pages", recordId, patch);
    return { record: recordView({ ...record, ...patch }) };
  },
});

export const recordsUpdateMany = defineOp({
  name: "records.updateMany",
  kind: "mutation",
  title: "Update rows in bulk",
  description: "Applies the same values to several rows. All-or-nothing.",
  input: z.object({ ids: z.array(id).min(1).max(500), values: z.record(z.string(), z.unknown()) }),
  async run(ctx, { ids, values }) {
    for (const rid of ids) await recordsUpdate.run(ctx, { id: rid, values });
    return { updated: ids.length };
  },
});

export const recordsMove = defineOp({
  name: "records.move",
  kind: "mutation",
  title: "Reorder row",
  description: "Moves a row to a position in the database's manual order (used when a view has no sort).",
  input: z.object({ id, index: z.number().int().min(0) }),
  async run(ctx, { id: recordId, index }) {
    const record = await requirePage(ctx, recordId);
    if (!record.databaseId) throw new MaxError("VALIDATION", "That page isn't a database row.");
    const pages = await allPages(ctx);
    const siblings = records(pages, record.databaseId).filter((r) => r._id !== recordId).sort(byRank);
    const rank = rankAt(siblings, index);
    await ctx.db.patch("pages", recordId, { rank });
    return { rank };
  },
});

export const recordsDelete = defineOp({
  name: "records.delete",
  kind: "mutation",
  title: "Delete rows",
  description: "Moves rows to the trash (restore with pages.restore).",
  input: z.object({ ids: z.array(id).min(1).max(500) }),
  async run(ctx, { ids }) {
    for (const rid of ids) {
      const r = await requirePage(ctx, rid);
      if (!r.databaseId) throw new MaxError("VALIDATION", "Only database rows can be deleted with records.delete.");
      await pagesArchive.run(ctx, { id: rid });
    }
    return { trashed: ids.length };
  },
});

/* ── Query ───────────────────────────────────────────────────────────────── */

function displayValue(prop: PropertyDef | undefined, value: PropertyValue, record: PageRow): string | number | boolean | null {
  if (!prop) return null;
  if (prop.type === "title") return record.title;
  if (prop.type === "created_time") return record.createdAt;
  if (prop.type === "updated_time") return record.updatedAt;
  if (value === null || value === undefined) return null;
  if (prop.type === "formula" || prop.type === "rollup") return value as string | number | boolean;
  if (["select", "status"].includes(prop.type)) return prop.options?.find((o) => o.id === value)?.name ?? null;
  if (prop.type === "multi_select") return (value as string[]).map((v) => prop.options?.find((o) => o.id === v)?.name ?? "").join(", ");
  if (Array.isArray(value)) return value.join(",");
  return value as string | number | boolean;
}

export function matchesFilter(prop: PropertyDef | undefined, record: PageRow, f: { operator: FilterOperator; value?: unknown }): boolean {
  const raw = prop?.type === "title" ? record.title : record.values?.[prop?.id ?? ""];
  const shown = displayValue(prop, raw ?? null, record);
  const empty = shown === null || shown === "" || (Array.isArray(raw) && raw.length === 0);
  const needle = f.value === undefined || f.value === null ? "" : String(f.value).toLowerCase();
  const text = shown === null ? "" : String(shown).toLowerCase();
  switch (f.operator) {
    case "is_empty":
      return empty;
    case "is_not_empty":
      return !empty;
    case "is_checked":
      return shown === true;
    case "is_not_checked":
      return shown !== true;
    case "contains":
      if (prop?.type === "multi_select") return text.split(", ").includes(needle);
      return text.includes(needle);
    case "not_contains":
      if (prop?.type === "multi_select") return !text.split(", ").includes(needle);
      return !text.includes(needle);
    case "equals":
      return prop?.type === "number" ? Number(shown) === Number(f.value) : text === needle;
    case "not_equals":
      return prop?.type === "number" ? Number(shown) !== Number(f.value) : text !== needle;
    case "gt":
      return !empty && Number(shown) > Number(f.value);
    case "lt":
      return !empty && Number(shown) < Number(f.value);
    case "before":
      return !empty && String(shown) < String(f.value);
    case "after":
      return !empty && String(shown) > String(f.value);
  }
}

export function compareRecords(props: PropertyDef[], sorts: ViewSort[]) {
  return (a: PageRow, b: PageRow) => {
    for (const s of sorts) {
      const prop = props.find((p) => p.id === s.propertyId);
      const va = displayValue(prop, (prop?.type === "title" ? a.title : a.values?.[s.propertyId]) ?? null, a);
      const vb = displayValue(prop, (prop?.type === "title" ? b.title : b.values?.[s.propertyId]) ?? null, b);
      if (va === vb) continue;
      if (va === null || va === "") return 1;
      if (vb === null || vb === "") return -1;
      let cmp: number;
      if (prop?.type === "status" || prop?.type === "select") {
        const ia = prop.options?.findIndex((o) => o.name === va) ?? 0;
        const ib = prop.options?.findIndex((o) => o.name === vb) ?? 0;
        cmp = ia - ib;
      } else cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
      if (cmp) return s.direction === "asc" ? cmp : -cmp;
    }
    return a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0;
  };
}

export const databasesQuery = defineOp({
  name: "databases.query",
  kind: "query",
  title: "Query rows",
  description:
    "Returns rows of a database. Applies a saved view's filters and sorts when viewId is given, plus any extra filters/sorts/search. Paginate with cursor (an offset) and limit (max 200).",
  input: z.object({
    databaseId: id,
    viewId: z.string().optional(),
    filters: z.array(filterInput).optional(),
    sorts: z.array(sortInput).optional(),
    search: z.string().max(200).optional(),
    cursor: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(LIMITS.queryPage).optional(),
  }),
  async run(ctx, input) {
    const db = await requirePage(ctx, input.databaseId, { allowArchived: true });
    if (db.kind !== "database") throw new MaxError("VALIDATION", "That page isn't a database.");
    const props = db.properties ?? [];
    const view = input.viewId ? db.views?.find((v) => v.id === input.viewId) : undefined;
    if (input.viewId && !view) throw new MaxError("NOT_FOUND", "That view doesn't exist.");
    const filters = [...(view?.filters ?? []), ...(input.filters ?? [])];
    const sorts = [...(input.sorts ?? []), ...(view?.sorts ?? [])];
    const pages = await allPages(ctx);
    const q = input.search?.trim().toLowerCase();
    let rows = withComputed(props, records(pages, db._id), pages, ctx.now).filter((r) => filters.every((f) => matchesFilter(props.find((p) => p.id === f.propertyId), r, f)));
    if (q) {
      rows = rows.filter((r) => [r.title, ...props.map((p) => displayValue(p, r.values?.[p.id] ?? null, r))].some((v) => v !== null && String(v).toLowerCase().includes(q)));
    }
    rows.sort(compareRecords(props, sorts));
    const start = input.cursor ?? 0;
    const limit = input.limit ?? 100;
    const page = rows.slice(start, start + limit);
    return {
      records: page.map(recordView),
      total: rows.length,
      unfilteredTotal: records(pages, db._id).length,
      nextCursor: start + limit < rows.length ? start + limit : null,
    };
  },
});

/* ── Views ───────────────────────────────────────────────────────────────── */

const viewPatch = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.enum(["table", "board", "list", "gallery", "calendar"]).optional(),
  filters: z.array(filterInput).max(20).optional(),
  sorts: z.array(sortInput).max(10).optional(),
  hiddenPropertyIds: z.array(z.string()).optional(),
  propertyOrder: z.array(z.string()).optional(),
  columnWidths: z.record(z.string(), z.number().min(60).max(1200)).optional(),
  groupByPropertyId: z.string().nullable().optional(),
  datePropertyId: z.string().nullable().optional(),
  cardPreview: z.enum(["cover", "none"]).optional(),
  openPagesIn: z.enum(["side", "center", "full"]).optional(),
});

export const viewsCreate = defineOp({
  name: "views.create",
  kind: "mutation",
  title: "Create view",
  description: "Adds a saved view (table, list or board) to a database.",
  input: z.object({ databaseId: id, name: z.string().min(1).max(100), type: z.enum(["table", "board", "list", "gallery", "calendar"]).optional() }),
  async run(ctx, { databaseId, name, type = "table" }) {
    const db = await requireDatabase(ctx, databaseId);
    if ((db.views?.length ?? 0) >= LIMITS.viewsPerDatabase) throw new MaxError("LIMIT", `A database can have up to ${LIMITS.viewsPerDatabase} views.`);
    const view = defaultView(db.properties ?? [], name, type);
    if (type === "board") view.groupByPropertyId = db.properties?.find((p) => p.type === "status" || p.type === "select")?.id ?? null;
    if (type === "calendar") view.datePropertyId = db.properties?.find((p) => p.type === "date")?.id ?? null;
    if (type === "gallery") view.cardPreview = "cover";
    await ctx.db.patch("pages", databaseId, { views: [...(db.views ?? []), view], updatedAt: ctx.now });
    return { view };
  },
});

export const viewsUpdate = defineOp({
  name: "views.update",
  kind: "mutation",
  title: "Update view",
  description: "Changes a view's name, layout, filters, sorts, hidden or ordered properties, column widths or board grouping.",
  input: z.object({ databaseId: id, viewId: z.string(), patch: viewPatch }),
  async run(ctx, { databaseId, viewId, patch }) {
    const db = await requireDatabase(ctx, databaseId);
    const view = db.views?.find((v) => v.id === viewId);
    if (!view) throw new MaxError("NOT_FOUND", "That view doesn't exist.");
    const propIds = new Set((db.properties ?? []).map((p) => p.id));
    for (const ref of [...(patch.filters ?? []).map((f) => f.propertyId), ...(patch.sorts ?? []).map((s) => s.propertyId)]) {
      if (!propIds.has(ref)) throw new MaxError("VALIDATION", `Property "${ref}" doesn't exist in this database.`);
    }
    const next: DatabaseView = {
      ...view,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
      filters: (patch.filters ?? view.filters).map((f) => ({ ...f, id: f.id ?? shortId() }) as ViewFilter),
    };
    await ctx.db.patch("pages", databaseId, { views: db.views!.map((v) => (v.id === viewId ? next : v)), updatedAt: ctx.now });
    return { view: next };
  },
});

export const viewsDelete = defineOp({
  name: "views.delete",
  kind: "mutation",
  title: "Delete view",
  description: "Removes a saved view (rows are not affected). A database keeps at least one view.",
  input: z.object({ databaseId: id, viewId: z.string() }),
  async run(ctx, { databaseId, viewId }) {
    const db = await requireDatabase(ctx, databaseId);
    if ((db.views?.length ?? 0) <= 1) throw new MaxError("VALIDATION", "A database needs at least one view.");
    await ctx.db.patch("pages", databaseId, { views: db.views!.filter((v) => v.id !== viewId), updatedAt: ctx.now });
    return { deleted: viewId };
  },
});

export const viewsMove = defineOp({
  name: "views.move",
  kind: "mutation",
  title: "Reorder view",
  description: "Moves a view tab to a new position.",
  input: z.object({ databaseId: id, viewId: z.string(), index: z.number().int().min(0) }),
  async run(ctx, { databaseId, viewId, index }) {
    const db = await requireDatabase(ctx, databaseId);
    const views = [...(db.views ?? [])];
    const from = views.findIndex((v) => v.id === viewId);
    if (from < 0) throw new MaxError("NOT_FOUND", "That view doesn't exist.");
    const [view] = views.splice(from, 1);
    views.splice(Math.min(index, views.length), 0, view);
    await ctx.db.patch("pages", databaseId, { views });
    return { views: views.map((v) => v.id) };
  },
});

export { TITLE_PROPERTY_ID, records as databaseRecords, displayValue };
export type { OpContext };
