import { z } from "zod";
import { MaxError, notFound } from "../errors";
import type { PageRow, ShareLevel } from "../types";
import { defineOp, id } from "./define";
import { requirePage } from "./helpers";

const level = z.enum(["view", "comment", "edit", "full_access"]);
const linkLevel = z.enum(["view", "comment", "edit"]);
const person = z.string().trim().min(1).max(256);

/** The page and its ancestors, nearest first, within the owner's pages. */
async function lineage(ctx: Parameters<typeof requirePage>[0], page: PageRow) {
  const out = [page];
  let cur: PageRow | null = page;
  for (let guard = 0; cur && guard < 60; guard++) {
    const up: string | null = cur.parentId ?? cur.databaseId;
    if (!up) break;
    const next: PageRow | null = await ctx.db.get("pages", up);
    if (!next || next.ownerId !== ctx.ownerId) break;
    out.push(next);
    cur = next;
  }
  return out;
}

function newToken() {
  const bytes = new Uint8Array(18);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const sharesList = defineOp({
  name: "shares.list",
  kind: "query",
  title: "List who a page is shared with",
  description: "People with access to a page: shared directly, or through a page above it, plus the link setting.",
  input: z.object({ pageId: id }),
  async run(ctx, { pageId }) {
    const page = await requirePage(ctx, pageId);
    const pages = await lineage(ctx, page);
    const direct = (await ctx.db.list("shares", ctx.ownerId, { field: "pageId", value: pageId })).sort((a, b) => a.createdAt - b.createdAt);
    const inherited: (typeof direct[number] & { fromTitle: string })[] = [];
    for (const ancestor of pages.slice(1)) {
      for (const s of await ctx.db.list("shares", ctx.ownerId, { field: "pageId", value: ancestor._id })) {
        if (!direct.some((d) => d.granteeId === s.granteeId) && !inherited.some((i) => i.granteeId === s.granteeId)) inherited.push({ ...s, fromTitle: ancestor.title });
      }
    }
    let link: { token: string; level: ShareLevel; public: boolean; pageId: string; fromTitle: string | null; expiresAt: number | null } | null = null;
    for (const [i, p] of pages.entries()) {
      const row = (await ctx.db.list("shareLinks", ctx.ownerId, { field: "pageId", value: p._id }))[0];
      if (row) {
        link = { token: row.token, level: row.level, public: !!row.public, pageId: p._id, fromTitle: i === 0 ? null : p.title, expiresAt: row.expiresAt ?? null };
        break;
      }
    }
    return { ownerId: ctx.ownerId, direct, inherited, link };
  },
});

export const sharesInvite = defineOp({
  name: "shares.invite",
  kind: "mutation",
  title: "Share a page with someone",
  description: "Gives one person (by Max account id, as shares.list shows) access to a page and everything inside it. Inviting someone again changes their level. To invite by email, use shares_inviteByEmail.",
  input: z.object({ pageId: id, granteeId: person, email: z.string().trim().max(320).nullish(), name: z.string().trim().max(200).nullish(), image: z.string().url().max(2048).nullish(), level }),
  async run(ctx, { pageId, granteeId, email, name, image, level: lvl }) {
    const page = await requirePage(ctx, pageId);
    if (page.isTemplate) throw new MaxError("VALIDATION", "Templates can't be shared. Share a page made from the template instead.");
    if (granteeId === ctx.ownerId) throw new MaxError("VALIDATION", "This page is already yours.");
    const existing = (await ctx.db.list("shares", ctx.ownerId, { field: "pageId", value: pageId })).find((s) => s.granteeId === granteeId);
    if (existing) {
      await ctx.db.patch("shares", existing._id, { level: lvl, email: email ?? existing.email, name: name ?? existing.name, image: image ?? existing.image });
      return { share: { ...existing, level: lvl }, created: false };
    }
    const row = { ownerId: ctx.ownerId, pageId, granteeId, email: email ?? null, name: name ?? null, image: image ?? null, level: lvl, invitedBy: ctx.actor?.id ?? ctx.ownerId, createdAt: ctx.now };
    const _id = await ctx.db.insert("shares", row);
    return { share: { ...row, _id }, created: true };
  },
});

export const sharesUpdate = defineOp({
  name: "shares.update",
  kind: "mutation",
  title: "Change someone's access",
  description: "Changes the access level of one share.",
  input: z.object({ id, level }),
  async run(ctx, { id: shareId, level: lvl }) {
    const share = await ctx.db.get("shares", shareId);
    if (!share || share.ownerId !== ctx.ownerId) throw notFound("share");
    await ctx.db.patch("shares", shareId, { level: lvl });
    return { ok: true };
  },
});

export const sharesRemove = defineOp({
  name: "shares.remove",
  kind: "mutation",
  title: "Remove someone's access",
  description: "Stops sharing a page with one person. Their comments stay.",
  input: z.object({ id }),
  async run(ctx, { id: shareId }) {
    const share = await ctx.db.get("shares", shareId);
    if (!share || share.ownerId !== ctx.ownerId) throw notFound("share");
    await ctx.db.delete("shares", shareId);
    return { ok: true };
  },
});

export const sharesSetLink = defineOp({
  name: "shares.setLink",
  kind: "mutation",
  title: "Set link access",
  description:
    "Sets who can open a page with its link: anyone signed in to Max (view, comment or edit), or, with web: true, anyone on the web without an account (view only, published). Level null turns link access off.",
  input: z.object({ pageId: id, level: linkLevel.nullable(), web: z.boolean().optional(), expiresInDays: z.number().int().min(1).max(365).nullable().optional().describe("The link stops working after this many days (null: never). Omit to keep the current expiry.") }),
  async run(ctx, { pageId, level: lvl, web = false, expiresInDays }) {
    const page = await requirePage(ctx, pageId);
    if (web && page.isTemplate) throw new MaxError("VALIDATION", "Templates can't be published.");
    const row = (await ctx.db.list("shareLinks", ctx.ownerId, { field: "pageId", value: pageId }))[0];
    if (lvl === null) {
      if (row) await ctx.db.delete("shareLinks", row._id);
      return { link: null };
    }
    // Publishing to the web is view-only: visitors have no account to comment or edit as.
    const level = web ? "view" : lvl;
    const expiresAt = expiresInDays === undefined ? (row?.expiresAt ?? null) : expiresInDays === null ? null : ctx.now + expiresInDays * 86_400_000;
    if (row) {
      await ctx.db.patch("shareLinks", row._id, { level, public: web, expiresAt });
      return { link: { token: row.token, level, public: web, expiresAt } };
    }
    const token = newToken();
    await ctx.db.insert("shareLinks", { ownerId: ctx.ownerId, pageId, token, level, public: web, expiresAt, createdAt: ctx.now });
    return { link: { token, level, public: web, expiresAt } };
  },
});

export const sharesOverview = defineOp({
  name: "shares.overview",
  kind: "query",
  title: "List everything I share",
  description: "Every page you share: who has access to it, and whether its link is open to people in Max or published to the web.",
  input: z.object({}),
  async run(ctx) {
    const shares = await ctx.db.list("shares", ctx.ownerId);
    const links = await ctx.db.list("shareLinks", ctx.ownerId);
    const ids = [...new Set([...shares.map((s) => s.pageId), ...links.map((l) => l.pageId)])];
    const pages: { _id: string; title: string; icon: string | null; kind: string; people: { name: string | null; email: string | null; image: string | null; level: ShareLevel }[]; link: { level: ShareLevel; public: boolean; token: string } | null }[] = [];
    for (const id of ids) {
      const page = await ctx.db.get("pages", id);
      if (!page || page.ownerId !== ctx.ownerId || page.archivedAt) continue;
      const link = links.find((l) => l.pageId === id);
      pages.push({
        _id: page._id,
        title: page.title,
        icon: page.icon,
        kind: page.kind,
        people: shares.filter((s) => s.pageId === id).map((s) => ({ name: s.name, email: s.email, image: s.image, level: s.level })),
        link: link ? { level: link.level, public: !!link.public, token: link.token } : null,
      });
    }
    return { pages: pages.sort((a, b) => (a.title || "").localeCompare(b.title || "")) };
  },
});
