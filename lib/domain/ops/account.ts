import { z } from "zod";
import { profileCardSchema } from "../profileCard";
import { MaxError } from "../errors";
import { rankBetween } from "../rank";
import { blocksToMarkdown, markdownToBlocks, parseContent } from "../blocks";
import type { PageRow, PropertyType, SelectOption, SettingsRow } from "../types";
import { confirm, defineOp, id, type OpContext } from "./define";
import {
  DEFAULT_SIDEBAR,
  normalizeSidebar,
  LIMITS,
  UPLOAD_TYPES,
  allPages,
  byRank,
  cleanTitle,
  defaultSettings,
  descendants,
  getSettingsRow,
  newPageRow,
  randomToken,
  rankAt,
  requirePage,
  sha256,
  summary,
  templateMembers,
  treeChildren,
  upsertSettings,
} from "./helpers";
import { insertDocument } from "./pages";
import { recordsCreate } from "./databases";
import { defaultView, shortId, TITLE_PROPERTY_ID } from "./databaseDefaults";

/* ── Settings ────────────────────────────────────────────────────────────── */

const settingsPatch = z.object({
  theme: z.enum(["system", "light", "dark"]).optional(),
  font: z.enum(["default", "serif", "mono"]).optional(),
  defaultFullWidth: z.boolean().optional(),
  density: z.enum(["comfortable", "compact"]).optional(),
  startPage: z.enum(["home", "last"]).optional(),
  textDirection: z.enum(["auto", "ltr", "rtl"]).optional(),
  spellcheck: z.boolean().optional(),
  showRecents: z.boolean().optional(),
  reduceMotion: z.enum(["system", "on"]).optional(),
  sidebarWidth: z.number().int().min(200).max(480).optional(),
  sidebarSections: z.array(z.enum(["favorites", "recents", "pages", "databases"])).optional(),
  collapsedSections: z.array(z.enum(["favorites", "recents", "pages", "databases"])).optional(),
  expandedPageIds: z.array(z.string()).max(2000).optional(),
  displayName: z.string().max(80).nullable().optional(),
  profileCard: profileCardSchema.nullable().optional(),
  profileCardOnboarded: z.boolean().optional(),
});

export const settingsGet = defineOp({
  name: "settings.get",
  kind: "query",
  title: "Get settings",
  description: "Returns your personal preferences (theme, font, page width, sidebar order and more).",
  input: z.object({}),
  async run(ctx) {
    const row = await getSettingsRow(ctx);
    const settings = row ?? ({ _id: "", ...defaultSettings(ctx.ownerId, ctx.now) } as SettingsRow);
    const card = profileCardSchema.safeParse(settings.profileCard);
    return {
      settings: { ...settings, ...(card.success ? { profileCard: { ...card.data, createdAt: settings.joinedAt ?? card.data.createdAt, name: settings.displayName?.trim() || card.data.name } } : {}), sidebarSections: normalizeSidebar(settings.sidebarSections), collapsedSections: (settings.collapsedSections ?? []).filter((s) => DEFAULT_SIDEBAR.includes(s)) },
      saved: !!row,
    };
  },
});

export const settingsUpdate = defineOp({
  name: "settings.update",
  kind: "mutation",
  title: "Update settings",
  description: "Changes one or more preferences. Workspace and card names stay synchronized; other fields change only when passed.",
  input: settingsPatch,
  async run(ctx, patch) {
    if (patch.sidebarSections) {
      const listed = patch.sidebarSections.filter((s) => DEFAULT_SIDEBAR.includes(s));
      if (new Set(listed).size !== listed.length || listed.length !== DEFAULT_SIDEBAR.length) {
        throw new MaxError("VALIDATION", "The sidebar order must list favorites, recents and pages once each.");
      }
      patch.sidebarSections = listed;
    }
    if (patch.collapsedSections) patch.collapsedSections = patch.collapsedSections.filter((s) => DEFAULT_SIDEBAR.includes(s));
    const existing = await getSettingsRow(ctx);
    const previousCard = profileCardSchema.safeParse(existing?.profileCard);
    if (patch.profileCard) {
      const explicitName = patch.displayName?.trim();
      if (explicitName && explicitName !== patch.profileCard.name) throw new MaxError("VALIDATION", "Your workspace and card use one name. Pass the same name for both.");
      patch.profileCard = { ...patch.profileCard, createdAt: existing?.joinedAt ?? ctx.now };
      patch.displayName = patch.profileCard.name;
    } else if (patch.displayName !== undefined && previousCard.success && patch.profileCard !== null) {
      const name = patch.displayName?.trim() || previousCard.data.name;
      patch.displayName = name;
      patch.profileCard = { ...previousCard.data, name };
    }
    const clean = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    const settings = await upsertSettings(ctx, clean);
    return { settings };
  },
});

export const settingsReset = defineOp({
  name: "settings.reset",
  kind: "mutation",
  title: "Reset settings",
  description: "Restores preferences to their defaults. `scope: sidebar` resets only the sidebar order and sections.",
  input: z.object({ scope: z.enum(["all", "sidebar"]).optional() }),
  async run(ctx, { scope = "all" }) {
    const defaults = defaultSettings(ctx.ownerId, ctx.now);
    const current = await getSettingsRow(ctx);
    const patch =
      scope === "sidebar"
        ? { sidebarSections: defaults.sidebarSections, collapsedSections: [], sidebarWidth: defaults.sidebarWidth }
        : { ...defaults, displayName: current?.displayName ?? null, onboarded: true, expandedPageIds: current?.expandedPageIds ?? [] };
    const settings = await upsertSettings(ctx, patch);
    return { settings };
  },
});

/* ── Account ─────────────────────────────────────────────────────────────── */

const WELCOME = `Max is a quiet place for your notes, documents and personal databases.

## The basics

- Type **/** for blocks: headings, to-dos, tables, callouts, code, math, diagrams and more.
- Type **@** to link another page.
- Drag the **⋮⋮** handle beside any block (or any page in the sidebar) to reorder it.
- Press **Ctrl/⌘ + K** to search everything.

> [!TIP]
> Open **Templates** in the sidebar to add a ready-made video tracker, task board, journal or reading list.

## Your data

Pages are private to your account. Export everything as Markdown or JSON from **Settings → Data**, and connect an assistant such as ChatGPT or Claude from **Settings → Connections**.

- [ ] Rename this page
- [ ] Create your first subpage
- [ ] Try a database`;

export const accountInit = defineOp({
  name: "account.init",
  kind: "mutation",
  title: "Set up workspace",
  description: "Prepares a new workspace on first sign-in (preferences and a welcome page). Safe to call again; does nothing once set up.",
  input: z.object({ displayName: z.string().max(80).nullable().optional() }),
  async run(ctx, { displayName }) {
    const existing = await getSettingsRow(ctx);
    if (existing?.onboarded) return { created: false };
    const pages = await allPages(ctx);
    let welcomeId: string | null = null;
    if (!pages.length) {
      const row = newPageRow(ctx, { title: "Welcome to Max", icon: "👋", rank: rankAt([], undefined) });
      welcomeId = await ctx.db.insert("pages", row);
      await insertDocument(ctx, welcomeId, markdownToBlocks(WELCOME));
    }
    await upsertSettings(ctx, { onboarded: true, ...(displayName && !existing?.displayName ? { displayName } : {}) });
    return { created: true, welcomeId };
  },
});

export const workspaceOverview = defineOp({
  name: "workspace.overview",
  kind: "query",
  title: "Workspace overview",
  description: "Counts, recently visited, recently edited, favorites and 14-day editing activity as a workspace summary.",
  input: z.object({}),
  async run(ctx) {
    const [pages, docs] = await Promise.all([allPages(ctx), ctx.db.list("documents", ctx.ownerId)]);
    const hidden = templateMembers(pages);
    const live = pages.filter((p) => !p.archivedAt && !hidden.has(p._id));
    const liveIds = new Set(live.map((p) => p._id));
    const words = docs.filter((d) => liveIds.has(d.pageId)).reduce((t, d) => t + (d.wordCount ?? 0), 0);
    const day = 86_400_000;
    const startOfToday = Math.floor(ctx.now / day) * day;
    const activity = Array.from({ length: 14 }, (_, i) => {
      const start = startOfToday - (13 - i) * day;
      return { date: new Date(start).toISOString().slice(0, 10), edited: live.filter((p) => p.updatedAt >= start && p.updatedAt < start + day).length };
    });
    return {
      counts: {
        pages: live.filter((p) => p.kind === "page" && !p.databaseId).length,
        databases: live.filter((p) => p.kind === "database").length,
        records: live.filter((p) => p.databaseId).length,
        words,
        trash: pages.filter((p) => p.archivedAt && p.archivedRootId === p._id).length,
        templates: pages.filter((p) => p.isTemplate && !p.archivedAt).length,
      },
      createdThisWeek: live.filter((p) => p.createdAt >= ctx.now - 7 * day).length,
      recentlyVisited: live.filter((p) => p.lastOpenedAt).sort((a, b) => b.lastOpenedAt! - a.lastOpenedAt!).slice(0, 8).map(summary),
      recentlyEdited: [...live].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map(summary),
      favorites: live.filter((p) => p.favoriteRank).sort((a, b) => (a.favoriteRank! < b.favoriteRank! ? -1 : 1)).slice(0, 8).map(summary),
      activity,
    };
  },
});

export const accountDeleteAllData = defineOp({
  name: "account.deleteAllData",
  kind: "mutation",
  title: "Delete all my data",
  destructive: true,
  uiOnly: true,
  description: "Permanently deletes every page, database, file, token, setting and log in this account. This cannot be undone.",
  input: z.object({ confirm }),
  async run(ctx) {
    let removed = 0;
    for (const table of ["documents", "versions", "comments", "pages", "settings", "tokens", "audit", "idempotency"] as const) {
      for (const row of await ctx.db.list(table, ctx.ownerId)) {
        await ctx.db.delete(table, row._id);
        removed++;
      }
    }
    for (const asset of await ctx.db.list("assets", ctx.ownerId)) {
      await ctx.storage?.remove(asset.storageId).catch(() => undefined);
      await ctx.db.delete("assets", asset._id);
      removed++;
    }
    return { removed };
  },
});

/* ── Access tokens for MCP clients ───────────────────────────────────────── */

export const tokensList = defineOp({
  name: "tokens.list",
  kind: "query",
  title: "List access tokens",
  uiOnly: true,
  description: "Personal access tokens for connecting assistants. The secret itself is never shown again.",
  input: z.object({}),
  async run(ctx) {
    const rows = await ctx.db.list("tokens", ctx.ownerId);
    return { tokens: rows.filter((t) => !t.revokedAt).sort((a, b) => b.createdAt - a.createdAt).map(({ hash: _hash, ...t }) => t) };
  },
});

export const tokensCreate = defineOp({
  name: "tokens.create",
  kind: "mutation",
  title: "Create access token",
  uiOnly: true,
  description: "Creates a personal access token. The secret is returned once.",
  input: z.object({ name: z.string().min(1).max(60) }),
  async run(ctx, { name }) {
    const live = (await ctx.db.list("tokens", ctx.ownerId)).filter((t) => !t.revokedAt);
    if (live.length >= LIMITS.tokens) throw new MaxError("LIMIT", `You can have up to ${LIMITS.tokens} tokens. Revoke one you no longer use.`);
    const secret = `max_${await randomToken(32)}`;
    const row = { ownerId: ctx.ownerId, name: name.trim(), hash: await sha256(secret), prefix: secret.slice(0, 8), createdAt: ctx.now, lastUsedAt: null, revokedAt: null };
    const tokenId = await ctx.db.insert("tokens", row);
    return { token: { _id: tokenId, name: row.name, prefix: row.prefix, createdAt: row.createdAt }, secret };
  },
});

export const tokensRevoke = defineOp({
  name: "tokens.revoke",
  kind: "mutation",
  title: "Revoke access token",
  uiOnly: true,
  description: "Revokes a token immediately. Assistants using it lose access.",
  input: z.object({ id }),
  async run(ctx, { id: tokenId }) {
    const row = await ctx.db.get("tokens", tokenId);
    if (!row || row.ownerId !== ctx.ownerId) throw new MaxError("NOT_FOUND", "That token doesn't exist.");
    await ctx.db.patch("tokens", tokenId, { revokedAt: ctx.now });
    return { revoked: true };
  },
});

export const auditList = defineOp({
  name: "audit.list",
  kind: "query",
  title: "Recent assistant activity",
  uiOnly: true,
  description: "Operations performed by connected assistants (names and outcomes only, never note content).",
  input: z.object({ limit: z.number().int().min(1).max(200).optional() }),
  async run(ctx, { limit = 50 }) {
    const rows = await ctx.db.list("audit", ctx.ownerId);
    return { events: rows.sort((a, b) => b.at - a.at).slice(0, limit) };
  },
});

/* ── Uploads ─────────────────────────────────────────────────────────────── */

export const assetsCreateUploadUrl = defineOp({
  name: "assets.createUploadUrl",
  kind: "mutation",
  title: "Start an upload",
  description: "Returns a short-lived URL. POST the file body to it (with its Content-Type), then call assets.register with the returned storageId.",
  input: z.object({}),
  async run(ctx) {
    if (!ctx.storage) throw new MaxError("INTERNAL", "File uploads aren't available right now.");
    return { uploadUrl: await ctx.storage.createUploadUrl() };
  },
});

export const assetsRegister = defineOp({
  name: "assets.register",
  kind: "mutation",
  title: "Attach an uploaded file",
  description: `Registers an uploaded file on a page: images, PDFs, office documents, text, archives, audio and video (${UPLOAD_TYPES.length} types), up to 50 MB. Returns a max-asset:// URL to use in image, file, audio or video blocks.`,
  input: z.object({
    storageId: z.string().min(1),
    pageId: id.nullable().optional(),
    name: z.string().max(255),
    type: z.string().max(100),
    size: z.number().int().min(1),
    alt: z.string().max(500).optional(),
  }),
  async run(ctx, input) {
    const remove = () => ctx.storage?.remove(input.storageId).catch(() => undefined);
    if (!UPLOAD_TYPES.includes(input.type.toLowerCase())) {
      await remove();
      throw new MaxError("VALIDATION", `"${input.name}" isn't a supported file type. Max stores images, PDFs, office documents, text, ZIP archives, audio and video.`);
    }
    if (input.size > LIMITS.uploadBytes) {
      await remove();
      throw new MaxError("LIMIT", `"${input.name}" is larger than 50 MB. Compress it or split it, then upload again.`);
    }
    if (input.pageId) await requirePage(ctx, input.pageId);
    const assetId = await ctx.db.insert("assets", {
      ownerId: ctx.ownerId,
      pageId: input.pageId ?? null,
      storageId: input.storageId,
      name: input.name,
      type: input.type,
      size: input.size,
      alt: input.alt ?? "",
      createdAt: ctx.now,
    });
    return { id: assetId, url: `max-asset://${assetId}` };
  },
});

export const assetsGetUrl = defineOp({
  name: "assets.getUrl",
  kind: "query",
  title: "Get file URL",
  description: "Resolves a max-asset:// id to a URL the owner can load.",
  input: z.object({ id }),
  async run(ctx, { id: assetId }) {
    const asset = await ctx.db.get("assets", assetId);
    if (!asset || asset.ownerId !== ctx.ownerId) throw new MaxError("NOT_FOUND", "That file doesn't exist or was deleted.");
    const url = await ctx.storage?.getUrl(asset.storageId);
    if (!url) throw new MaxError("NOT_FOUND", "That file is no longer stored.");
    return { url, name: asset.name, type: asset.type, size: asset.size, alt: asset.alt };
  },
});

export const assetsList = defineOp({
  name: "assets.list",
  kind: "query",
  title: "List files",
  description: "Uploaded files, optionally for one page, with total storage used.",
  input: z.object({ pageId: id.optional() }),
  async run(ctx, { pageId }) {
    const rows = pageId ? await ctx.db.list("assets", ctx.ownerId, { field: "pageId", value: pageId }) : await ctx.db.list("assets", ctx.ownerId);
    return { assets: rows.sort((a, b) => b.createdAt - a.createdAt), totalBytes: rows.reduce((t, a) => t + a.size, 0) };
  },
});

export const assetsRemove = defineOp({
  name: "assets.remove",
  kind: "mutation",
  title: "Delete file",
  destructive: true,
  description: "Permanently deletes an uploaded file. Image blocks that use it will show as missing.",
  input: z.object({ id, confirm }),
  async run(ctx, { id: assetId }) {
    const asset = await ctx.db.get("assets", assetId);
    if (!asset || asset.ownerId !== ctx.ownerId) throw new MaxError("NOT_FOUND", "That file doesn't exist.");
    await ctx.storage?.remove(asset.storageId).catch(() => undefined);
    await ctx.db.delete("assets", assetId);
    return { deleted: true };
  },
});

/* ── Export & import ─────────────────────────────────────────────────────── */

type AnyInline = { type: string; href?: string; content?: AnyInline[]; text?: string; props?: Record<string, unknown> };
type AnyBlock = { type: string; props: Record<string, unknown>; content?: unknown; children: AnyBlock[]; id: string };

/**
 * Turns links between imported pages into what Notion showed: a link alone on its line becomes a
 * page block, a link inside text becomes an @-mention. Links to pages not imported yet are kept.
 */
export function relinkImported(blocks: AnyBlock[], resolve: (key: string) => string | undefined): AnyBlock[] {
  const textOf = (items: AnyInline[] = []): string => items.map((i) => i.text ?? textOf(i.content)).join("");
  const inline = (items: AnyInline[]): AnyInline[] =>
    items.map((item) => {
      if (item.type !== "link" || !item.href?.startsWith("max-import://")) return item;
      let key = item.href.slice("max-import://".length);
      try {
        key = decodeURIComponent(key);
      } catch {}
      const target = resolve(key);
      return target ? { type: "pageMention", props: { pageId: target, title: textOf(item.content) } } : item;
    });
  const visit = (list: AnyBlock[]): AnyBlock[] =>
    list.map((b) => {
      const next = { ...b, children: visit(b.children ?? []) };
      if (Array.isArray(b.content)) {
        const content = inline(b.content as AnyInline[]);
        const meaningful = content.filter((c) => !(c.type === "text" && !c.text?.trim()));
        if (b.type === "paragraph" && !next.children.length && meaningful.length === 1 && meaningful[0].type === "pageMention") {
          return { id: b.id, type: "pageLink", props: { pageId: meaningful[0].props!.pageId }, children: [] } as AnyBlock;
        }
        next.content = content;
      } else if (b.content && typeof b.content === "object" && (b.content as { type?: string }).type === "tableContent") {
        const t = b.content as { rows: { cells: unknown[] }[] };
        next.content = { ...t, rows: t.rows.map((r) => ({ ...r, cells: r.cells.map((c) => (Array.isArray(c) ? inline(c as AnyInline[]) : { ...(c as object), content: inline(((c as { content?: AnyInline[] }).content ?? []) as AnyInline[]) })) })) };
      }
      return next;
    });
  return visit(blocks);
}

function safeFileName(title: string) {
  return (title || "Untitled").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim().slice(0, 80) || "Untitled";
}

export const exportPage = defineOp({
  name: "export.page",
  kind: "query",
  title: "Export page",
  description: "Exports one page as Markdown or Max JSON (database pages include their rows as a Markdown table).",
  input: z.object({ id, format: z.enum(["markdown", "json"]).optional() }),
  async run(ctx, { id: pageId, format = "markdown" }) {
    const page = await requirePage(ctx, pageId, { allowArchived: true });
    const pages = await allPages(ctx);
    const titles = new Map(pages.map((p) => [p._id, p.title || "Untitled"]));
    const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
    const blocks = parseContent(doc?.content ?? "[]");
    if (format === "json") {
      return { filename: `${safeFileName(page.title)}.json`, mimeType: "application/json", content: JSON.stringify({ format: "max-page", version: 1, page, blocks }, null, 2) };
    }
    let md = `# ${page.icon && !/^(lucide:|max-asset:|https:)/.test(page.icon) ? page.icon + " " : ""}${page.title || "Untitled"}\n\n`;
    if (page.kind === "database") md += databaseMarkdown(page, pages) + "\n";
    if (page.databaseId) {
      const db = pages.find((p) => p._id === page.databaseId);
      for (const prop of db?.properties ?? []) {
        if (prop.type === "title") continue;
        const v = page.values?.[prop.id];
        if (v === undefined || v === null || v === "") continue;
        md += `- **${prop.name}:** ${formatValue(prop.options, v)}\n`;
      }
      md += "\n";
    }
    md += blocksToMarkdown(blocks, (pid) => titles.get(pid));
    return { filename: `${safeFileName(page.title)}.md`, mimeType: "text/markdown", content: md };
  },
});

function formatValue(options: SelectOption[] | undefined, v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => options?.find((o) => o.id === x)?.name ?? x).join(", ");
  return options?.find((o) => o.id === v)?.name ?? String(v);
}

function databaseMarkdown(db: PageRow, pages: PageRow[]): string {
  const props = db.properties ?? [];
  const rows = pages.filter((p) => p.databaseId === db._id && !p.archivedAt && !p.isTemplate && !p.parentId).sort(byRank);
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  const head = `| ${props.map((p) => esc(p.name)).join(" | ")} |\n| ${props.map(() => "---").join(" | ")} |`;
  const body = rows.map((r) => `| ${props.map((p) => esc(p.type === "title" ? r.title : r.values?.[p.id] == null ? "" : formatValue(p.options, r.values[p.id]))).join(" | ")} |`);
  return [head, ...body].join("\n");
}

export const exportAll = defineOp({
  name: "export.all",
  kind: "query",
  title: "Export everything",
  description:
    "Exports all your pages. format=json returns one Max backup (re-importable with import.maxExport). format=markdown returns a list of files with folder paths.",
  input: z.object({ format: z.enum(["json", "markdown"]).optional(), includeTrash: z.boolean().optional() }),
  async run(ctx, { format = "json", includeTrash = false }) {
    const [pages, docs, settings] = await Promise.all([allPages(ctx), ctx.db.list("documents", ctx.ownerId), getSettingsRow(ctx)]);
    const kept = pages.filter((p) => includeTrash || !p.archivedAt);
    const docByPage = new Map(docs.map((d) => [d.pageId, d]));
    if (format === "json") {
      return {
        filename: `max-export-${new Date(ctx.now).toISOString().slice(0, 10)}.json`,
        content: JSON.stringify(
          {
            format: "max-export",
            version: 1,
            exportedAt: new Date(ctx.now).toISOString(),
            settings,
            pages: kept.map((p) => ({ ...p, blocks: parseContent(docByPage.get(p._id)?.content ?? "[]") })),
          },
          null,
          1,
        ),
      };
    }
    const titles = new Map(pages.map((p) => [p._id, p.title || "Untitled"]));
    const byId = new Map(kept.map((p) => [p._id, p]));
    const pathOf = (p: PageRow): string => {
      const parentKey = p.parentId ?? p.databaseId;
      const parent = parentKey ? byId.get(parentKey) : undefined;
      const own = `${safeFileName(p.title)} ${p._id.slice(-6)}`;
      return parent ? `${pathOf(parent)}/${own}` : own;
    };
    const files = kept.map((p) => {
      let md = `# ${p.title || "Untitled"}\n\n`;
      if (p.kind === "database") md += databaseMarkdown(p, pages) + "\n\n";
      md += blocksToMarkdown(parseContent(docByPage.get(p._id)?.content ?? "[]"), (pid) => titles.get(pid));
      return { path: `${pathOf(p)}.md`, content: md };
    });
    return { files };
  },
});

export const importMarkdown = defineOp({
  name: "import.markdown",
  kind: "mutation",
  title: "Import Markdown",
  description: "Creates a page from Markdown. The first '# Heading' becomes the title unless a title is given.",
  input: z.object({ markdown: z.string().max(400_000), title: z.string().max(500).optional(), parentId: id.nullable().optional() }),
  async run(ctx, { markdown, title, parentId = null }) {
    if (parentId) await requirePage(ctx, parentId);
    let body = markdown;
    let pageTitle = title;
    const h1 = /^#\s+(.+)\n?/.exec(markdown.trimStart());
    if (!pageTitle && h1) {
      pageTitle = h1[1].trim();
      body = markdown.trimStart().slice(h1[0].length);
    }
    const pages = await allPages(ctx);
    const row = newPageRow(ctx, { parentId, title: cleanTitle(pageTitle ?? "Imported page"), rank: rankAt(treeChildren(pages, parentId), undefined) });
    const pageId = await ctx.db.insert("pages", row);
    await insertDocument(ctx, pageId, markdownToBlocks(body));
    return { id: pageId };
  },
});

const bundleItem = z.object({
  key: z.string().max(400),
  parentKey: z.string().max(400).nullable(),
  title: z.string().max(500),
  icon: z.string().max(64).nullable().optional(),
  markdown: z.string().max(400_000).optional(),
  database: z
    .object({
      properties: z.array(z.object({ name: z.string().max(100), type: z.string(), options: z.array(z.string().max(100)).optional() })).max(60),
      rows: z.array(z.object({ key: z.string().max(400).optional(), title: z.string().max(500), values: z.record(z.string(), z.unknown()), markdown: z.string().max(400_000).optional() })).max(5000),
    })
    .optional(),
});

export const importBundle = defineOp({
  name: "import.bundle",
  kind: "mutation",
  title: "Import pages and databases",
  description:
    "Imports a tree of pages and databases at once (used for Notion exports). Items reference parents by key; database rows can be parents too. Property types: text, number, select, multi_select, status, checkbox, date, url, email, phone.",
  input: z.object({
    items: z.array(bundleItem).min(1).max(5000),
    parentId: id.nullable().optional(),
    asTemplates: z.boolean().optional().describe("Import the top-level pages as templates (they appear under Templates instead of the sidebar)."),
    existing: z.record(z.string(), z.string()).optional().describe("Keys already imported in earlier chunks, mapped to their page ids."),
  }),
  async run(ctx, { items, parentId = null, existing = {}, asTemplates = false }) {
    if (parentId) await requirePage(ctx, parentId);
    const pages = await allPages(ctx);
    if (pages.length + items.length > LIMITS.pagesPerAccount) throw new MaxError("LIMIT", "This import would go past your page limit.");
    const ids = new Map<string, string>();
    for (const [key, pid] of Object.entries(existing)) {
      await requirePage(ctx, pid);
      ids.set(key, pid);
    }
    const createdIds = new Set<string>();
    let created = 0;
    const counters = new Map<string, number>();
    const nextRank = (key: string) => {
      const n = (counters.get(key) ?? 0) + 1;
      counters.set(key, n);
      return n;
    };
    const rootSiblings = treeChildren(pages, parentId);
    let rootRank = rootSiblings.at(-1)?.rank ?? null;

    for (const item of items) {
      const parent = item.parentKey ? ids.get(item.parentKey) : parentId;
      if (item.parentKey && !parent) throw new MaxError("VALIDATION", `Item "${item.title}" refers to a parent that comes later or doesn't exist.`);
      let rank: string;
      if (!item.parentKey) rank = rootRank = rankBetween(rootRank, null);
      else rank = String(nextRank(parent!)).padStart(6, "0") + "V";
      const props = item.database
        ? [
            { id: TITLE_PROPERTY_ID, name: "Name", type: "title" as PropertyType },
            ...item.database.properties
              .filter((p) => p.type !== "title")
              .map((p) => ({
                id: shortId(),
                name: p.name,
                type: (["text", "number", "select", "multi_select", "status", "checkbox", "date", "url", "email", "phone"].includes(p.type) ? p.type : "text") as PropertyType,
                ...(p.options ? { options: p.options.map((name, i): SelectOption => ({ id: shortId(), name, color: (["gray", "blue", "green", "yellow", "orange", "purple", "pink", "red", "brown"] as const)[i % 9] })) } : {}),
              })),
          ]
        : undefined;
      const row = newPageRow(ctx, {
        kind: item.database ? "database" : "page",
        parentId: asTemplates && !item.parentKey ? null : (parent ?? null),
        isTemplate: asTemplates && !item.parentKey,
        title: cleanTitle(item.title),
        icon: item.icon ?? null,
        rank,
        fullWidth: !!item.database,
        ...(props ? { properties: props, views: [defaultView(props)] } : {}),
      });
      const pageId = await ctx.db.insert("pages", row);
      ids.set(item.key, pageId);
      createdIds.add(pageId);
      created++;
      await insertDocument(ctx, pageId, markdownToBlocks(item.markdown ?? ""));
      for (const r of item.database?.rows ?? []) {
        const values: Record<string, unknown> = { Name: r.title };
        for (const [k, v] of Object.entries(r.values)) if (k.toLowerCase() !== "name" && v !== "" && v !== null) values[k] = v;
        let rec;
        try {
          rec = await recordsCreate.run(ctx, { databaseId: pageId, values, markdown: r.markdown });
        } catch {
          // A value that doesn't fit its column type is kept as the row title only, never dropped silently.
          rec = await recordsCreate.run(ctx, { databaseId: pageId, values: { Name: r.title }, markdown: [r.markdown ?? "", "", "> [!WARNING]", `> Some values couldn't be imported: ${JSON.stringify(r.values).slice(0, 500)}`].join("\n") });
        }
        if (r.key) ids.set(r.key, rec.record._id);
        createdIds.add(rec.record._id);
        created++;
      }
    }
    // Links between imported pages ("max-import://<key>") now point at the new pages.
    for (const pageId of new Set(ids.values())) {
      // Earlier chunks may link to pages created in this one.
      const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: pageId }))[0];
      if (!doc || !doc.content.includes("max-import://")) continue;
      const content = JSON.stringify(relinkImported(parseContent(doc.content), (key) => ids.get(key)));
      if (content !== doc.content) await ctx.db.patch("documents", doc._id, { content });
    }
    return { created, rootIds: items.filter((i) => !i.parentKey).map((i) => ids.get(i.key)), keys: Object.fromEntries([...ids].filter(([, v]) => createdIds.has(v))) };
  },
});

export const importMaxExport = defineOp({
  name: "import.maxExport",
  kind: "mutation",
  title: "Restore a Max export",
  description: "Imports a Max JSON export as new pages (new ids; links between imported pages are updated). Existing pages are not changed.",
  input: z.object({ data: z.string().max(50_000_000) }),
  async run(ctx, { data }) {
    let parsed: { format?: string; pages?: (PageRow & { blocks: unknown[] })[] };
    try {
      parsed = JSON.parse(data);
    } catch {
      throw new MaxError("VALIDATION", "That file isn't valid JSON. Choose a file exported from Max (Settings → Data → Export).");
    }
    if (parsed.format !== "max-export" || !Array.isArray(parsed.pages)) throw new MaxError("VALIDATION", "That file isn't a Max export.");
    const existing = await allPages(ctx);
    if (existing.length + parsed.pages.length > LIMITS.pagesPerAccount) throw new MaxError("LIMIT", "This import would go past your page limit.");
    const map = new Map<string, string>();
    const incoming = parsed.pages.filter((p) => !p.archivedAt);
    // Insert parents first.
    const depth = (p: PageRow, seen = 0): number => {
      const parent = incoming.find((x) => x._id === (p.parentId ?? p.databaseId));
      return parent && seen < 100 ? 1 + depth(parent, seen + 1) : 0;
    };
    const ordered = [...incoming].sort((a, b) => depth(a) - depth(b));
    for (const p of ordered) {
      const { _id, blocks: _b, ownerId: _o, ...rest } = p;
      const row = newPageRow(ctx, { ...rest, rank: rest.rank || "V", parentId: null, databaseId: null, favoriteRank: null, lastOpenedAt: null, archivedAt: null, archivedRootId: null });
      map.set(_id, await ctx.db.insert("pages", row));
    }
    for (const p of ordered) {
      const nid = map.get(p._id)!;
      const remap = (s: string) => s.replace(/[A-Za-z0-9_-]{8,64}/g, (m) => map.get(m) ?? m);
      await ctx.db.patch("pages", nid, {
        parentId: p.parentId ? (map.get(p.parentId) ?? null) : null,
        databaseId: p.databaseId ? (map.get(p.databaseId) ?? null) : null,
        values: p.values ? JSON.parse(remap(JSON.stringify(p.values))) : p.values,
      });
      await insertDocument(ctx, nid, JSON.parse(remap(JSON.stringify(p.blocks ?? []))));
    }
    return { imported: map.size };
  },
});

export { descendants };
export type { OpContext };
