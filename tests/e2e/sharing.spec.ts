import { expect, test, type Browser, type BrowserContext } from "@playwright/test";

/** Local multi-person mode: a cookie picks who you are (see localActor in lib/server/local.ts). */
async function person(browser: Browser, baseURL: string, name: string): Promise<BrowserContext> {
  const ctx = await browser.newContext();
  await ctx.addCookies([{ name: "max-dev-user", value: name, url: baseURL }]);
  return ctx;
}

test("share a page like Notion: invite, comment, edit live, link access and removal", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const alice = await person(browser, baseURL!, "alice");
  const bob = await person(browser, baseURL!, "bob");
  const cara = await person(browser, baseURL!, "cara");
  const a = await alice.newPage();
  const b = await bob.newPage();
  const c = await cara.newPage();

  // Alice writes a page with a sub-page.
  const create = async (title: string, parentId?: string) =>
    (await (await alice.request.post("/api/local/ops", { data: { op: "pages.create", kind: "mutation", args: { title, parentId } } })).json()).result.page as { _id: string };
  const plan = await create("Team plan");
  const milestones = await create("Milestones", plan._id);
  await alice.request.post("/api/local/ops", { data: { op: "documents.writeMarkdown", kind: "mutation", args: { pageId: plan._id, markdown: "Launch on Friday." } } });

  // Bob can't open it yet.
  await b.goto(`/p/${plan._id}`);
  await expect(b.getByText("This page doesn't exist")).toBeVisible();

  // Alice shares it with Bob, who can comment.
  await a.goto(`/p/${plan._id}`);
  await a.getByRole("button", { name: "Share", exact: true }).click();
  const menu = a.getByRole("dialog");
  await menu.getByLabel("Invite by email").fill("bob@example.com");
  await menu.getByRole("combobox", { name: "Access for new people" }).click();
  await a.getByRole("option", { name: "Can comment" }).click();
  await menu.getByRole("button", { name: "Invite" }).click();
  await expect(menu.getByRole("listitem").filter({ hasText: "bob@example.com" })).toBeVisible();

  // Bob sees it under Shared, reads it, can't edit, can comment.
  await b.goto("/home");
  const shared = b.getByRole("tree", { name: "Pages shared with you" });
  await expect(shared.getByRole("link", { name: "Team plan" })).toBeVisible();
  await shared.getByRole("button", { name: "Expand Team plan" }).click();
  await expect(shared.getByRole("link", { name: "Milestones" })).toBeVisible();
  await shared.getByRole("link", { name: "Team plan" }).click();
  await expect(b.locator(".bn-editor")).toContainText("Launch on Friday.");
  await expect(b.locator(".bn-editor")).toHaveAttribute("contenteditable", "false");
  await expect(b.getByLabel("Page title")).toHaveJSProperty("readOnly", true);
  await b.getByRole("button", { name: /^Comments/ }).click();
  await b.getByLabel("New comment").fill("Can we do Thursday?");
  await b.keyboard.press("Enter");
  await expect(b.getByRole("complementary").getByText("Can we do Thursday?")).toBeVisible();

  // Alice sees Bob's comment with his name, and Bob on the page.
  await a.getByRole("button", { name: /^Comments/ }).click();
  const aliceComments = a.getByRole("complementary");
  await expect(aliceComments.getByText("Can we do Thursday?")).toBeVisible({ timeout: 15_000 });
  await expect(aliceComments.getByText("Bob", { exact: true })).toBeVisible();
  await expect(a.getByRole("group", { name: /Also on this page: Bob/ })).toBeVisible({ timeout: 30_000 });

  // Alice upgrades Bob to edit; Bob renames the page and Alice sees it live.
  await a.getByRole("button", { name: "Share", exact: true }).click();
  await a.getByRole("dialog").getByRole("combobox", { name: /Access for Bob/ }).click();
  await a.getByRole("option", { name: "Can edit" }).click();
  await a.keyboard.press("Escape");
  await b.reload();
  await expect(b.locator(".bn-editor")).toHaveAttribute("contenteditable", "true");
  await b.getByLabel("Page title").fill("Team plan v2");
  await b.getByLabel("Page title").press("Tab");
  await expect(a.getByLabel("Page title")).toHaveValue("Team plan v2", { timeout: 15_000 });

  // Anyone with the link: Cara gets view access through it, only through it.
  await c.goto(`/p/${milestones._id}`);
  await expect(c.getByText("This page doesn't exist")).toBeVisible();
  await a.getByRole("button", { name: "Share", exact: true }).click();
  await a.getByRole("dialog").getByRole("combobox", { name: "Who can open the link" }).click();
  await a.getByRole("option", { name: "Anyone in Max with the link" }).click();
  await expect(a.getByRole("dialog").getByText(/Anyone signed in to Max with the link can open it/)).toBeVisible();
  const token = (await (await alice.request.post("/api/local/ops", { data: { op: "shares.list", kind: "query", args: { pageId: plan._id } } })).json()).result.link.token as string;
  await a.keyboard.press("Escape");
  await c.goto(`/p/${plan._id}?share=${token}`);
  await expect(c.locator(".bn-editor")).toContainText("Launch on Friday.");
  await c.goto(`/p/${milestones._id}`);
  await expect(c.getByLabel("Page title")).toHaveValue("Milestones");

  // Removing Bob, and turning link access off, ends his access (with the link on, the page's
  // address alone lets anyone signed in open it, as in Notion).
  await a.getByRole("button", { name: "Share", exact: true }).click();
  await a.getByRole("dialog").getByRole("combobox", { name: /Access for Bob/ }).click();
  await a.getByRole("option", { name: "Remove" }).click();
  await a.getByRole("dialog").getByRole("combobox", { name: "Who can open the link" }).click();
  await a.getByRole("option", { name: "Only people invited" }).click();
  await b.reload();
  await expect(b.getByText("This page doesn't exist")).toBeVisible();

  await Promise.all([alice.close(), bob.close(), cara.close()]);
});

test("type together live with cursors, publish to the web, and duplicate", async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  const alice = await person(browser, baseURL!, "alice");
  const bob = await person(browser, baseURL!, "bob");
  const a = await alice.newPage();
  const b = await bob.newPage();
  const ops = async (op: string, kind: "query" | "mutation", args: Record<string, unknown>) => (await (await alice.request.post("/api/local/ops", { data: { op, kind, args } })).json()).result;
  const page = (await ops("pages.create", "mutation", { title: "Live notes" })).page as { _id: string };
  await ops("documents.writeMarkdown", "mutation", { pageId: page._id, markdown: "Agenda" });
  await ops("shares.invite", "mutation", { pageId: page._id, granteeId: "bob", email: "bob@example.com", name: "Bob", level: "edit" });

  await a.goto(`/p/${page._id}`);
  await b.goto(`/p/${page._id}`);
  const ae = a.locator(".bn-editor");
  const be = b.locator(".bn-editor");
  await expect(ae).toContainText("Agenda");
  await expect(be).toContainText("Agenda");
  await expect(be).toHaveAttribute("contenteditable", "true");

  // Both type at the same time, in different places; nothing is lost and nobody gets a conflict.
  // At human speed: a key pressed within a few milliseconds of moving the caret can land before the
  // editor has read the move (ProseMirror ignores caret changes briefly after it redraws).
  const human = { delay: 40 };
  await ae.getByText("Agenda").click();
  await a.keyboard.press("End", human);
  await a.waitForTimeout(150);
  await a.keyboard.type(" for Monday", human);
  await be.getByText("Agenda").click();
  await b.keyboard.press("End", human);
  await b.waitForTimeout(150);
  await b.keyboard.press("Enter", human);
  await b.keyboard.type("Bob was here", human);
  await expect(ae).toContainText("Agenda for Monday");
  await expect(ae).toContainText("Bob was here", { timeout: 15_000 });
  await expect(be).toContainText("Agenda for Monday", { timeout: 15_000 });
  // Alice sees Bob's labeled cursor.
  await expect(a.locator(".collaboration-cursor__caret, .bn-collaboration-cursor__base").first()).toBeAttached({ timeout: 15_000 });
  await expect(a.getByText("This page changed somewhere else")).toHaveCount(0);

  // The merged page is saved for search, history and assistants.
  await expect
    .poll(async () => (await ops("documents.get", "query", { pageId: page._id, format: "markdown" })).markdown as string, { timeout: 20_000 })
    .toMatch(/Agenda for Monday[\s\S]*Bob was here/);

  // An assistant edit reaches everyone in the room instead of being overwritten.
  await ops("documents.writeMarkdown", "mutation", { pageId: page._id, markdown: "Rewritten by an assistant" });
  await expect(ae).toContainText("Rewritten by an assistant", { timeout: 20_000 });
  await expect(be).toContainText("Rewritten by an assistant", { timeout: 20_000 });

  // Publish to the web: anyone can read it without an account, read-only.
  await a.getByRole("button", { name: "Share", exact: true }).click();
  await a.getByRole("dialog").getByRole("combobox", { name: "Who can open the link" }).click();
  await a.getByRole("option", { name: "Anyone on the web with the link" }).click();
  await expect(a.getByRole("dialog").getByText(/Published/)).toBeVisible();
  await a.keyboard.press("Escape");
  const link = (await ops("shares.list", "query", { pageId: page._id })).link as { token: string; public: boolean };
  expect(link.public).toBe(true);
  // Settings → Sharing lists it as shared with Bob and published.
  await a.goto("/home?settings=sharing");
  const sharingSettings = a.getByRole("dialog", { name: "Settings", exact: true });
  await expect(sharingSettings.getByRole("heading", { name: "Sharing" })).toBeVisible();
  await expect(sharingSettings.getByText("Live notes").first()).toBeVisible();
  await expect(sharingSettings.getByText(/1 person: Bob/).first()).toBeVisible();
  await expect(sharingSettings.getByText("Published to the web").first()).toBeVisible();
  await a.keyboard.press("Escape");
  const visitor = await browser.newContext();
  const v = await visitor.newPage();
  await v.goto(`/s/${link.token}/live-notes-${page._id}`);
  await expect(v.getByRole("heading", { name: "Live notes" })).toBeVisible();
  await expect(v.locator(".bn-editor")).toContainText("Rewritten by an assistant");
  await expect(v.locator(".bn-editor")).toHaveAttribute("contenteditable", "false");

  // Bob duplicates the shared page into his own workspace.
  await b.getByRole("button", { name: "Duplicate", exact: true }).click();
  await expect(b).not.toHaveURL(new RegExp(page._id), { timeout: 15_000 });
  await expect(b.locator(".bn-editor")).toContainText("Rewritten by an assistant");
  await expect(b.getByLabel("Page title")).toHaveValue(/Live notes/);
  await expect(b.locator(".bn-editor")).toHaveAttribute("contenteditable", "true");

  await Promise.all([alice.close(), bob.close(), visitor.close()]);
});

test("teamspaces: a shared workspace for a group, in everyone's sidebar", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const alice = await person(browser, baseURL!, "alice");
  const bob = await person(browser, baseURL!, "bob");
  const a = await alice.newPage();
  const b = await bob.newPage();
  await a.goto("/home");
  const teamspaces = a.getByRole("region", { name: "Teamspaces" });
  await teamspaces.getByRole("button", { name: "New teamspace" }).first().click();
  const dialog = a.getByRole("dialog", { name: "New teamspace" });
  await dialog.getByLabel("Name").fill("Book club");
  await dialog.getByLabel("Add people").fill("bob@example.com");
  await dialog.getByRole("button", { name: "Create teamspace" }).click();
  await expect(a.getByLabel("Page title")).toHaveValue("Book club");
  await expect(a.getByRole("tree", { name: "Your teamspaces" }).getByRole("link", { name: /Book club/ })).toBeVisible();
  // It's not listed under Private.
  await expect(a.getByRole("tree", { name: "Pages" }).getByRole("link", { name: /Book club/ })).toHaveCount(0);

  // Bob finds it under Teamspaces (not Shared) and can add pages to it.
  await b.goto("/home");
  const his = b.getByRole("tree", { name: "Teamspaces you're in" });
  await expect(his.getByRole("link", { name: /Book club/ })).toBeVisible();
  await expect(b.getByRole("tree", { name: "Pages shared with you" }).getByRole("link", { name: /Book club/ })).toHaveCount(0);
  await his.getByRole("link", { name: /Book club/ }).click();
  await expect(b.locator(".bn-editor")).toHaveAttribute("contenteditable", "true");
  await Promise.all([alice.close(), bob.close()]);
});

test("invite links: open a teamspace's link and join it", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const alice = await person(browser, baseURL!, "alice");
  const dana = await person(browser, baseURL!, "dana");
  const ops = async (op: string, kind: "query" | "mutation", args: Record<string, unknown>) => (await (await alice.request.post("/api/local/ops", { data: { op, kind, args } })).json()).result;
  const team = (await ops("pages.create", "mutation", { title: "Design crew", teamspace: true })).page as { _id: string };
  const a = await alice.newPage();
  await a.goto(`/p/${team._id}`);
  await a.getByRole("button", { name: "Share", exact: true }).click();
  await a.getByRole("dialog").getByRole("combobox", { name: "Who can open the link" }).click();
  await a.getByRole("option", { name: "Anyone in Max with the link" }).click();
  await expect(a.getByRole("dialog").getByRole("button", { name: "Copy invite link" })).toBeVisible();
  await a.keyboard.press("Escape");

  // Dana opens the link, sees the invitation and joins; the teamspace is in her sidebar from then on.
  const d = await dana.newPage();
  await d.goto(`/p/${team._id}`);
  const invite = d.getByRole("region", { name: "Invitation" });
  await expect(invite).toContainText("Design crew");
  await invite.getByRole("button", { name: "Join teamspace" }).click();
  await expect(invite).toHaveCount(0);
  await expect(d.getByRole("tree", { name: "Teamspaces you're in" }).getByRole("link", { name: /Design crew/ })).toBeVisible();
  // She's listed as a member in the owner's Share menu.
  await a.reload();
  await a.getByRole("button", { name: "Share", exact: true }).click();
  await expect(a.getByRole("dialog").getByRole("listitem").filter({ hasText: "Dana" })).toBeVisible();
  await Promise.all([alice.close(), dana.close()]);
});
