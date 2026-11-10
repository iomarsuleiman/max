import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "@/convex/schema";
import { convexDb } from "@/convex/convexDb";
import { defaultSettings } from "@/lib/domain/ops/helpers";

describe("legacy Max join dates", () => {
  it("reads the original Convex settings creation time instead of the last edit", async () => {
    const t = convexTest(schema, { "../../convex/_generated/server.ts": () => import("@/convex/_generated/server") });
    await t.run(async (ctx) => {
      const { joinedAt: _joinedAt, ...legacy } = defaultSettings("member", Date.UTC(2026, 10, 10));
      const id = await ctx.db.insert("settings", legacy);
      const stored = await ctx.db.get(id);
      const db = convexDb(ctx.db);
      expect((await db.get("settings", id))?.joinedAt).toBe(stored?._creationTime);
      expect((await db.list("settings", "member"))[0].joinedAt).toBe(stored?._creationTime);
      await db.patch("settings", id, { joinedAt: 123, updatedAt: 456 });
      expect((await db.get("settings", id))?.joinedAt).toBe(123);
    });
  });
});
