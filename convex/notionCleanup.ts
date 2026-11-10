import { anyApi, internalMutationGeneric, type GenericDataModel, type GenericMutationCtx } from "convex/server";
import { v } from "convex/values";

/** Remove credentials immediately; purge bounded metadata batches after account deletion. */
export async function purgeNotionAccount(ctx: Pick<GenericMutationCtx<GenericDataModel>, "db" | "scheduler">, ownerId: string) {
  let remaining = false;
  for (const table of ["notionConnections", "notionStates", "notionJobs", "notionItems"]) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .take(100);
    for (const row of rows) {
      const id = ctx.db.normalizeId(table, String(row._id));
      if (id) await ctx.db.delete(id);
    }
    remaining ||= rows.length === 100;
  }
  if (remaining) await ctx.scheduler.runAfter(0, anyApi.notionCleanup.purge, { ownerId });
}

export const purge = internalMutationGeneric({
  args: { ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, { ownerId }) => {
    await purgeNotionAccount(ctx, ownerId);
    return null;
  },
});
