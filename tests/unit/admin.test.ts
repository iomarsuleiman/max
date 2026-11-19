import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { adminOverview, isAdminEmail, listReports, setModeration, setReportStatus, submitReport } from "@/lib/domain/admin";
import { siteNav } from "@/lib/domain/sites";

describe("admin dashboard", () => {
  it("recognises admins only from the configured list", () => {
    expect(isAdminEmail("Owner@Example.com", "owner@example.com, other@example.com")).toBe(true);
    expect(isAdminEmail("someone@example.com", "owner@example.com")).toBe(false);
    expect(isAdminEmail(null, "owner@example.com")).toBe(false);
    expect(isAdminEmail("owner@example.com", "")).toBe(false);
  });

  it("shows how people use Max, and suspending or banning works and explains itself", async () => {
    const h = setup();
    const sam = h.as("user_sam");
    await sam("account.init", { displayName: "Sam", email: "sam@example.com" });
    const { page } = await sam<{ page: { _id: string } }>("pages.create", { title: "Recipes" });
    await sam("databases.create", { title: "Books" });
    await sam("sites.publish", { pageId: page._id, slug: "sams-recipes", name: "Recipes" });
    const now = Date.now();
    const { totals, users } = await adminOverview(h.db, now);
    const row = users.find((u) => u.id === "user_sam")!;
    expect(row).toMatchObject({ name: "Sam", email: "sam@example.com", databases: 1, sites: 1, status: "active" });
    expect(row.pages).toBeGreaterThanOrEqual(2);
    expect(totals.sites).toBe(1);

    // Suspended: reads work, writes don't, and the person can see why.
    await setModeration(h.db, "admin", "user_sam", "suspended", "Posting spam links", now);
    await sam("pages.tree", {});
    await expect(sam("pages.create", { title: "More spam" })).rejects.toThrow(/suspended/);
    expect(await sam("account.standing", {})).toMatchObject({ status: "suspended", reason: "Posting spam links" });
    // Banned: nothing works except reading the reason; published sites go offline.
    await setModeration(h.db, "admin", "user_sam", "banned", "Repeated spam", now);
    await expect(sam("pages.tree", {})).rejects.toThrow(/banned/);
    expect(await sam("account.standing", {})).toMatchObject({ status: "banned", reason: "Repeated spam" });
    await expect(siteNav(h.db, "sams-recipes")).rejects.toThrow();
    expect((await adminOverview(h.db, now)).users.find((u) => u.id === "user_sam")?.status).toBe("banned");
    // Restored.
    await setModeration(h.db, "admin", "user_sam", "active", "", now);
    await sam("pages.create", { title: "Back again" });
    await expect(setModeration(h.db, "admin", "admin", "banned", "", now)).rejects.toThrow(/your own/);
  });

  it("collects reports from people and visitors, with limits, and resolves them", async () => {
    const h = setup();
    const now = Date.now();
    await submitReport(h.db, { id: "user_sam", name: "Sam", email: "sam@example.com" }, { kind: "bug", message: "The editor froze when I pasted a table." }, now);
    await submitReport(h.db, null, { kind: "content", message: "This site is a scam.", siteSlug: "bad-site", url: "https://max.chaos.fail/site/bad-site" }, now);
    await expect(submitReport(h.db, null, { kind: "bug", message: "x" }, now)).rejects.toThrow(/little/);
    const { reports } = await listReports(h.db);
    expect(reports.map((r) => r.kind).sort()).toEqual(["bug", "content"]);
    expect(reports.find((r) => r.kind === "content")).toMatchObject({ reporterId: null, siteSlug: "bad-site", status: "open" });
    await setReportStatus(h.db, reports[0]._id, "resolved", now);
    expect((await listReports(h.db)).reports.filter((r) => r.status === "open")).toHaveLength(1);
    for (let i = 0; i < 9; i++) await submitReport(h.db, { id: "user_sam", name: "Sam", email: null }, { kind: "other", message: `Report ${i}` }, now);
    await expect(submitReport(h.db, { id: "user_sam", name: "Sam", email: null }, { kind: "other", message: "One too many" }, now)).rejects.toThrow(/lot of reports/);
  });
});
