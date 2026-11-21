import { z } from "zod";
import { accountOf } from "../workspaces";
import { isOrgNamespace } from "../organizations";
import { defineOp, type OpContext } from "./define";

export interface PersonChoice {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}

/**
 * Who can be assigned or mentioned here: an organization's members (guests included, since
 * they're named on pages shared with them), or, in a personal workspace, just you.
 */
export async function people(ctx: OpContext): Promise<PersonChoice[]> {
  if (isOrgNamespace(ctx.ownerId)) {
    return (await ctx.db.list("orgMembers", ctx.ownerId))
      .filter((m) => m.status === "active")
      .map((m) => ({ id: m.accountId, name: m.name || m.email?.split("@")[0] || "Member", email: m.email, image: m.image }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const account = accountOf(ctx.ownerId);
  const s = (await ctx.db.list("settings", account))[0];
  return [{ id: account, name: s?.displayName || "You", email: s?.email ?? null, image: null }];
}

export const peopleList = defineOp({
  name: "people.list",
  kind: "query",
  title: "List people",
  description: "People who can be assigned to Person properties or @mentioned in this workspace: an organization's members, or just you in a personal workspace. Use their id as the value.",
  input: z.object({}),
  async run(ctx) {
    return { people: await people(ctx) };
  },
});
