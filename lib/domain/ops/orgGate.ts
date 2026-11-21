import { MaxError, notFound } from "../errors";
import { atLeastRole, getOrg, isOrgNamespace, orgAccess } from "../organizations";
import type { OpContext, OpDef } from "./define";

/**
 * The one place that decides what an operation may do inside an organization's namespace.
 * execute() (and every item of a batch) runs this before the operation, for the UI, Convex,
 * local mode and MCP alike, so the rules can't drift between them.
 */

/** Account-level operations: inside an organization they act on the caller's own account. */
const PERSONAL = new Set([
  "account.username",
  "account.setUsername",
  "tokens.create",
  "tokens.list",
  "tokens.revoke",
  "profileCard.get",
  "profileCard.update",
  "profileCard.export",
  "workspaces.create",
  "workspaces.update",
  "workspaces.delete",
]);

/** Never inside an organization: deleting it is the owner's separate, confirmed flow. */
const DENIED = new Set(["account.deleteAllData"]);

/** Organization-wide or irreversible: admins and the owner only. */
const ADMIN = new Set(["trash.empty", "pages.deletePermanently", "export.all", "sites.publish", "sites.unpublish", "pages.setFavorite", "pages.moveFavorite", "audit.list"]);

export type GateResult = { ctx: OpContext; skip?: { result: unknown } };

export async function orgGate(name: string, def: OpDef, args: unknown, ctx: OpContext): Promise<GateResult> {
  if (!isOrgNamespace(ctx.ownerId)) {
    // An org role only ever travels with its own namespace.
    if (ctx.org) throw notFound();
    return { ctx };
  }
  if (DENIED.has(name)) throw new MaxError("FORBIDDEN", "That isn't available inside an organization.");
  await policyChecks(name, args, ctx);
  // Calls through a page share were already authorized against that share (and its narrow op list).
  if (ctx.viaShare) return { ctx };
  // ctx.org is set only by resolveScope (lib/domain/workspaces.ts), from the membership row it
  // read in this same transaction; contexts built anywhere else never reach the namespace.
  const actorId = ctx.actor?.id;
  const role = ctx.org?.role;
  if (!actorId || !role || role === "guest") throw new MaxError("NOT_FOUND", "That organization doesn't exist, or you're no longer a member.", { workspace: "missing" });
  if (name === "account.init") return { ctx, skip: { result: { created: false } } };
  if (PERSONAL.has(name)) return { ctx: { ...ctx, ownerId: actorId, org: undefined } };
  if (ADMIN.has(name) && !atLeastRole(role, "admin")) throw new MaxError("FORBIDDEN", "Only the organization's admins can do that.");
  if (def.kind === "mutation" && !atLeastRole(role, "member")) throw new MaxError("FORBIDDEN", "Guests can't change the organization's pages.");
  return { ctx };
}

/** The organization's sharing and publishing policies, for members and page guests alike. */
async function policyChecks(name: string, rawArgs: unknown, ctx: OpContext) {
  if (name !== "shares.invite" && name !== "shares.setLink" && name !== "sites.publish") return;
  const org = await getOrg(ctx.db, ctx.ownerId);
  if (!org) throw notFound();
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  if (name === "shares.invite") {
    const grantee = typeof args.granteeId === "string" ? await orgAccess(ctx.db, args.granteeId, ctx.ownerId) : null;
    if (!grantee && !org.policies.allowGuests) throw new MaxError("FORBIDDEN", "This organization doesn't allow sharing pages with people outside it.");
  }
  if (name === "shares.setLink" && ((args.level !== null && args.level !== undefined) || args.web === true)) {
    if (args.web === true && !org.policies.allowPublicLinks) throw new MaxError("FORBIDDEN", "This organization doesn't allow publishing pages to the web.");
    if (!org.policies.allowGuests) throw new MaxError("FORBIDDEN", "This organization doesn't allow sharing pages with people outside it.");
  }
  if (name === "sites.publish" && !org.policies.allowSites) throw new MaxError("FORBIDDEN", "This organization doesn't allow publishing websites.");
}
