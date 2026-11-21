import { z } from "zod";
import { MaxError } from "../errors";
import { isOrgNamespace, type OrgActor } from "../organizations";
import { lockedPages, pageAccess, setPageAccess } from "../orgPageAccess";
import { notify } from "../notifications";
import { defineOp, id, type OpContext } from "./define";

/** Organization-only operations act as the signed-in member, never as the namespace. */
function member(ctx: OpContext): OrgActor {
  if (!isOrgNamespace(ctx.ownerId) || !ctx.actor?.id) throw new MaxError("VALIDATION", "That's only available inside an organization.");
  return { id: ctx.actor.id, name: ctx.actor.name, image: ctx.actor.image, email: null, emailVerified: false };
}

export const accessGet = defineOp({
  name: "access.get",
  kind: "query",
  title: "Who can see a page",
  description: "In an organization: whether a page (and what's inside it) is open to everyone in it, or limited to chosen members and teams, what everyone else gets (nothing, view or comment), and whether it's closed (listed so people can ask to join).",
  input: z.object({ pageId: id }),
  async run(ctx, { pageId }) {
    return pageAccess(ctx.db, member(ctx), ctx.ownerId, pageId);
  },
});

export const accessSet = defineOp({
  name: "access.set",
  kind: "mutation",
  title: "Limit who can see a page",
  description: "In an organization: limits a page (and everything inside it) to chosen members and teams (open: true opens it to everyone again). othersLevel gives everyone else view or comment access instead of hiding it; listed makes a hidden page closed (visible by name, join on request). Admins and the owner always keep access.",
  input: z.object({
    pageId: id,
    open: z.boolean().optional(),
    memberIds: z.array(z.string().max(256)).max(500).optional(),
    teamIds: z.array(z.string().max(64)).max(100).optional(),
    othersLevel: z.enum(["none", "view", "comment"]).optional(),
    listed: z.boolean().optional(),
  }),
  async run(ctx, a) {
    return setPageAccess(ctx.db, member(ctx), ctx.ownerId, a.pageId, a.open ? null : { memberIds: a.memberIds ?? [], teamIds: a.teamIds ?? [], othersLevel: a.othersLevel, listed: a.listed }, ctx.now);
  },
});

export const teamspacesLocked = defineOp({
  name: "teamspaces.locked",
  kind: "query",
  title: "Closed teamspaces",
  description: "In an organization: closed pages and teamspaces you aren't in, by name only, so you can ask to join.",
  input: z.object({}),
  async run(ctx) {
    return lockedPages(ctx.unrestrictedDb ?? ctx.db, member(ctx), ctx.ownerId);
  },
});

export const teamspacesRequestJoin = defineOp({
  name: "teamspaces.requestJoin",
  kind: "mutation",
  title: "Ask to join",
  description: "Asks the people who manage a closed teamspace or page to let you in. They get it in their inbox.",
  input: z.object({ pageId: id, message: z.string().max(300).optional() }),
  async run(ctx, { pageId, message = "" }) {
    const me = member(ctx);
    return requestJoin(ctx, me, pageId, message);
  },
});

async function requestJoin(ctx: OpContext, me: OrgActor, pageId: string, message: string) {
  const { requestPageAccess } = await import("../orgPageAccess");
  return requestPageAccess(ctx.unrestrictedDb ?? ctx.db, me, ctx.ownerId, pageId, message, ctx.now, (recipients, title) =>
    notify(ctx.db, recipients, { kind: "access", ownerId: ctx.ownerId, pageId, actor: me, title, key: `access:${pageId}:${me.id}` }, ctx.now).then(() => undefined),
  );
}
