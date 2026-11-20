import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { adminOverview } from "@/lib/domain/admin";
import { importSourceOf } from "@/lib/client/importKinds";

describe("people who joined from your link", () => {
  it("counts joins through your link, for you and for admins, without saying who", async () => {
    const h = setup();
    const omar = h.as("user_omar");
    await omar("account.init", { displayName: "Omar" });
    expect((await omar<{ invited: number }>("profileCard.get")).invited).toBe(0);

    await h.as("user_a")("account.init", { displayName: "Ada", invitedBy: 1 });
    await h.as("user_b")("account.init", { displayName: "Ben", invitedBy: 1 });
    await h.as("user_c")("account.init", { displayName: "Cy" });
    // Running init again (every visit) doesn't count anyone twice.
    await h.as("user_a")("account.init", { displayName: "Ada", invitedBy: 1 });

    const mine = await omar<Record<string, unknown>>("profileCard.get");
    expect(mine.invited).toBe(2);
    // Only the number: no names, ids or emails of the people who joined.
    expect(JSON.stringify(mine)).not.toMatch(/Ada|Ben|user_a|user_b/);
    expect((await h.as("user_c")<{ invited: number }>("profileCard.get")).invited).toBe(0);

    const overview = await adminOverview(h.db, Date.now());
    const byId = Object.fromEntries(overview.users.map((u) => [u.id, u]));
    expect(byId.user_omar.invited).toBe(2);
    expect(byId.user_a.invited).toBe(0);
    // Admins see counts, never who invited whom.
    expect(Object.keys(byId.user_a)).not.toContain("invitedBy");
  });
});

describe("dropped files", () => {
  it("knows which files open as pages", () => {
    expect(importSourceOf("Trip.md")).toBe("markdown");
    expect(importSourceOf("notes.TXT")).toBe("markdown");
    expect(importSourceOf("page.html")).toBe("html");
    expect(importSourceOf("Export-123.zip")).toBe("notion");
    expect(importSourceOf("max-backup.json")).toBe("max");
    expect(importSourceOf("photo.png")).toBeNull();
    expect(importSourceOf("report.pdf")).toBeNull();
  });
});
