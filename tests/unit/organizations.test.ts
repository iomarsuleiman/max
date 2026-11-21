import { describe, expect, it } from "vitest";
import { setup } from "./harness";
import { execute } from "@/lib/domain/ops";
import { resolveScope } from "@/lib/domain/workspaces";
import * as orgs from "@/lib/domain/organizations";
import { adminOrganization, adminOverview, recoverOrgOwnership, setOrgModeration } from "@/lib/domain/admin";
import { joinRoom } from "@/lib/domain/collab";
import { resolveAccess } from "@/lib/domain/sharing";

const person = (id: string, verified = true): orgs.OrgActor => ({ id, name: id, image: null, email: `${id}@example.com`, emailVerified: verified });

function world() {
  const h = setup();
  let clock = Date.UTC(2026, 10, 21);
  const now = () => (clock += 1000);
  /** Runs an op the way the transports do: resolve the requested workspace, then execute. */
  const op = async <T = any>(who: string, ws: string | undefined, name: string, args: Record<string, unknown> = {}) => {
    const scope = await resolveScope(h.db, who, ws);
    const ctx = { db: h.db, storage: h.storage, ownerId: scope.ownerId, now: now(), source: "ui" as const, ...(scope.org ? { org: { role: scope.org.role }, actor: { id: who, name: who, image: null } } : {}) };
    return h.db.transaction(() => execute(name, args, ctx)) as Promise<T>;
  };
  const join = async (ns: string, owner: string, who: string, role: "admin" | "member" | "guest" = "member") => {
    await orgs.inviteMembers(h.db, person(owner), ns, [`${who}@example.com`], role, now());
    const [invite] = await orgs.myInvitations(h.db, person(who), now());
    await orgs.acceptInvite(h.db, person(who), invite.id, now());
  };
  return { h, now, op, join };
}

describe("organizations", () => {
  it("keeps content inside the organization, for members only, across every path", async () => {
    const { h, now, op, join } = world();
    const { id: acme } = await orgs.createOrganization(h.db, person("ann"), { name: "Acme" }, now());
    const { id: other } = await orgs.createOrganization(h.db, person("zed"), { name: "Other Co" }, now());
    await join(acme, "ann", "bob");

    const { page } = await op(ann(), acme, "pages.create", { title: "Plan" });
    expect(page.ownerId).toBe(acme);
    // Bob (member) reads and edits; the page is live-edited and he can join its room.
    await op("bob", acme, "pages.update", { id: page._id, title: "Plan v2" });
    expect((await op("bob", acme, "pages.get", { id: page._id })).isShared).toBe(true);
    expect((await resolveAccess(h.db, "bob", page._id)).level).toBe("owner");
    await joinRoom({ db: h.db, actor: { id: "bob", name: "Bob", image: null }, now: now() }, page._id, "c1");

    // Strangers and other organizations' members get the same "missing" answer as a deleted org.
    await expect(op("zed", acme, "pages.tree")).rejects.toThrow(/no longer a member/);
    await expect(op("bob", other, "pages.tree")).rejects.toThrow(/no longer a member/);
    await expect(resolveAccess(h.db, "zed", page._id)).rejects.toThrow();
    // A page id from Acme can't be reached from another namespace either.
    await expect(op("zed", other, "pages.get", { id: page._id })).rejects.toThrow();

    // Account-level operations act on the caller's own account, never the organization.
    await op("bob", acme, "tokens.create", { name: "cli" });
    expect(await h.db.list("tokens", acme)).toHaveLength(0);
    await expect(op("bob", acme, "account.deleteAllData", { confirm: true })).rejects.toThrow(/inside an organization/);
    // Sidebar prefs are per person, per organization.
    await op("bob", acme, "settings.update", { sidebarWidth: 300 });
    expect((await op("bob", undefined, "settings.get")).settings.sidebarWidth).not.toBe(300);
    expect((await op("bob", acme, "settings.get")).settings.sidebarWidth).toBe(300);

    // Admin-only operations, even inside a batch.
    await expect(op("bob", acme, "trash.empty", { confirm: true })).rejects.toThrow(/admins/);
    await expect(op("bob", acme, "batch", { operations: [{ op: "trash.empty", args: { confirm: true } }] })).rejects.toThrow(/admins/);

    // Removal takes effect on the very next call, live room included.
    await orgs.removeMember(h.db, person("ann"), acme, "bob", now());
    await expect(op("bob", acme, "pages.get", { id: page._id })).rejects.toThrow(/no longer a member/);
    await expect(joinRoom({ db: h.db, actor: { id: "bob", name: "Bob", image: null }, now: now() }, page._id, "c2")).rejects.toThrow();
    expect((await op("bob", undefined, "workspaces.list")).workspaces.some((w: { id: string }) => w.id === acme)).toBe(false);
  });

  it("binds invitations to a verified email, and guests only see what is shared with them", async () => {
    const { h, now, op, join } = world();
    const { id: acme } = await orgs.createOrganization(h.db, person("ann"), { name: "Acme" }, now());
    await orgs.inviteMembers(h.db, person("ann"), acme, ["cy@example.com"], "member", now());
    const [invite] = await orgs.myInvitations(h.db, person("cy"), now());
    // Someone else, or the same address unverified, can't answer it.
    await expect(orgs.acceptInvite(h.db, person("eve"), invite.id, now())).rejects.toThrow(/doesn't exist/);
    expect(await orgs.myInvitations(h.db, person("cy", false), now())).toEqual([]);
    await expect(orgs.acceptInvite(h.db, person("cy", false), invite.id, now())).rejects.toThrow();
    await orgs.acceptInvite(h.db, person("cy"), invite.id, now());
    await expect(orgs.acceptInvite(h.db, person("cy"), invite.id, now())).rejects.toThrow(/already answered/);

    await join(acme, "ann", "gus", "guest");
    await expect(op("gus", acme, "pages.tree")).rejects.toThrow(/no longer a member/);
    const { page } = await op(ann(), acme, "pages.create", { title: "Shared spec" });
    await op(ann(), acme, "shares.invite", { pageId: page._id, granteeId: "gus", level: "view" });
    expect((await resolveAccess(h.db, "gus", page._id)).level).toBe("view");
    // Policy: no outside sharing once guests are turned off; no web links by default.
    await expect(op(ann(), acme, "shares.setLink", { pageId: page._id, level: "view", web: true })).rejects.toThrow(/web/);
    await orgs.setPolicies(h.db, person("ann"), acme, { allowGuests: false }, now());
    await expect(op(ann(), acme, "shares.invite", { pageId: page._id, granteeId: "stranger", level: "view" })).rejects.toThrow(/outside/);
  });

  it("enforces who manages whom, keeps one owner, and records it all", async () => {
    const { h, now, join } = world();
    const { id: acme } = await orgs.createOrganization(h.db, person("ann"), { name: "Acme" }, now());
    await join(acme, "ann", "ada", "admin");
    await join(acme, "ann", "bob");
    await expect(orgs.setMemberRole(h.db, person("ada"), acme, "bob", "admin", now())).rejects.toThrow(/owner/);
    await expect(orgs.removeMember(h.db, person("ada"), acme, "ann", now())).rejects.toThrow(/ownership transfer/);
    await expect(orgs.setMemberRole(h.db, person("bob"), acme, "ada", "member", now())).rejects.toThrow(/admins/);
    await expect(orgs.leaveOrganization(h.db, person("ann"), acme, now())).rejects.toThrow(/Transfer ownership/);
    await expect(orgs.transferOwnership(h.db, person("ann"), acme, "bob", "wrong", now())).rejects.toThrow(/name/);
    await orgs.transferOwnership(h.db, person("ann"), acme, "bob", "Acme", now());
    expect((await orgs.memberOf(h.db, acme, "ann"))?.role).toBe("admin");
    expect((await orgs.memberOf(h.db, acme, "bob"))?.role).toBe("owner");
    const { events } = await orgs.orgAuditLog(h.db, person("bob"), acme, {});
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(["org.created", "invite.sent", "member.joined", "owner.transferred"]));
  });

  it("gives platform admins the whole picture and control, without page contents", async () => {
    const { h, now, op, join } = world();
    const { id: acme } = await orgs.createOrganization(h.db, person("ann"), { name: "Acme" }, now());
    await join(acme, "ann", "bob");
    await op(ann(), acme, "pages.create", { title: "Secret plan" });
    expect((await adminOverview(h.db, now())).totals).toMatchObject({ organizations: 1, orgMembers: 2 });
    const detail = await adminOrganization(h.db, acme, now());
    expect(detail.members.map((m) => m.accountId)).toEqual(["ann", "bob"]);
    expect(detail.stats.pages).toBe(1);
    expect(JSON.stringify(detail)).not.toContain("Secret plan");

    await setOrgModeration(h.db, { id: "root" }, acme, "suspended", "Billing review", now());
    await op("bob", acme, "pages.tree");
    await expect(op("bob", acme, "pages.create", { title: "x" })).rejects.toThrow(/read-only/);
    await setOrgModeration(h.db, { id: "root" }, acme, "banned", "Abuse", now());
    await expect(op("bob", acme, "pages.tree")).rejects.toThrow(/no longer available/);
    await setOrgModeration(h.db, { id: "root" }, acme, "active", "", now());
    await recoverOrgOwnership(h.db, { id: "root" }, acme, "bob", "Owner left the company", now());
    expect((await orgs.memberOf(h.db, acme, "bob"))?.role).toBe("owner");
  });
});

const ann = () => "ann";
