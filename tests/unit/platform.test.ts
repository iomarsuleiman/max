import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { execute } from "@/lib/domain/ops";
import { resolveScope } from "@/lib/domain/workspaces";
import * as orgs from "@/lib/domain/organizations";
import * as apps from "@/lib/domain/integrations";

const person = (id: string): orgs.OrgActor => ({ id, name: id, image: null, email: `${id}@example.com`, emailVerified: true });

function world() {
  const h = setup();
  let clock = Date.UTC(2026, 10, 21);
  const now = () => (clock += 1000);
  const op = async <T = any>(who: string, ws: string | undefined, name: string, args: Record<string, unknown> = {}) => {
    const scope = await resolveScope(h.db, who, ws);
    const ctx = { db: h.db, storage: h.storage, ownerId: scope.ownerId, now: now(), source: "ui" as const, outbox: { queued: 0 }, ...(scope.org ? { org: { role: scope.org.role }, actor: { id: who, name: who, image: null } } : {}) };
    return h.db.transaction(() => execute(name, args, ctx)) as Promise<T>;
  };
  /** Calls an operation as a connected app, the way /api/v1/ops does. */
  const asApp = async <T = any>(token: string, name: string, args: Record<string, unknown> = {}) => {
    const app = await apps.appForToken(h.db, token);
    if (!app) throw new Error("UNAUTHENTICATED");
    const ctx = { db: h.db, storage: h.storage, ownerId: app.ownerId, now: now(), source: "app" as const, actor: app.actor, appScopes: app.scopes, outbox: { queued: 0 }, ...(app.ownerId.startsWith("org_") ? { org: { role: "member" as const } } : {}) };
    return h.db.transaction(() => execute(name, args, ctx)) as Promise<T>;
  };
  const join = async (ns: string, owner: string, who: string) => {
    await orgs.inviteMembers(h.db, person(owner), ns, [`${who}@example.com`], "member", now());
    const [invite] = await orgs.myInvitations(h.db, person(who), now());
    await orgs.acceptInvite(h.db, person(who), invite.id, now());
  };
  return { h, now, op, asApp, join };
}

describe("connectors", () => {
  it("gives apps only what was granted, never private pages, and signs webhooks", async () => {
    const { h, now, op, asApp } = world();
    const { id: acme } = await orgs.createOrganization(h.db, person("ann"), { name: "Acme" }, now());
    const { page: open } = await op("ann", acme, "pages.create", { title: "Roadmap" });
    const { page: secret } = await op("ann", acme, "pages.create", { title: "Salaries" });
    await op("ann", acme, "access.set", { pageId: secret._id, memberIds: ["ann"] });

    // A developer registers an app with webhooks; it isn't public until reviewed.
    const created = await apps.createIntegration(h.db, "dev", { name: "Sync", description: "Syncs pages to a calendar.", scopes: ["read_content", "write_content"], redirectUris: ["https://sync.example.com/cb"], webhookUrl: "https://sync.example.com/hook", events: ["page.created"] }, now());
    await expect(apps.install(h.db, { id: "ann", name: "Ann" }, { appId: created.clientId, workspace: acme, scopes: ["read_content"] }, now())).rejects.toThrow();
    await apps.reviewIntegration(h.db, { id: "root" }, created.clientId, "published", "", now());

    // OAuth: approve read-only, exchange the one-time code for a token.
    const { redirect } = await apps.install(h.db, { id: "ann", name: "Ann" }, { appId: created.clientId, workspace: acme, scopes: ["read_content"], redirectUri: "https://sync.example.com/cb", state: "xyz" }, now());
    const code = new URL(redirect!).searchParams.get("code")!;
    await expect(apps.exchangeCode(h.db, { clientId: created.clientId, clientSecret: "wrong", code }, now())).rejects.toThrow();
    const { access_token } = await apps.exchangeCode(h.db, { clientId: created.clientId, clientSecret: created.clientSecret, code }, now());
    await expect(apps.exchangeCode(h.db, { clientId: created.clientId, clientSecret: created.clientSecret, code }, now())).rejects.toThrow();

    const titles = (await asApp(access_token, "pages.tree")).pages.map((p: { title: string }) => p.title);
    expect(titles).toContain("Roadmap");
    expect(titles).not.toContain("Salaries");
    await expect(asApp(access_token, "pages.get", { id: secret._id })).rejects.toThrow();
    await expect(asApp(access_token, "pages.create", { title: "x" })).rejects.toThrow(/permission/);
    await expect(asApp(access_token, "shares.invite", { pageId: open._id, granteeId: "x", level: "view" })).rejects.toThrow(/can't use/);
    await expect(asApp(access_token, "batch", { operations: [] })).rejects.toThrow();

    // A member's change queues a signed webhook (ids only, never content).
    const before = (await h.db.findBy("webhookDeliveries", "status", "pending")).length;
    await op("ann", acme, "pages.create", { title: "Launch" });
    const queued = await h.db.findBy("webhookDeliveries", "status", "pending");
    expect(queued.length).toBe(before + 1);
    expect(queued.at(-1)!.payload).not.toContain("Launch");
    expect(await apps.signPayload("whsec_x", 1, "{}")).toMatch(/^t=1,v1=[a-f0-9]{64}$/);

    // Suspended by Max's admins: stops working at once.
    await apps.reviewIntegration(h.db, { id: "root" }, created.clientId, "suspended", "Abuse", now());
    expect(await apps.appForToken(h.db, access_token)).toBeNull();
  });

  it("refuses webhook and redirect addresses that point inside the network", () => {
    for (const bad of ["http://example.com/x", "https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://db.internal/x", "https://user:pw@example.com/x"]) expect(() => apps.safeUrl(bad, "webhook")).toThrow();
    expect(apps.safeUrl("https://hooks.example.com/max", "webhook")).toBe("https://hooks.example.com/max");
    expect(apps.safeUrl("http://localhost:3000/cb", "redirect")).toBe("http://localhost:3000/cb");
  });
});

describe("collaboration", () => {
  it("runs automations once, notifies assignees and mentions, and reviews with separation of duty", async () => {
    const { h, now, op, join } = world();
    const { id: acme } = await orgs.createOrganization(h.db, person("ann"), { name: "Acme" }, now());
    await join(acme, "ann", "bob");
    const { database } = await op("ann", acme, "databases.create", { title: "Tasks" });
    const owner = (await op("ann", acme, "properties.add", { databaseId: database._id, name: "Owner", type: "person" })).property;
    const done = (await op("ann", acme, "properties.add", { databaseId: database._id, name: "Done", type: "checkbox" })).property;
    const when = (await op("ann", acme, "properties.add", { databaseId: database._id, name: "Finished", type: "date" })).property;
    await op("ann", acme, "automations.save", { databaseId: database._id, automation: { name: "Done → stamp", trigger: { type: "changed", propertyId: done.id, to: true }, actions: [{ type: "set_now", propertyId: when.id }, { type: "notify", to: "assignees", message: "Finished" }] } });

    const { record } = await op("ann", acme, "records.create", { databaseId: database._id, title: "Ship it", values: { Owner: ["bob"] } });
    expect((await op("bob", acme, "inbox.list")).notifications[0]).toMatchObject({ kind: "assigned", pageId: record._id });
    await expect(op("ann", acme, "records.update", { id: record._id, values: { Owner: ["stranger"] } })).rejects.toThrow(/member/);
    await op("ann", acme, "records.update", { id: record._id, values: { Done: true } });
    const row = (await op("ann", acme, "pages.get", { id: record._id })).page;
    expect(row.values[when.id]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await op("ann", acme, "automations.list", { databaseId: database._id })).automations[0].runs).toBe(1);

    // Comments: a mention notifies, a reply joins the thread.
    const { page } = await op("ann", acme, "pages.create", { title: "Spec" });
    const { comment } = await op("ann", acme, "comments.add", { pageId: page._id, body: "@bob thoughts?", mentions: ["bob"] });
    expect((await op("bob", acme, "inbox.list")).notifications[0]).toMatchObject({ kind: "mention" });
    await op("bob", acme, "comments.add", { pageId: page._id, body: "Looks good", parentId: comment._id });
    await op("bob", acme, "comments.react", { id: comment._id, emoji: "👍" });
    expect((await op("ann", acme, "inbox.list")).notifications[0]).toMatchObject({ kind: "comment" });

    // Reviews: the requester can't approve their own; a suggestion is applied when accepted.
    const { approval } = await op("ann", acme, "approvals.request", { pageId: page._id, reviewers: ["bob"] });
    await expect(op("ann", acme, "approvals.decide", { id: approval._id, decision: "approved" })).rejects.toThrow();
    expect((await op("bob", acme, "approvals.decide", { id: approval._id, decision: "approved" })).status).toBe("approved");
    const doc = await op("bob", acme, "documents.get", { pageId: page._id });
    const s = await op("bob", acme, "approvals.suggest", { pageId: page._id, baseRevision: doc.revision, reviewers: ["ann"], blocks: [{ type: "paragraph", content: "Suggested text" }] });
    await op("ann", acme, "approvals.decide", { id: s.approval._id, decision: "approved" });
    expect(JSON.stringify((await op("ann", acme, "documents.get", { pageId: page._id })).blocks)).toContain("Suggested text");
  });
});
