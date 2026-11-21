import { z } from "zod";
import { MaxError, notFound } from "../errors";
import { normalizeBlocks, parseContent } from "../blocks";
import { notify } from "../notifications";
import type { ApprovalRow } from "../types";
import { defineOp, id, type OpContext } from "./define";
import { actorOf, requirePage } from "./helpers";
import { people } from "./people";
import { writeContent } from "./documents";

/**
 * Reviews and approvals, without AI:
 *  - a review request asks chosen people to approve a page (every reviewer must approve; the
 *    person who asked can't approve their own request, a separation-of-duty rule);
 *  - a suggested edit carries proposed content made in the real editor; accepting it writes that
 *    content as a new revision (so it's in version history and can be undone).
 * Every decision is appended to the request's history; nothing in it is ever rewritten.
 */

const MAX_REVIEWERS = 10;

function me(ctx: OpContext) {
  const id = actorOf(ctx);
  if (!id) throw new MaxError("FORBIDDEN", "Sign in to request or give reviews.");
  return { id, name: ctx.actor?.name ?? null };
}

async function reviewersFor(ctx: OpContext, requested: string[], requester: string) {
  const allowed = new Set((await people(ctx)).map((p) => p.id));
  const reviewers = [...new Set(requested)].filter((r) => allowed.has(r) && r !== requester).slice(0, MAX_REVIEWERS);
  return reviewers;
}

async function requireApproval(ctx: OpContext, approvalId: string): Promise<ApprovalRow> {
  const a = await ctx.db.get("approvals", approvalId);
  if (!a || a.ownerId !== ctx.ownerId) throw notFound("review");
  return a;
}

export const approvalsList = defineOp({
  name: "approvals.list",
  kind: "query",
  title: "List reviews",
  description: "Review requests and suggested edits: on one page (pageId), or waiting for you to review (mine: true). Includes the full decision history.",
  input: z.object({ pageId: id.optional(), mine: z.boolean().optional(), includeClosed: z.boolean().optional() }),
  async run(ctx, { pageId, mine, includeClosed }) {
    const me = actorOf(ctx);
    const rows = pageId ? await ctx.db.list("approvals", ctx.ownerId, { field: "pageId", value: pageId }) : await ctx.db.list("approvals", ctx.ownerId);
    const out = [];
    for (const a of rows.sort((x, y) => y.createdAt - x.createdAt)) {
      if (!includeClosed && a.status !== "pending") continue;
      if (mine && !(me && a.reviewers.includes(me) && !a.decisions.some((d) => d.by === me && d.decision === "approved"))) continue;
      const page = await ctx.db.get("pages", a.pageId);
      if (!page) continue;
      out.push({ ...a, ownerId: undefined, proposal: undefined, hasProposal: !!a.proposal, pageTitle: page.title || "Untitled" });
      if (out.length >= 100) break;
    }
    return { approvals: out };
  },
});

export const approvalsGet = defineOp({
  name: "approvals.get",
  kind: "query",
  title: "Get a review",
  description: "One review request or suggested edit, with the proposed blocks and the page's current blocks so the two can be compared.",
  input: z.object({ id }),
  async run(ctx, { id: approvalId }) {
    const a = await requireApproval(ctx, approvalId);
    await requirePage(ctx, a.pageId, { allowArchived: true });
    const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: a.pageId }))[0];
    return { approval: { ...a, ownerId: undefined }, current: parseContent(doc?.content ?? "[]"), currentRevision: doc?.revision ?? 0, proposed: a.proposal ? parseContent(a.proposal) : null };
  },
});

export const approvalsRequest = defineOp({
  name: "approvals.request",
  kind: "mutation",
  title: "Request a review",
  description: "Asks people (ids from people.list) to review and approve a page. Every reviewer must approve. They're notified.",
  input: z.object({ pageId: id, reviewers: z.array(z.string().max(256)).min(1).max(MAX_REVIEWERS), message: z.string().max(1000).optional() }),
  async run(ctx, { pageId, reviewers, message = "" }) {
    const page = await requirePage(ctx, pageId);
    const who = me(ctx);
    const list = await reviewersFor(ctx, reviewers, who.id);
    if (!list.length) throw new MaxError("VALIDATION", "Pick at least one reviewer other than yourself.");
    const row = { ownerId: ctx.ownerId, pageId, kind: "review" as const, requestedBy: who.id, requestedByName: who.name, reviewers: list, message: message.trim(), status: "pending" as const, decisions: [], proposal: null, baseRevision: null, createdAt: ctx.now, updatedAt: ctx.now };
    const approvalId = await ctx.db.insert("approvals", row);
    await notify(ctx.db, list, { kind: "approval", ownerId: ctx.ownerId, pageId, actor: who, title: `${who.name ?? "Someone"} asked you to review “${page.title || "Untitled"}”`, body: message || null }, ctx.now);
    return { approval: { _id: approvalId, ...row } };
  },
});

export const approvalsSuggest = defineOp({
  name: "approvals.suggest",
  kind: "mutation",
  title: "Suggest edits",
  description: "Proposes new content for a page (blocks, made from the page's current blocks) for review instead of changing it directly. Reviewers can accept it (it becomes the page's content, in version history) or decline.",
  input: z.object({ pageId: id, blocks: z.array(z.record(z.string(), z.unknown())).max(20_000), baseRevision: z.number().int().min(0), reviewers: z.array(z.string().max(256)).max(MAX_REVIEWERS).optional(), message: z.string().max(1000).optional() }),
  async run(ctx, { pageId, blocks, baseRevision, reviewers = [], message = "" }) {
    const page = await requirePage(ctx, pageId);
    const who = me(ctx);
    const proposal = JSON.stringify(normalizeBlocks(blocks));
    if (proposal.length > 900_000) throw new MaxError("LIMIT", "That suggestion is too large.");
    let list = await reviewersFor(ctx, reviewers, who.id);
    // Nobody picked: whoever last edited the page, else its creator, reviews it.
    if (!list.length) list = [page.updatedBy, page.createdBy].filter((x): x is string => !!x && x !== who.id).slice(0, 1);
    const row = { ownerId: ctx.ownerId, pageId, kind: "suggestion" as const, requestedBy: who.id, requestedByName: who.name, reviewers: list, message: message.trim(), status: "pending" as const, decisions: [], proposal, baseRevision, createdAt: ctx.now, updatedAt: ctx.now };
    const approvalId = await ctx.db.insert("approvals", row);
    await notify(ctx.db, list, { kind: "approval", ownerId: ctx.ownerId, pageId, actor: who, title: `${who.name ?? "Someone"} suggested edits to “${page.title || "Untitled"}”`, body: message || null }, ctx.now);
    return { approval: { _id: approvalId, ...row, proposal: undefined } };
  },
});

export const approvalsDecide = defineOp({
  name: "approvals.decide",
  kind: "mutation",
  title: "Approve or request changes",
  description: "A reviewer approves, or requests changes with a note. A review is approved once every reviewer approves. Accepting a suggested edit writes its content to the page. The requester can cancel with decision: cancelled.",
  input: z.object({ id, decision: z.enum(["approved", "changes_requested", "cancelled"]), note: z.string().max(1000).optional(), force: z.boolean().optional().describe("Accept a suggestion even though the page changed since it was made.") }),
  async run(ctx, { id: approvalId, decision, note = "", force }) {
    const a = await requireApproval(ctx, approvalId);
    const who = me(ctx);
    if (a.status !== "pending") throw new MaxError("CONFLICT", "That review is already closed.");
    if (decision === "cancelled") {
      if (a.requestedBy !== who.id) throw new MaxError("FORBIDDEN", "Only the person who asked can cancel it.");
    } else {
      if (!a.reviewers.includes(who.id)) throw new MaxError("FORBIDDEN", "Only the chosen reviewers can decide.");
      if (a.requestedBy === who.id) throw new MaxError("FORBIDDEN", "You can't approve your own request.");
    }
    const decisions = [...a.decisions, { by: who.id, byName: who.name, decision, note: note.trim(), at: ctx.now }];
    const approvedBy = new Set(decisions.filter((d) => d.decision === "approved").map((d) => d.by));
    const status: ApprovalRow["status"] =
      decision === "cancelled" ? "cancelled" : decision === "changes_requested" ? "changes_requested" : a.kind === "suggestion" || a.reviewers.every((r) => approvedBy.has(r)) ? "approved" : "pending";
    if (a.kind === "suggestion" && status === "approved") {
      const doc = (await ctx.db.list("documents", ctx.ownerId, { field: "pageId", value: a.pageId }))[0];
      if (!force && (doc?.revision ?? 0) !== a.baseRevision) throw new MaxError("CONFLICT", "The page changed since this suggestion was made. Compare again, then accept anyway if it still fits.", { currentRevision: doc?.revision ?? 0 });
      await writeContent(ctx, a.pageId, parseContent(a.proposal ?? "[]") as never);
    }
    await ctx.db.patch("approvals", a._id, { decisions, status, updatedAt: ctx.now });
    const page = await ctx.db.get("pages", a.pageId);
    if (decision !== "cancelled") {
      const what = status === "approved" ? (a.kind === "suggestion" ? "accepted your suggested edits to" : "approved") : decision === "approved" ? "approved (others still reviewing)" : "requested changes on";
      await notify(ctx.db, [a.requestedBy], { kind: "approval", ownerId: ctx.ownerId, pageId: a.pageId, actor: who, title: `${who.name ?? "Someone"} ${what} “${page?.title || "Untitled"}”`, body: note || null }, ctx.now);
    }
    return { status };
  },
});
