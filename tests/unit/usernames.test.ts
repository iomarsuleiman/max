import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { profileByUsername, usernameProblem } from "@/lib/domain/usernames";
import { duplicateShared, linkPreview } from "@/lib/domain/sharing";
import { resolveOwner } from "@/lib/domain/workspaces";

describe("usernames and invite links", () => {
  it("gives everyone a simple, unique username from their name, and lets them change it", async () => {
    const h = setup();
    const omar = h.as("user_omar");
    await omar("account.init", { displayName: "Omar Suleiman", email: "o@example.com" });
    expect((await omar<{ username: string }>("account.username")).username).toBe("omar");
    const other = h.as("user_omar2");
    await other("account.init", { displayName: "Omar Khalil" });
    expect((await other<{ username: string }>("account.username")).username).toBe("omar2");

    await expect(other("account.setUsername", { username: "omar" })).rejects.toThrow(/taken/);
    await expect(other("account.setUsername", { username: "admin" })).rejects.toThrow(/Max itself/);
    await expect(other("account.setUsername", { username: "No Spaces" })).rejects.toThrow(/lowercase/);
    expect((await other<{ username: string }>("account.setUsername", { username: "@Khalil" })).username).toBe("khalil");
    expect(usernameProblem("ok.name_1")).toBeNull();

    // The public invite profile shows only name, number and card.
    const profile = await profileByUsername(h.db, "omar");
    expect(profile).toMatchObject({ username: "omar", name: "Omar Suleiman", memberNumber: 1 });
    expect(Object.keys(profile!).sort()).toEqual(["card", "memberNumber", "name", "username"]);
    expect(await profileByUsername(h.db, "nobody")).toBeNull();
  });

  it("previews a shared link with the page's title and sender, and nothing for a bad link", async () => {
    const h = setup();
    const owner = h.as("user_a");
    await owner("account.init", { displayName: "Ada" });
    const page = (await owner<{ page: { _id: string } }>("pages.create", { title: "Trip plan", icon: "✈️" })).page;
    const child = (await owner<{ page: { _id: string } }>("pages.create", { title: "Day one", parentId: page._id })).page;
    const other = (await owner<{ page: { _id: string } }>("pages.create", { title: "Private diary" })).page;
    const { link } = await owner<{ link: { token: string } }>("shares.setLink", { pageId: page._id, level: "view" });
    expect(await linkPreview(h.db, link.token, page._id)).toMatchObject({ title: "Trip plan", icon: "✈️", from: "Ada", public: false });
    expect(await linkPreview(h.db, link.token, child._id)).toMatchObject({ title: "Day one" });
    // The link doesn't reveal pages it doesn't cover.
    expect(await linkPreview(h.db, link.token, other._id)).toBeNull();
    expect(await linkPreview(h.db, "0".repeat(32), page._id)).toBeNull();
  });

  it("duplicates a shared page into the workspace you have open", async () => {
    const h = setup();
    const owner = h.as("user_a");
    const page = (await owner<{ page: { _id: string } }>("pages.create", { title: "Recipe" })).page;
    const { link } = await owner<{ link: { token: string } }>("shares.setLink", { pageId: page._id, level: "view" });
    const bob = h.as("user_b");
    await bob("account.init", {});
    const { workspace } = await bob<{ workspace: { id: string } }>("workspaces.create", { name: "Kitchen" });
    const target = await resolveOwner(h.db, "user_b", workspace.id);
    const actor = { id: "user_b", name: "Bob", image: null };
    await h.db.transaction(() => duplicateShared(h.db, actor, page._id, Date.now(), link.token, target));
    expect((await h.db.list("pages", target)).map((p) => p.title)).toEqual(["Recipe"]);
    expect((await h.db.list("pages", "user_b")).map((p) => p.title)).not.toContain("Recipe");
    // Never into someone else's workspace.
    await expect(h.db.transaction(() => duplicateShared(h.db, actor, page._id, Date.now(), link.token, "user_a"))).rejects.toThrow(/your own/);
  });
});
