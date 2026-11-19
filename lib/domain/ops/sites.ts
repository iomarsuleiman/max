import { z } from "zod";
import { MaxError } from "../errors";
import { defineOp, id } from "./define";
import { requirePage } from "./helpers";

/** Addresses that would clash with Max itself or mislead visitors. */
const RESERVED = new Set(["www", "app", "api", "admin", "max", "home", "site", "sites", "help", "support", "mail", "status", "docs", "blog", "login", "signin", "signup", "join", "settings", "static", "assets", "cdn"]);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, "Use 3–40 lowercase letters, numbers and hyphens (not at the start or end).");

export const sitesGet = defineOp({
  name: "sites.get",
  kind: "query",
  title: "Get a page's website",
  description: "Returns the website published from a page (its address, name, icon, description and whether visitors can search), or null.",
  input: z.object({ pageId: id }),
  async run(ctx, { pageId }) {
    await requirePage(ctx, pageId);
    return { site: (await ctx.db.list("sites", ctx.ownerId, { field: "pageId", value: pageId }))[0] ?? null };
  },
});

export const sitesList = defineOp({
  name: "sites.list",
  kind: "query",
  title: "List my websites",
  description: "Every page you've published as a website.",
  input: z.object({}),
  async run(ctx) {
    return { sites: (await ctx.db.list("sites", ctx.ownerId)).sort((a, b) => b.updatedAt - a.updatedAt) };
  },
});

export const sitesPublish = defineOp({
  name: "sites.publish",
  kind: "mutation",
  title: "Publish a page as a website",
  description:
    "Publishes a page and every page inside it as a simple public website with navigation, at /site/<slug> (and <slug>.<your domain> where subdomains are set up). Calling it again updates the name, address, icon, description or search. Anyone with the address can read the site; nothing else in your workspace is visible.",
  input: z.object({
    pageId: id,
    slug,
    name: z.string().trim().min(1).max(80),
    icon: z.string().max(2048).nullable().optional(),
    description: z.string().trim().max(200).optional(),
    search: z.boolean().optional(),
  }),
  async run(ctx, input) {
    const page = await requirePage(ctx, input.pageId);
    if (page.kind !== "page" || page.isTemplate) throw new MaxError("VALIDATION", "Publish a page (not a database or template) as a website.");
    if (RESERVED.has(input.slug)) throw new MaxError("VALIDATION", `“${input.slug}” is reserved. Pick another address.`);
    const taken = (await ctx.db.findBy("sites", "slug", input.slug)).find((s) => s.pageId !== input.pageId || s.ownerId !== ctx.ownerId);
    if (taken) throw new MaxError("CONFLICT", `The address “${input.slug}” is taken. Try another.`);
    const existing = (await ctx.db.list("sites", ctx.ownerId, { field: "pageId", value: input.pageId }))[0];
    const fields = { slug: input.slug, name: input.name, icon: input.icon === undefined ? (existing?.icon ?? page.icon) : input.icon, description: input.description ?? existing?.description ?? "", search: input.search ?? existing?.search ?? true, updatedAt: ctx.now };
    if (existing) {
      await ctx.db.patch("sites", existing._id, fields);
      return { site: { ...existing, ...fields } };
    }
    const row = { ownerId: ctx.ownerId, pageId: input.pageId, createdAt: ctx.now, ...fields };
    const _id = await ctx.db.insert("sites", row);
    return { site: { _id, ...row } };
  },
});

export const sitesUnpublish = defineOp({
  name: "sites.unpublish",
  kind: "mutation",
  title: "Unpublish a website",
  description: "Takes a page's website offline. The pages stay in your workspace.",
  input: z.object({ pageId: id }),
  async run(ctx, { pageId }) {
    await requirePage(ctx, pageId, { allowArchived: true });
    for (const s of await ctx.db.list("sites", ctx.ownerId, { field: "pageId", value: pageId })) await ctx.db.delete("sites", s._id);
    return { ok: true };
  },
});
