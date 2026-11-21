import { z } from "zod";
import { MaxError } from "../errors";
import { accountOf } from "../workspaces";
import { isOrgNamespace, setAccountOrganizations } from "../organizations";
import { defineOp } from "./define";
import type { OpContext } from "./define";

/* Max's platform admin, over MCP: the same switches as Admin → Users. Refused for everyone else. */

function adminOnly(ctx: OpContext) {
  if (!ctx.platformAdmin) throw new MaxError("FORBIDDEN", "Only Max's platform admins can do that.");
  return { id: ctx.actor?.id ?? accountOf(ctx.ownerId), name: ctx.actor?.name ?? null };
}

/** An account by id, username or sign-in email. */
async function findAccount(ctx: OpContext, who: string) {
  const q = who.trim().replace(/^@/, "").toLowerCase();
  const byName = (await ctx.db.findBy("usernames", "username", q))[0];
  if (byName) return byName.ownerId;
  if ((await ctx.db.list("settings", q))[0]) return q;
  const hit = (await ctx.db.listAll("settings", 5000)).find((s) => !isOrgNamespace(s.ownerId) && (s.email ?? "").toLowerCase() === q);
  if (hit) return hit.ownerId;
  throw new MaxError("NOT_FOUND", `No Max account matches "${who}".`);
}

export const organizationsAccess = defineOp({
  name: "admin.organizations",
  kind: "mutation",
  title: "Switch organizations on or off for a person (platform admin)",
  description:
    "Max's platform admin only. Organizations are off for every account until switched on here or in Admin → Users. With `on`, turns them on (the person can create organizations, invite people and use everything) or off (no new organizations; existing ones keep working). Without `on`, reports the current state. `person` is an account id, username or sign-in email.",
  input: z.object({ person: z.string().min(1).max(320), on: z.boolean().optional() }),
  async run(ctx, { person, on }) {
    const admin = adminOnly(ctx);
    const accountId = await findAccount(ctx, person);
    if (on !== undefined) await setAccountOrganizations(ctx.db, admin, accountId, on, ctx.now);
    const row = (await ctx.db.list("accountFeatures", accountId))[0];
    return { accountId, organizations: !!row?.organizations };
  },
});
