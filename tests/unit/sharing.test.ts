import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { ANONYMOUS, accessInfo, joinByLink, duplicateShared, executeShared, heartbeat, present, sharedWithMe } from "@/lib/domain/sharing";

const bob = { id: "user_bob", name: "Bob", image: null };
const cara = { id: "user_cara", name: "Cara", image: null };

async function world() {
  const h = setup();
  const alice = h.as("user_alice");
  const root = (await alice<{ page: { _id: string } }>("pages.create", { title: "Team plan" })).page;
  const child = (await alice<{ page: { _id: string } }>("pages.create", { title: "Milestones", parentId: root._id })).page;
  const secret = (await alice<{ page: { _id: string } }>("pages.create", { title: "Private diary" })).page;
  await alice("documents.writeMarkdown", { pageId: child._id, markdown: "Ship it" });
  let now = Date.UTC(2026, 10, 19);
  const as = (actor: typeof bob, scopePageId: string, linkToken?: string) =>
    async function call<T = any>(op: string, args: Record<string, unknown> = {}): Promise<T> {
      now += 1000;
      return h.db.transaction(() => executeShared(op, args, { db: h.db, storage: h.storage, actor, now, scopePageId, linkToken })) as Promise<T>;
    };
  return { h, alice, root, child, secret, as };
}

describe("page sharing", () => {
  it("shares a page and everything inside it, at the level given", async () => {
    const { alice, root, child, secret, as } = await world();
    const bobRoot = as(bob, root._id);
    await expect(bobRoot("documents.get", { pageId: root._id })).rejects.toThrow(/isn't shared|doesn't exist/);

    await alice("shares.invite", { pageId: root._id, granteeId: bob.id, email: "bob@example.com", name: "Bob", level: "view" });
    const doc = await as(bob, child._id)<{ blocks: unknown[] }>("documents.get", { pageId: child._id });
    expect(JSON.stringify(doc.blocks)).toContain("Ship it");
    // A page outside the share stays private, even when named as a target from inside the share.
    await expect(bobRoot("documents.get", { pageId: secret._id })).rejects.toThrow(/isn't shared/);
    await expect(as(bob, secret._id)("documents.get", { pageId: secret._id })).rejects.toThrow();
    // Viewers can't write.
    await expect(as(bob, child._id)("documents.writeMarkdown", { pageId: child._id, markdown: "x" })).rejects.toThrow(/isn't available/);
    await expect(as(bob, child._id)("pages.update", { id: child._id, title: "Hacked" })).rejects.toThrow(/Can edit/);
    // Breadcrumbs stop at the shared page.
    const got = await as(bob, child._id)<{ breadcrumbs: { title: string }[] }>("pages.get", { id: child._id });
    expect(got.breadcrumbs.map((b) => b.title)).toEqual(["Team plan", "Milestones"]);
  });

  it("doesn't reveal the database of a row shared on its own", async () => {
    const { h, alice, as } = await world();
    const { database } = await alice<{ database: { _id: string } }>("databases.create", { title: "Secret CRM" });
    const { record } = await alice<{ record: { _id: string } }>("records.create", { databaseId: database._id, title: "Deal" });
    await alice("shares.invite", { pageId: record._id, granteeId: bob.id, level: "view" });
    const got = await as(bob, record._id)<{ database: unknown; breadcrumbs: { title: string }[] }>("pages.get", { id: record._id });
    expect(got.database).toBeNull();
    expect(got.breadcrumbs.map((b) => b.title)).toEqual(["Deal"]);
    await expect(as(bob, record._id)("databases.get", { databaseId: database._id })).rejects.toThrow(/isn't shared/);
    void h;
  });

  it("lets editors edit, commenters comment, and keeps comment text with its author", async () => {
    const { alice, root, child, as } = await world();
    const { share } = await alice<{ share: { _id: string } }>("shares.invite", { pageId: root._id, granteeId: bob.id, level: "comment" });
    const c = await as(bob, child._id)<{ comment: { _id: string; authorName: string } }>("comments.add", { pageId: child._id, body: "Looks good" });
    expect(c.comment.authorName).toBe("Bob");
    await alice("shares.invite", { pageId: root._id, granteeId: cara.id, level: "edit" });
    await expect(as(cara, child._id)("comments.update", { id: c.comment._id, body: "Changed" })).rejects.toThrow(/Only the person/);
    await as(cara, child._id)("comments.resolve", { id: c.comment._id, resolved: true });
    await as(cara, child._id)("pages.update", { id: child._id, title: "Milestones v2" });
    await expect(as(cara, child._id)("pages.update", { id: child._id, locked: true })).rejects.toThrow(/full access/);
    await alice("shares.update", { id: share._id, level: "edit" });
    await as(bob, child._id)("pages.update", { id: child._id, title: "Milestones v3" });
    await alice("shares.remove", { id: share._id });
    await expect(as(bob, child._id)("documents.get", { pageId: child._id })).rejects.toThrow();
  });

  it("lets full access re-share but not escalate others above their own level", async () => {
    const { alice, root, as } = await world();
    await alice("shares.invite", { pageId: root._id, granteeId: bob.id, level: "edit" });
    await expect(as(bob, root._id)("shares.invite", { pageId: root._id, granteeId: cara.id, level: "view" })).rejects.toThrow(/Full access/);
    await alice("shares.invite", { pageId: root._id, granteeId: bob.id, level: "full_access" });
    await as(bob, root._id)("shares.invite", { pageId: root._id, granteeId: cara.id, level: "edit" });
    const list = await alice<{ direct: { granteeId: string; level: string }[] }>("shares.list", { pageId: root._id });
    expect(list.direct.map((s) => [s.granteeId, s.level])).toEqual([[bob.id, "full_access"], [cara.id, "edit"]]);
  });

  it("gives signed-in people with the link the link's level, and lists shares for the recipient", async () => {
    const { h, alice, root, child, as } = await world();
    await expect(as(cara, child._id)("documents.get", { pageId: child._id })).rejects.toThrow();
    const { link } = await alice<{ link: { token: string } }>("shares.setLink", { pageId: root._id, level: "view" });
    // Like Notion, the page's address is the link: no token needed once link access is on.
    await as(cara, child._id)("documents.get", { pageId: child._id });
    await as(cara, child._id, link.token)("documents.get", { pageId: child._id });
    // Visitors without an account never get in through a Max-only link.
    await expect(as({ id: ANONYMOUS, name: "Visitor", image: null }, child._id, link.token)("documents.get", { pageId: child._id })).rejects.toThrow();
    expect((await accessInfo(h.db, cara.id, child._id, link.token)).level).toBe("view");
    const inherited = await alice<{ link: { fromTitle: string } }>("shares.list", { pageId: child._id });
    expect(inherited.link.fromTitle).toBe("Team plan");
    await alice("shares.setLink", { pageId: root._id, level: null });
    await expect(as(cara, child._id, link.token)("documents.get", { pageId: child._id })).rejects.toThrow();
    await expect(as(cara, child._id)("documents.get", { pageId: child._id })).rejects.toThrow();

    await alice("shares.invite", { pageId: root._id, granteeId: bob.id, level: "view" });
    expect((await sharedWithMe(h.db, bob.id)).map((p) => p.title)).toEqual(["Team plan"]);
    await alice("pages.archive", { id: root._id });
    expect(await sharedWithMe(h.db, bob.id)).toEqual([]);
    await expect(as(bob, child._id)("documents.get", { pageId: child._id })).rejects.toThrow();
  });

  it("shows who has a shared page open", async () => {
    const { h, alice, root } = await world();
    await alice("shares.invite", { pageId: root._id, granteeId: bob.id, level: "view" });
    const now = Date.UTC(2026, 10, 19);
    await heartbeat(h.db, bob, root._id, now);
    await heartbeat(h.db, { id: "user_alice", name: "Alice", image: null }, root._id, now);
    expect((await present(h.db, bob.id, root._id, now + 1000)).people.map((p) => p.name).sort()).toEqual(["Alice", "Bob"]);
    expect((await present(h.db, bob.id, root._id, now + 60_000)).people).toEqual([]);
    await expect(heartbeat(h.db, cara, root._id, now)).rejects.toThrow();
  });

  it("publishes to the web: visitors without an account can read, nothing more", async () => {
    const { alice, root, child, secret, as } = await world();
    const visitor = { id: ANONYMOUS, name: "Visitor", image: null };
    const { link } = await alice<{ link: { token: string } }>("shares.setLink", { pageId: root._id, level: "edit" });
    // A link for signed-in people doesn't let visitors in.
    await expect(as(visitor, child._id, link.token)("documents.get", { pageId: child._id })).rejects.toThrow();
    await alice("shares.setLink", { pageId: root._id, level: "edit", web: true });
    const doc = await as(visitor, child._id, link.token)<{ blocks: unknown[] }>("documents.get", { pageId: child._id });
    expect(JSON.stringify(doc.blocks)).toContain("Ship it");
    await expect(as(visitor, child._id, link.token)("comments.list", { pageId: child._id })).rejects.toThrow(/published page/);
    await expect(as(visitor, child._id, link.token)("pages.update", { id: child._id, title: "x" })).rejects.toThrow();
    await expect(as(visitor, secret._id, link.token)("documents.get", { pageId: secret._id })).rejects.toThrow();
    // Publishing is view-only, even for people signed in with the link.
    expect((await alice<{ link: { level: string; public: boolean } }>("shares.list", { pageId: root._id })).link).toMatchObject({ level: "view", public: true });
  });

  it("duplicates a shared page into your own workspace with its sub-pages and links", async () => {
    const { h, alice, root, child, as } = await world();
    await alice("documents.writeMarkdown", { pageId: root._id, markdown: `See [Milestones](/p/${child._id})` });
    const { storageId } = { storageId: "file1" };
    const asset = await h.db.insert("assets", { ownerId: "user_alice", pageId: root._id, storageId, name: "a.png", type: "image/png", size: 1, alt: "", createdAt: 1 });
    await alice("pages.update", { id: root._id, cover: `max-asset://${asset}` });
    await alice("shares.invite", { pageId: root._id, granteeId: bob.id, level: "view" });
    const res = await h.db.transaction(() => duplicateShared(h.db, bob, root._id, Date.now()));
    expect(res.copied).toBe(2);
    const bobCall = h.as(bob.id);
    const tree = await bobCall<{ pages: { _id: string; title: string; parentId: string | null }[] }>("pages.tree");
    const copyRoot = tree.pages.find((p) => p._id === res.id)!;
    const copyChild = tree.pages.find((p) => p.parentId === res.id)!;
    expect(copyRoot.title).toBe("Team plan");
    expect(copyChild.title).toBe("Milestones");
    const md = await bobCall<{ markdown: string }>("documents.get", { pageId: res.id, format: "markdown" });
    expect(md.markdown).toContain(copyChild._id);
    expect(md.markdown).not.toContain(child._id);
    const page = await bobCall<{ page: { cover: string } }>("pages.get", { id: res.id });
    const borrowed = await h.db.get("assets", page.page.cover.slice("max-asset://".length));
    expect(borrowed).toMatchObject({ ownerId: bob.id, storageId, borrowed: true });
    // Alice's originals are untouched, and the copy isn't shared with anyone.
    expect((await alice<{ page: { title: string } }>("pages.get", { id: root._id })).page.title).toBe("Team plan");
    await expect(as(cara, res.id)("documents.get", { pageId: res.id })).rejects.toThrow();
    await expect(h.db.transaction(() => duplicateShared(h.db, { id: ANONYMOUS, name: "Visitor", image: null }, root._id, Date.now()))).rejects.toThrow(/Sign in/);
  });

  it("lists everything an owner shares, with people and link settings", async () => {
    const { alice, root, child } = await world();
    await alice("shares.invite", { pageId: root._id, granteeId: bob.id, name: "Bob", level: "edit" });
    await alice("shares.setLink", { pageId: child._id, level: "view", web: true });
    const { pages } = await alice<{ pages: { title: string; people: { name: string }[]; link: { public: boolean } | null }[] }>("shares.overview", {});
    expect(pages.map((p) => p.title)).toEqual(["Milestones", "Team plan"]);
    expect(pages.find((p) => p.title === "Team plan")).toMatchObject({ people: [{ name: "Bob" }], link: null });
    expect(pages.find((p) => p.title === "Milestones")?.link).toMatchObject({ public: true });
  });

  it("makes teamspaces: top-level pages shared with a group, listed as teamspaces for everyone in them", async () => {
    const { h, alice, as } = await world();
    const { page } = await alice<{ page: { _id: string; teamspace?: boolean } }>("pages.create", { title: "Family", icon: "🏡", teamspace: true });
    expect(page.teamspace).toBe(true);
    await expect(alice("pages.create", { title: "Nested", parentId: page._id, teamspace: true })).rejects.toThrow(/top level/);
    const inside = (await alice<{ page: { _id: string } }>("pages.create", { title: "Groceries", parentId: page._id })).page;
    await alice("shares.invite", { pageId: page._id, granteeId: bob.id, name: "Bob", level: "edit" });
    const forBob = await sharedWithMe(h.db, bob.id);
    expect(forBob).toEqual([expect.objectContaining({ title: "Family", teamspace: true })]);
    // Members edit what's inside, and can add pages to it.
    await as(bob, inside._id)("pages.update", { id: inside._id, title: "Groceries this week" });
    await as(bob, page._id)("pages.create", { title: "Holiday plans", parentId: page._id });
    const tree = await alice<{ pages: { title: string; teamspace?: boolean }[] }>("pages.tree", {});
    expect(tree.pages.find((p) => p.title === "Family")?.teamspace).toBe(true);
    expect(tree.pages.map((p) => p.title)).toEqual(expect.arrayContaining(["Groceries this week", "Holiday plans"]));
  });

  it("turns a link into an invitation: joining keeps the page (or teamspace) in your sidebar", async () => {
    const { h, alice, root, child } = await world();
    const { page: team } = await alice<{ page: { _id: string } }>("pages.create", { title: "Book club", teamspace: true });
    await alice("shares.setLink", { pageId: team._id, level: "edit" });
    // Visiting through the link offers to join; nothing is in the sidebar yet.
    const info = await accessInfo(h.db, cara.id, team._id);
    expect(info.invite).toMatchObject({ pageId: team._id, title: "Book club", teamspace: true });
    expect(await sharedWithMe(h.db, cara.id)).toEqual([]);
    expect(await joinByLink(h.db, cara, team._id, Date.now())).toMatchObject({ joined: true, teamspace: true });
    expect(await sharedWithMe(h.db, cara.id)).toEqual([expect.objectContaining({ title: "Book club", teamspace: true, level: "edit" })]);
    expect((await accessInfo(h.db, cara.id, team._id)).invite).toBeNull();
    // Joining twice changes nothing; turning the link off doesn't remove a member who joined.
    expect(await joinByLink(h.db, cara, team._id, Date.now())).toMatchObject({ joined: false });
    await alice("shares.setLink", { pageId: team._id, level: null });
    expect((await accessInfo(h.db, cara.id, team._id)).level).toBe("edit");
    // No link, no joining.
    await expect(joinByLink(h.db, cara, child._id, Date.now())).rejects.toThrow();
    void root;
  });
});
