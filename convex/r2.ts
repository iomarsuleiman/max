import { internalActionGeneric } from "convex/server";
import { v } from "convex/values";
import { presign, r2ConfigFromEnv } from "../lib/domain/r2";

/** Deletes a file from Cloudflare R2 (scheduled from mutations, which can't make network calls). */
export const deleteObject = internalActionGeneric({
  args: { key: v.string() },
  handler: async (_ctx, { key }) => {
    const r2 = r2ConfigFromEnv(process.env);
    if (!r2) return;
    const url = await presign(r2, "DELETE", key, { now: Date.now(), expires: 300 });
    const res = await fetch(url, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status}).`);
  },
});
