import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { resolveOwner } from "@/lib/domain/workspaces";
import { setModeration } from "@/lib/domain/admin";

describe("personal workspaces", () => {
  it("keeps each workspace's pages separate, with its own sidebar settings and the account's name and card", async () => {
    const h = setup();
    const main = h.as("user_a");
    await main("account.init", { displayName: "Ada" });
    await main("pages.create", { title: "Main notes" });
    await main("settings.update", { accent: "green", sidebarWidth: 300 });
    const before = (await main<{ memberNumber: number }>("profileCard.get")).memberNumber;

    const { workspace } = await main<{ workspace: { id: string } }>("workspaces.create", { name: "Side project", icon: "🚀" });
    const owner = await resolveOwner(h.db, "user_a", workspace.id);
    expect(owner).toBe(`user_a~${workspace.id}`);
    const side = h.as(owner);
    // A new workspace starts with one empty page, ready to write in.
    expect((await side<{ pages: { title: string }[] }>("pages.tree")).pages.map((p) => p.title)).toEqual([""]);
    await side("pages.create", { title: "Side notes" });

    const titles = async (call: typeof main) => (await call<{ pages: { title: string }[] }>("pages.tree")).pages.map((p) => p.title);
    expect(await titles(main)).toContain("Main notes");
    expect(await titles(main)).not.toContain("Side notes");
    expect(await titles(side)).toEqual(["", "Side notes"]);

    // The account's name, accent and member number follow you; the sidebar is the workspace's own.
    const s = (await side<{ settings: { displayName: string; accent: string; sidebarWidth: number } }>("settings.get")).settings;
    expect(s).toMatchObject({ displayName: "Ada", accent: "green", sidebarWidth: 248 });
    await side("settings.update", { sidebarWidth: 280, accent: "pink" });
    expect((await main<{ settings: { sidebarWidth: number; accent: string } }>("settings.get")).settings).toMatchObject({ sidebarWidth: 300, accent: "pink" });
    expect((await side<{ memberNumber: number }>("profileCard.get")).memberNumber).toBe(before);
    // A new workspace adds no settings row, so nobody's member number moves.
    expect((await h.db.listAll("settings", 100)).length).toBe(1);

    const list = await side<{ current: string; workspaces: { id: string | null; name: string }[] }>("workspaces.list");
    expect(list.current).toBe(workspace.id);
    expect(list.workspaces.map((w) => w.name)).toEqual(["Personal", "Side project"]);
  });

  it("only reaches your own workspaces, and deleting one removes only its data", async () => {
    const h = setup();
    const main = h.as("user_a");
    await main("account.init", {});
    const { workspace } = await main<{ workspace: { id: string } }>("workspaces.create", { name: "Temp" });
    // Someone else can't open your workspace, even knowing its id: it isn't in their list.
    await expect(resolveOwner(h.db, "user_b", workspace.id)).rejects.toThrow(/doesn't exist/);
    await expect(resolveOwner(h.db, "user_a", "not valid!")).rejects.toThrow(/doesn't exist/);

    const side = h.as(`user_a~${workspace.id}`);
    await side("pages.create", { title: "Scratch" });
    await main("pages.create", { title: "Keep" });
    await expect(main("workspaces.delete", { id: workspace.id })).rejects.toThrow(/Confirm/);
    await main("workspaces.delete", { id: workspace.id, confirm: true });
    expect(await h.db.list("pages", `user_a~${workspace.id}`)).toEqual([]);
    expect((await main<{ pages: { title: string }[] }>("pages.tree")).pages.map((p) => p.title)).toContain("Keep");
    await expect(resolveOwner(h.db, "user_a", workspace.id)).rejects.toThrow(/anymore/);
  });

  it("applies suspensions to every workspace of the account", async () => {
    const h = setup();
    const main = h.as("user_a");
    await main("account.init", {});
    const { workspace } = await main<{ workspace: { id: string } }>("workspaces.create", { name: "Other" });
    await h.db.transaction(() => setModeration(h.db, "admin", "user_a", "suspended", "Spam", Date.now()));
    await expect(h.as(`user_a~${workspace.id}`)("pages.create", { title: "Nope" })).rejects.toThrow(/suspended/);
  });

  it("renames the main workspace and caps how many you can make", async () => {
    const h = setup();
    const main = h.as("user_a");
    await main("workspaces.update", { id: null, name: "Home base" });
    for (let i = 0; i < 10; i++) await main("workspaces.create", { name: `W${i}` });
    await expect(main("workspaces.create", { name: "One too many" })).rejects.toThrow(/up to 11/);
    expect((await main<{ workspaces: { name: string }[] }>("workspaces.list")).workspaces[0].name).toBe("Home base");
  });
});
