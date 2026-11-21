import { internalMutationGeneric } from "convex/server";
import { applyRetention } from "../lib/domain/retention";
import { runDueSchedules } from "../lib/domain/ops/automations";
import { convexDb, convexStorage } from "./convexDb";

export const sweep = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const db = convexDb(ctx.db);
    const storage = convexStorage(ctx.storage);
    return { ...(await applyRetention(db, storage, Date.now())), ...(await runDueSchedules(db, storage, Date.now())) };
  },
});
