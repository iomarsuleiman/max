import { describe, expect, it } from "vitest";
import { MaxError, serializeError } from "@/lib/domain/errors";
import {
  PAGE_AUTHORIZATION_LIMITS,
  authorizeCollaborationPage,
  filterAuthorizedCollaborationPages,
  type PageAuthorizationContext,
  type PagePolicyReader,
} from "@/lib/domain/collaboration/authorization";
import type {
  CollaborationGroup,
  CollaborationGroupMembership,
  CollaborationMembership,
  CollaborationTeamspace,
  CollaborationWorkspace,
} from "@/lib/domain/collaboration/collaborationStore";
import type { PageCapability, PolicyPage } from "@/lib/domain/collaboration/policy";

const times = { createdAt: 1, updatedAt: 1 };
const userGrant = (userId: string, grant: "view" | "comment" | "edit_content" | "edit" | "full" = "view") => ({
  principal: { kind: "user" as const, userId },
  effect: "allow" as const,
  grant,
  expiresAt: null,
});
const policyPage = (id: string, parentId: string | null = null): PolicyPage => ({
  id,
  workspaceId: "workspace",
  parentId,
  teamspaceId: null,
  access: { mode: "inherit", grants: [] },
});

function fixture() {
  const state: {
    workspace: CollaborationWorkspace | null;
    canonical: CollaborationWorkspace | null;
    member: CollaborationMembership | null;
    groups: CollaborationGroup[];
    groupMemberships: CollaborationGroupMembership[];
    teamspace: CollaborationTeamspace | null;
    pages: Map<string, PolicyPage>;
    pageFailure: Error | null;
    groupFailure: Error | null;
  } = {
    workspace: { id: "workspace", kind: "organization", state: "active", name: "Internal", ...times },
    canonical: null,
    member: { workspaceId: "workspace", userId: "actor", role: "member", state: "active", joinedAt: 1, updatedAt: 1 },
    groups: [],
    groupMemberships: [],
    teamspace: null,
    pages: new Map([
      ["root", { ...policyPage("root"), access: { mode: "inherit", grants: [userGrant("actor", "edit")] } }],
      ["child", policyPage("child", "root")],
    ]),
    pageFailure: null,
    groupFailure: null,
  };
  const reads = { workspace: 0, member: 0, groups: 0, page: 0, teamspace: 0 };
  const copy = <T>(value: T): T => structuredClone(value);
  const pages: PagePolicyReader = {
    getPolicyPage: async (id) => {
      reads.page++;
      if (state.pageFailure) throw state.pageFailure;
      return copy(state.pages.get(id) ?? null);
    },
  };
  const context: PageAuthorizationContext = {
    actor: { userId: "actor", verifiedEmail: null },
    workspaceId: "workspace",
    now: 100,
    pages,
    transaction: {
      getWorkspace: async () => {
        reads.workspace++;
        return copy(state.workspace);
      },
      getPersonalWorkspace: async () => copy(state.canonical),
      getMembership: async () => {
        reads.member++;
        return copy(state.member);
      },
      listUserGroupMemberships: async () => {
        reads.groups++;
        if (state.groupFailure) throw state.groupFailure;
        return copy(state.groupMemberships);
      },
      getGroup: async (id) => copy(state.groups.find((group) => group.id === id) ?? null),
      getTeamspace: async () => {
        reads.teamspace++;
        return copy(state.teamspace);
      },
    },
  };
  const authorize = (pageId = "child", capability: PageCapability = "page.read") => authorizeCollaborationPage({ ...context, pageId, capability });
  return { state, context, reads, authorize };
}

const missing = { code: "NOT_FOUND", message: "This page doesn't exist or was permanently deleted." };

describe("server-resolved page authorization", () => {
  it("loads real ancestry and delegates inherited capabilities to the pure evaluator", async () => {
    const f = fixture();
    expect(await f.authorize("child", "page.edit_content")).toMatchObject({ page: { id: "child" }, grant: "edit" });
    expect(f.reads.page).toBe(2);
    await expect(f.authorize("child", "page.share")).rejects.toMatchObject(missing);
    f.state.pages.set("child", { ...policyPage("child", "root"), access: { mode: "replace", grants: [userGrant("actor", "comment")] } });
    await expect(f.authorize("child", "page.edit_content")).rejects.toMatchObject(missing);
    expect((await f.authorize("child", "page.comment")).grant).toBe("comment");
  });

  it("makes absent, foreign, cyclic, mismatched and revoked requests indistinguishable", async () => {
    const mutations = [
      (f: ReturnType<typeof fixture>) => {
        f.state.pages.delete("child");
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.pages.set("child", { ...policyPage("child"), workspaceId: "foreign" });
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.pages.set("root", policyPage("root", "child"));
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.pages.set("child", policyPage("different"));
      },
      (f: ReturnType<typeof fixture>) => {
        if (f.state.member) f.state.member.state = "revoked";
      },
      (f: ReturnType<typeof fixture>) => {
        if (f.state.member) f.state.member.userId = "someone-else";
      },
      (f: ReturnType<typeof fixture>) => {
        if (f.state.member) f.state.member.workspaceId = "foreign";
      },
      (f: ReturnType<typeof fixture>) => {
        if (f.state.workspace) f.state.workspace.id = "different";
      },
      (f: ReturnType<typeof fixture>) => {
        if (f.state.workspace) f.state.workspace.state = "archived";
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.workspace = null;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.member = null;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.pages.delete("root");
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.pages.set("root", { ...policyPage("root"), workspaceId: "foreign" });
      },
    ];
    for (const mutate of mutations) {
      const f = fixture();
      mutate(f);
      try {
        await f.authorize();
        throw new Error("Expected denial");
      } catch (error) {
        expect(serializeError(error)).toEqual(missing);
      }
    }
  });

  it("rereads membership and expiring grants on every authorization call", async () => {
    const f = fixture();
    await f.authorize();
    if (f.state.member) f.state.member.state = "revoked";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    expect(f.reads.member).toBe(2);
    if (f.state.member) f.state.member.state = "active";
    f.state.pages.set("root", { ...policyPage("root"), access: { mode: "inherit", grants: [{ ...userGrant("actor"), expiresAt: 101 }] } });
    await f.authorize();
    f.context.now = 101;
    await expect(f.authorize()).rejects.toMatchObject(missing);
  });

  it("resolves active groups server-side and honors archive/revocation after initial access", async () => {
    const f = fixture();
    f.state.groups = [{ id: "group", workspaceId: "workspace", name: "Group", state: "active", ...times }];
    f.state.groupMemberships = [{ groupId: "group", workspaceId: "workspace", userId: "actor", state: "active", ...times }];
    f.state.pages.set("root", {
      ...policyPage("root"),
      access: { mode: "inherit", grants: [{ principal: { kind: "group", groupId: "group" }, effect: "allow", grant: "full", expiresAt: null }] },
    });
    expect((await f.authorize("child", "page.share")).grant).toBe("full");
    f.state.groups[0].state = "archived";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.groups[0].state = "active";
    f.state.groupMemberships[0].state = "revoked";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.groupMemberships[0].state = "active";
    f.state.groupMemberships.push({ ...f.state.groupMemberships[0], state: "revoked" });
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.groupMemberships.pop();
    f.state.groups[0].workspaceId = "foreign";
    await expect(f.authorize()).rejects.toMatchObject(missing);
  });

  it("ignores caller role/group claims and denies dangling or mismatched stored groups", async () => {
    const f = fixture();
    f.state.pages.set("root", {
      ...policyPage("root"),
      access: { mode: "inherit", grants: [{ principal: { kind: "group", groupId: "group" }, effect: "allow", grant: "full", expiresAt: null }] },
    });
    const actorWithClaims = { ...f.context.actor, role: "owner", groups: ["group"] };
    await expect(authorizeCollaborationPage({ ...f.context, actor: actorWithClaims, pageId: "child", capability: "page.read" })).rejects.toMatchObject(missing);
    f.state.groupMemberships = [{ groupId: "group", workspaceId: "workspace", userId: "actor", state: "active", ...times }];
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.groups = [{ id: "group", workspaceId: "workspace", name: "Group", state: "active", ...times }];
    await f.authorize();
    f.state.groupMemberships[0].userId = "someone-else";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.groupMemberships[0].userId = "actor";
    f.state.groupMemberships[0].workspaceId = "foreign";
    await expect(f.authorize()).rejects.toMatchObject(missing);
  });

  it("preserves ancestor-deny precedence rather than overriding it with a child grant", async () => {
    const f = fixture();
    f.state.pages.set("root", {
      ...policyPage("root"),
      access: { mode: "inherit", grants: [{ principal: { kind: "user", userId: "actor" }, effect: "deny" }] },
    });
    f.state.pages.set("child", { ...policyPage("child", "root"), access: { mode: "replace", grants: [userGrant("actor", "full")] } });
    await expect(f.authorize()).rejects.toMatchObject(missing);
  });

  it("enforces private teamspace admission without owner/admin or page-grant bypass", async () => {
    const f = fixture();
    f.state.teamspace = {
      id: "team",
      workspaceId: "workspace",
      name: "Private",
      state: "active",
      visibility: "private",
      defaultGrant: "view",
      memberUserIds: [],
      memberGroupIds: [],
      managerUserIds: [],
      ...times,
    };
    for (const [id, p] of f.state.pages) f.state.pages.set(id, { ...p, teamspaceId: "team" });
    if (f.state.member) f.state.member.role = "owner";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.teamspace.memberUserIds = ["actor"];
    await f.authorize();
    f.state.teamspace.state = "archived";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.teamspace.state = "active";
    f.state.teamspace.workspaceId = "foreign";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.teamspace.workspaceId = "workspace";
    f.state.pages.set("root", { ...policyPage("root"), teamspaceId: "other" });
    await expect(f.authorize()).rejects.toMatchObject(missing);
  });

  it("uses fresh group state for private-teamspace admission too", async () => {
    const f = fixture();
    f.state.groups = [{ id: "group", workspaceId: "workspace", name: "Group", state: "active", ...times }];
    f.state.groupMemberships = [{ groupId: "group", workspaceId: "workspace", userId: "actor", state: "active", ...times }];
    f.state.teamspace = {
      id: "team",
      workspaceId: "workspace",
      name: "Private",
      state: "active",
      visibility: "private",
      defaultGrant: "view",
      memberUserIds: [],
      memberGroupIds: ["group"],
      managerUserIds: [],
      ...times,
    };
    for (const [id, p] of f.state.pages) f.state.pages.set(id, { ...p, teamspaceId: "team" });
    await f.authorize();
    f.state.groups[0].state = "archived";
    await expect(f.authorize()).rejects.toMatchObject(missing);
  });

  it("preserves immutable personal ownership and canonical owner mapping", async () => {
    const f = fixture();
    f.state.workspace = { id: "workspace", kind: "personal", ownerId: "actor", state: "active", name: "Personal", ...times };
    f.state.canonical = structuredClone(f.state.workspace);
    if (f.state.member) f.state.member.role = "owner";
    await f.authorize();
    f.state.canonical.id = "another-personal-workspace";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.canonical.id = "workspace";
    f.state.workspace.ownerId = "someone-else";
    await expect(f.authorize()).rejects.toMatchObject(missing);
    f.state.workspace.ownerId = "actor";
    if (f.state.member) f.state.member.role = "admin";
    await expect(f.authorize()).rejects.toMatchObject(missing);
  });

  it("matches the evaluator's 100-ancestor boundary and hides overdeep pages like absent IDs", async () => {
    const f = fixture();
    const makePath = (length: number) => {
      f.state.pages.clear();
      for (let i = 0; i < length; i++)
        f.state.pages.set(`p${i}`, {
          ...policyPage(`p${i}`, i + 1 < length ? `p${i + 1}` : null),
          access: { mode: "inherit", grants: i + 1 === length ? [userGrant("actor")] : [] },
        });
    };
    makePath(PAGE_AUTHORIZATION_LIMITS.ancestors);
    await f.authorize("p0");
    makePath(PAGE_AUTHORIZATION_LIMITS.ancestors + 1);
    await expect(f.authorize("p0")).rejects.toMatchObject(missing);
    await expect(f.authorize("absent")).rejects.toMatchObject(missing);
    f.state.pages.set("visible", { ...policyPage("visible"), access: { mode: "inherit", grants: [userGrant("actor")] } });
    const result = await filterAuthorizedCollaborationPages({ ...f.context, pageIds: ["p0", "absent", "visible"], capability: "page.read" });
    expect(result.map((item) => item.page.id)).toEqual(["visible"]);
  });

  it("filters only NOT_FOUND and returns no hidden IDs/counts/titles, with no stale request cache", async () => {
    const f = fixture();
    f.state.pages.set("hidden", policyPage("hidden"));
    const input = { ...f.context, pageIds: ["child", "hidden", "absent", "child"], capability: "page.read" } satisfies Parameters<
      typeof filterAuthorizedCollaborationPages
    >[0];
    const result = await filterAuthorizedCollaborationPages(input);
    expect(result.map((item) => item.page.id)).toEqual(["child"]);
    expect(result).not.toHaveProperty("hiddenCount");
    if (f.state.member) f.state.member.state = "revoked";
    await expect(filterAuthorizedCollaborationPages(input)).rejects.toMatchObject(missing);
  });

  it("propagates adapter invariant/limit errors and independently bounds list sizes and clock", async () => {
    const f = fixture();
    const input = { ...f.context, pageIds: ["child"], capability: "page.read" } satisfies Parameters<typeof filterAuthorizedCollaborationPages>[0];
    for (const failure of [new Error("Duplicate policy row"), new MaxError("INTERNAL", "Duplicate membership"), new MaxError("LIMIT", "Adapter read limit")]) {
      f.state.pageFailure = failure;
      await expect(filterAuthorizedCollaborationPages(input)).rejects.toBe(failure);
    }
    f.state.pageFailure = null;
    await expect(
      filterAuthorizedCollaborationPages({ ...input, pageIds: Array.from({ length: PAGE_AUTHORIZATION_LIMITS.discoveryCandidates + 1 }, () => "child") }),
    ).rejects.toMatchObject({ code: "LIMIT" });
    f.state.groupFailure = new MaxError("LIMIT", "Groups exceed indexed bound");
    await expect(f.authorize()).rejects.toBe(f.state.groupFailure);
    f.state.groupFailure = null;
    f.state.groupMemberships = Array.from({ length: 201 }, (_, i) => ({
      groupId: `g${i}`,
      workspaceId: "workspace",
      userId: "actor",
      state: "active",
      ...times,
    }));
    await expect(f.authorize()).rejects.toMatchObject({ code: "LIMIT" });
    f.state.groupMemberships = [];
    f.context.now = Number.NaN;
    await expect(f.authorize()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
