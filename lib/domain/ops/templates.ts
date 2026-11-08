import { z } from "zod";
import { MaxError } from "../errors";
import { parseContent, markdownToBlocks } from "../blocks";
import { GALLERY, type GalleryNode } from "../gallery";
import type { PageRow, PropertyDef, SelectOption } from "../types";
import { defineOp, id, title, type OpContext } from "./define";
import { allPages, byRank, cleanTitle, descendants, newPageRow, rankAt, requireDatabase, requirePage, summary, treeChildren } from "./helpers";
import { insertDocument } from "./pages";
import { defaultView, shortId, TITLE_PROPERTY_ID } from "./databaseDefaults";
import { recordsCreate, recordsUpdate } from "./databases";

/** {{today}}, {{now}} and {{date}} become the current date when a template is used. */
export function fillTemplateText(text: string, now: number): string {
  const d = new Date(now);
  const today = d.toISOString().slice(0, 10);
  return text
    .replace(/\{\{\s*(today|date)\s*\}\}/gi, today)
    .replace(/\{\{\s*now\s*\}\}/gi, d.toISOString().slice(0, 16).replace("T", " "));
}

async function copyDocument(ctx: OpContext, fromPageId: string, toPageId: string, fill: boolean) {
  const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: fromPageId }))[0];
  let blocks = parseContent(doc?.content ?? "[]");
  if (fill) blocks = JSON.parse(fillTemplateText(JSON.stringify(blocks), ctx.now));
  await insertDocument(ctx, toPageId, blocks);
}

export const templatesList = defineOp({
  name: "templates.list",
  kind: "query",
  title: "List templates",
  description: "Lists your page templates, or a database's row templates when databaseId is given.",
  input: z.object({ databaseId: id.nullable().optional() }),
  async run(ctx, { databaseId = null }) {
    const pages = await allPages(ctx);
    return {
      templates: pages
        .filter((p) => p.isTemplate && !p.archivedAt && (p.databaseId ?? null) === databaseId)
        .sort(byRank)
        .map((p) => ({ ...summary(p), values: p.values ?? {} })),
    };
  },
});

export const templatesCreate = defineOp({
  name: "templates.create",
  kind: "mutation",
  title: "Create template",
  description:
    "Creates a template: a page template, or a row template for a database (databaseId). Optionally copies content (and subpages) from an existing page. Use {{today}} in titles or text to insert the date when the template is used.",
  input: z.object({ title: title.optional(), databaseId: id.optional(), fromPageId: id.optional(), markdown: z.string().max(200_000).optional(), values: z.record(z.string(), z.unknown()).optional() }),
  async run(ctx, input) {
    const pages = await allPages(ctx);
    let source: PageRow | undefined;
    if (input.fromPageId) source = await requirePage(ctx, input.fromPageId);
    if (input.databaseId) await requireDatabase(ctx, input.databaseId);
    const siblings = pages.filter((p) => p.isTemplate && (p.databaseId ?? null) === (input.databaseId ?? null)).sort(byRank);
    const row = newPageRow(ctx, {
      isTemplate: true,
      databaseId: input.databaseId ?? null,
      title: cleanTitle(input.title ?? source?.title ?? "Untitled template"),
      icon: source?.icon ?? null,
      cover: source?.cover ?? null,
      rank: rankAt(siblings, undefined),
      values: source?.values ?? {},
    });
    const templateId = await ctx.db.insert("pages", row);
    if (source) await copyDocument(ctx, source._id, templateId, false);
    else await insertDocument(ctx, templateId, input.markdown ? markdownToBlocks(input.markdown) : []);
    if (input.values && input.databaseId) {
      // Template rows are validated with the same rules as real rows.
      await recordsUpdate.run(ctx, { id: templateId, values: input.values });
    }
    return { template: { _id: templateId, ...row } };
  },
});

export const templatesApply = defineOp({
  name: "templates.apply",
  kind: "mutation",
  title: "Use template",
  description:
    "Creates a new page from a template (under parentId), or a new row from a database row template. Content, icon, property values and subpages are copied; {{today}} becomes today's date.",
  input: z.object({ templateId: id, parentId: id.nullable().optional(), title: title.optional(), index: z.number().int().min(0).optional() }),
  async run(ctx, { templateId, parentId = null, title: newTitle, index }) {
    const tpl = await requirePage(ctx, templateId);
    if (!tpl.isTemplate) throw new MaxError("VALIDATION", "That page isn't a template.");
    const pages = await allPages(ctx);
    const filledTitle = cleanTitle(newTitle ?? fillTemplateText(tpl.title, ctx.now));
    let newId: string;
    if (tpl.databaseId) {
      const values = Object.fromEntries(Object.entries(tpl.values ?? {}).map(([k, v]) => [k, typeof v === "string" ? fillTemplateText(v, ctx.now) : v]));
      const siblings = pages.filter((p) => p.databaseId === tpl.databaseId && !p.parentId && !p.isTemplate && !p.archivedAt).sort(byRank);
      const row = newPageRow(ctx, { databaseId: tpl.databaseId, title: filledTitle, icon: tpl.icon, cover: tpl.cover, rank: rankAt(siblings, index), values });
      newId = await ctx.db.insert("pages", row);
    } else {
      if (parentId) await requirePage(ctx, parentId);
      const row = newPageRow(ctx, { parentId, title: filledTitle, icon: tpl.icon, cover: tpl.cover, fullWidth: tpl.fullWidth, rank: rankAt(treeChildren(pages, parentId), index) });
      newId = await ctx.db.insert("pages", row);
    }
    await copyDocument(ctx, templateId, newId, true);
    // Subpages of a template come along.
    const map = new Map([[templateId, newId]]);
    for (const child of descendants(pages, templateId).filter((p) => !p.archivedAt && p.parentId)) {
      const { _id, ...rest } = child;
      const cid = await ctx.db.insert("pages", { ...rest, parentId: map.get(child.parentId!) ?? newId, isTemplate: false, databaseId: null, createdAt: ctx.now, updatedAt: ctx.now, lastOpenedAt: null, favoriteRank: null });
      map.set(_id, cid);
      await copyDocument(ctx, _id, cid, true);
    }
    return { id: newId };
  },
});

/* ── Gallery ─────────────────────────────────────────────────────────────── */

export const galleryList = defineOp({
  name: "gallery.list",
  kind: "query",
  title: "List template gallery",
  description: "Built-in templates (video projects, tasks, meeting notes, reading list, content calendar, journal, weekly planner, wiki) that can be added with gallery.install.",
  input: z.object({}),
  async run() {
    return { templates: GALLERY.map(({ root: _root, ...t }) => t) };
  },
});

async function installNode(ctx: OpContext, node: GalleryNode, parentId: string | null): Promise<string> {
  const pages = await allPages(ctx);
  const isDb = !!node.database;
  let properties: PropertyDef[] | undefined;
  let views;
  if (node.database) {
    properties = [{ id: TITLE_PROPERTY_ID, name: "Name", type: "title" }];
    for (const p of node.database.properties) {
      properties.push({
        id: shortId(),
        name: p.name,
        type: p.type,
        ...(p.options ? { options: p.options.map((o): SelectOption => ({ id: shortId(), ...o })) } : {}),
        ...(p.formula ? { formula: p.formula } : {}),
      });
    }
    const byName = (n?: string) => properties!.find((p) => p.name === n)?.id ?? null;
    views = node.database.views.map((v) => {
      const view = defaultView(properties!, v.name, v.type);
      view.groupByPropertyId = byName(v.groupBy);
      view.datePropertyId = byName(v.date);
      if (v.type === "gallery") view.cardPreview = "cover";
      if (v.sort) view.sorts = [{ propertyId: byName(v.sort.property)!, direction: v.sort.direction }];
      return view;
    });
  }
  const row = newPageRow(ctx, {
    kind: isDb ? "database" : "page",
    parentId,
    title: node.title,
    icon: node.icon ?? null,
    rank: rankAt(treeChildren(pages, parentId), undefined),
    fullWidth: isDb,
    ...(isDb ? { properties, views } : {}),
  });
  const pageId = await ctx.db.insert("pages", row);
  await insertDocument(ctx, pageId, node.markdown ? markdownToBlocks(node.markdown) : []);
  if (node.database) {
    for (const r of node.database.rows ?? []) {
      await recordsCreate.run(ctx, { databaseId: pageId, values: { Name: r.title, ...(r.values ?? {}) }, markdown: r.markdown });
    }
    for (const t of node.database.templates ?? []) {
      // Placeholders like {{today}} stay as text until the template is used.
      const values = Object.fromEntries(Object.entries(t.values ?? {}).filter(([, v]) => !(typeof v === "string" && v.includes("{{"))));
      const { template } = await templatesCreate.run(ctx, { databaseId: pageId, title: t.title, markdown: t.markdown, values });
      const raw = Object.entries(t.values ?? {}).filter(([, v]) => typeof v === "string" && v.includes("{{"));
      if (raw.length) {
        const props = properties!;
        const extra = Object.fromEntries(raw.map(([k, v]) => [props.find((p) => p.name === k)?.id ?? k, v as string]));
        await ctx.db.patch("pages", template._id, { values: { ...template.values, ...extra } });
      }
    }
  }
  for (const child of node.children ?? []) await installNode(ctx, child, pageId);
  return pageId;
}

export const galleryInstall = defineOp({
  name: "gallery.install",
  kind: "mutation",
  title: "Add template from gallery",
  description: "Adds a built-in template to your workspace (at the top level or under parentId). Returns the new page id.",
  input: z.object({ key: z.string(), parentId: id.nullable().optional() }),
  async run(ctx, { key, parentId = null }) {
    const tpl = GALLERY.find((g) => g.key === key);
    if (!tpl) throw new MaxError("NOT_FOUND", `No gallery template "${key}". Use gallery.list to see them.`);
    if (parentId) await requirePage(ctx, parentId);
    const pageId = await installNode(ctx, tpl.root, parentId);
    return { id: pageId };
  },
});

export { installNode };
