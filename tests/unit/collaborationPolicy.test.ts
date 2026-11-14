import { describe, expect, it } from "vitest";
import {
  canChangeMembership,
  canDuplicatePage,
  canMovePage,
  canPage,
  canWorkspace,
  evaluatePageAccess,
  type AccessGrant,
  type PageCapability,
  type PageGrant,
  type PolicyPage,
  type PolicySnapshot,
  type WorkspaceMembership,
  type WorkspaceRole,
} from "@/lib/domain/collaboration/policy";

const actor: WorkspaceMembership = { workspaceId: "org", userId: "alice", role: "member", state: "active" };
const allow = (grant: PageGrant, userId = "alice"): AccessGrant => ({ principal: { kind: "user", userId }, effect: "allow", grant, expiresAt: null });
const deny: AccessGrant = { principal: { kind: "user", userId: "alice" }, effect: "deny" };
const page = (id: string, overrides: Partial<PolicyPage> = {}): PolicyPage => ({
  id,
  workspaceId: "org",
  parentId: null,
  teamspaceId: null,
  access: { mode: "inherit", grants: [] },
  ...overrides,
});
const snapshot = (overrides: Partial<PolicySnapshot> = {}): PolicySnapshot => ({
  workspace: { id: "org", kind: "organization", state: "active" },
  userId: "alice",
  membership: actor,
  groupMemberships: [],
  teamspaces: [],
  pages: [page("root")],
  now: 1_000,
  ...overrides,
});

const capabilities: readonly PageCapability[] = [
  "page.read",
  "page.export",
  "page.comment",
  "page.edit_content",
  "page.edit_metadata",
  "page.create_child",
  "page.move",
  "page.archive",
  "page.restore",
  "page.share",
  "database.edit_values",
  "database.edit_schema",
  "history.restore",
];
const matrix: readonly { grant: PageGrant; permitted: readonly PageCapability[] }[] = [
  { grant: "view", permitted: ["page.read", "page.export"] },
  { grant: "comment", permitted: ["page.read", "page.export", "page.comment"] },
  { grant: "edit_content", permitted: ["page.read", "page.export", "page.comment", "page.edit_content", "database.edit_values"] },
  { grant: "edit", permitted: capabilities.filter((capability) => capability !== "page.share" && capability !== "page.move") },
  { grant: "full", permitted: capabilities },
];

describe("collaboration capability policy contract", () => {
  for (const row of matrix) {
    describe(`${row.grant} grant`, () => {
      for (const capability of capabilities) {
        it(`${row.permitted.includes(capability) ? "permits" : "rejects"} ${capability}`, () => {
          const state = snapshot({ pages: [page("root", { access: { mode: "inherit", grants: [allow(row.grant)] } })] });
          expect(canPage(state, "root", capability)).toBe(row.permitted.includes(capability));
        });
      }
    });
  }

  it.each<WorkspaceRole>(["owner", "admin", "member", "guest"])("does not grant organization content from the %s role alone", (role) => {
    const state = snapshot({ membership: { ...actor, role } });
    expect(evaluatePageAccess(state, "root")).toEqual({ allowed: false });
  });

  it("preserves a personal owner's full access, without admitting non-owners", () => {
    const state = snapshot({ workspace: { id: "org", kind: "personal", state: "active", ownerId: "alice" }, membership: { ...actor, role: "owner" } });
    expect(canPage(state, "root", "page.share")).toBe(true);
    for (const role of ["admin", "member", "guest"] satisfies WorkspaceRole[]) {
      expect(canPage({ ...state, membership: { ...actor, role } }, "root", "page.read")).toBe(false);
    }
    const mismatchedOwner = { ...state, userId: "bob", membership: { ...actor, userId: "bob", role: "owner" } } satisfies PolicySnapshot;
    expect(canPage(mismatchedOwner, "root", "page.read")).toBe(false);
    expect(canWorkspace(mismatchedOwner, "workspace.delete")).toBe(false);
  });

  it("inherits page access and reports its source", () => {
    const state = snapshot({
      pages: [page("root", { access: { mode: "inherit", grants: [allow("edit")] } }), page("child", { parentId: "root" }), page("leaf", { parentId: "child" })],
    });
    expect(evaluatePageAccess(state, "leaf")).toEqual({ allowed: true, grant: "edit", source: { kind: "page", pageId: "root" } });
  });

  it("starts a restricted subtree with replace and permits explicit lower grants", () => {
    const state = snapshot({
      pages: [
        page("root", { access: { mode: "inherit", grants: [allow("full")] } }),
        page("private", { parentId: "root", access: { mode: "replace", grants: [allow("comment")] } }),
        page("leaf", { parentId: "private" }),
      ],
    });
    expect(canPage(state, "leaf", "page.comment")).toBe(true);
    expect(canPage(state, "leaf", "page.edit_content")).toBe(false);
    expect(
      canPage(
        { ...state, pages: state.pages.map((node) => (node.id === "private" ? { ...node, access: { mode: "replace", grants: [] } } : node)) },
        "leaf",
        "page.read",
      ),
    ).toBe(false);
  });

  it("adds grants monotonically within an inherited scope, regardless of order", () => {
    for (const grants of [
      [allow("full"), allow("view")],
      [allow("view"), allow("full")],
    ]) {
      expect(canPage(snapshot({ pages: [page("root", { access: { mode: "inherit", grants } })] }), "root", "page.share")).toBe(true);
    }
  });

  it("lets explicit child sharing grant access without exposing an unshared parent", () => {
    const state = snapshot({ pages: [page("root"), page("child", { parentId: "root", access: { mode: "inherit", grants: [allow("view")] } })] });
    expect(canPage(state, "child", "page.read")).toBe(true);
    expect(canPage(state, "root", "page.read")).toBe(false);
  });

  it("gives explicit denies precedence over any grant order and descendant replace", () => {
    for (const grants of [
      [deny, allow("full")],
      [allow("full"), deny],
    ]) {
      const state = snapshot({
        pages: [
          page("root", { access: { mode: "inherit", grants } }),
          page("child", { parentId: "root", access: { mode: "replace", grants: [allow("full")] } }),
        ],
      });
      expect(evaluatePageAccess(state, "root")).toEqual({ allowed: false });
      expect(evaluatePageAccess(state, "child")).toEqual({ allowed: false });
    }
  });

  it("matches only the current user and active groups in the current workspace", () => {
    const groupGrant: AccessGrant = { principal: { kind: "group", groupId: "editors" }, effect: "allow", grant: "full", expiresAt: null };
    const state = snapshot({
      pages: [page("root", { access: { mode: "inherit", grants: [allow("full", "bob"), groupGrant] } })],
      groupMemberships: [
        { workspaceId: "other", userId: "alice", groupId: "editors", state: "active" },
        { workspaceId: "org", userId: "bob", groupId: "editors", state: "active" },
      ],
    });
    expect(canPage(state, "root", "page.read")).toBe(false);
    const active = { workspaceId: "org", userId: "alice", groupId: "editors", state: "active" } satisfies PolicySnapshot["groupMemberships"][number];
    expect(canPage({ ...state, groupMemberships: [...state.groupMemberships, active] }, "root", "page.share")).toBe(true);
    expect(canPage({ ...state, groupMemberships: [active, { ...active, state: "revoked" }] }, "root", "page.read")).toBe(false);
  });

  it("excludes guests from broad workspace grants while permitting direct guest grants", () => {
    const broad: AccessGrant = { principal: { kind: "workspace_members" }, effect: "allow", grant: "full", expiresAt: null };
    const pages = [page("root", { access: { mode: "inherit", grants: [broad] } })];
    expect(canPage(snapshot({ pages }), "root", "page.share")).toBe(true);
    const state = snapshot({ pages, membership: { ...actor, role: "guest" } });
    expect(canPage(state, "root", "page.read")).toBe(false);
    expect(canPage({ ...state, pages: [page("root", { access: { mode: "inherit", grants: [broad, allow("view")] } })] }, "root", "page.read")).toBe(true);
  });

  it.each([null, { ...actor, state: "revoked" }, { ...actor, userId: "bob" }, { ...actor, workspaceId: "other" }] satisfies (WorkspaceMembership | null)[])(
    "rejects missing, revoked and mismatched membership even with full grants: %j",
    (membership) => {
      const state = snapshot({ membership, pages: [page("root", { access: { mode: "inherit", grants: [allow("full")] } })] });
      expect(evaluatePageAccess(state, "root")).toEqual({ allowed: false });
      expect(canWorkspace(state, "workspace.manage_members")).toBe(false);
    },
  );

  it("takes revocation into account on the next evaluation without a cache", () => {
    const state = snapshot({ pages: [page("root", { access: { mode: "inherit", grants: [allow("full")] } })] });
    expect(canPage(state, "root", "page.edit_content")).toBe(true);
    expect(canPage({ ...state, membership: { ...actor, state: "revoked" } }, "root", "page.edit_content")).toBe(false);
    expect(canPage({ ...state, workspace: { ...state.workspace, state: "archived" } }, "root", "page.read")).toBe(false);
  });

  it.each([999, 1000, Number.NaN, Number.POSITIVE_INFINITY])("expires or rejects nonfinite grants at %s", (expiresAt) => {
    const state = snapshot({
      pages: [page("root", { access: { mode: "inherit", grants: [{ ...allow("full"), effect: "allow", grant: "full", expiresAt }] } })],
    });
    expect(canPage(state, "root", "page.read")).toBe(false);
  });

  it("accepts a future grant and rejects a nonfinite policy clock", () => {
    const grant: AccessGrant = { principal: { kind: "user", userId: "alice" }, effect: "allow", grant: "view", expiresAt: 1001 };
    const state = snapshot({ pages: [page("root", { access: { mode: "inherit", grants: [grant] } })] });
    expect(canPage(state, "root", "page.read")).toBe(true);
    expect(canPage({ ...state, now: Number.NaN }, "root", "page.read")).toBe(false);
  });
});

describe("teamspace boundary", () => {
  const teamspace = {
    id: "team",
    workspaceId: "org",
    visibility: "open",
    memberUserIds: [],
    memberGroupIds: [],
    defaultGrant: "edit",
  } satisfies PolicySnapshot["teamspaces"][number];
  const state = snapshot({ pages: [page("root", { teamspaceId: "team" })], teamspaces: [teamspace] });

  it.each<WorkspaceRole>(["owner", "admin", "member"])("admits %s to open content", (role) => {
    expect(canPage({ ...state, membership: { ...actor, role } }, "root", "page.edit_content")).toBe(true);
  });

  it.each(["closed", "private"] satisfies PolicySnapshot["teamspaces"][number]["visibility"][])(
    "requires membership in %s teamspaces even for an owner",
    (visibility) => {
      const closed = { ...state, teamspaces: [{ ...teamspace, visibility }], membership: { ...actor, role: "owner" } } satisfies PolicySnapshot;
      expect(canPage(closed, "root", "page.read")).toBe(false);
      expect(canPage({ ...closed, teamspaces: [{ ...teamspace, visibility, memberUserIds: ["alice"] }] }, "root", "page.read")).toBe(true);
    },
  );

  it("uses only active current-workspace group membership for teamspace admission", () => {
    const closed = { ...state, teamspaces: [{ ...teamspace, visibility: "private", memberGroupIds: ["team-group"] }] } satisfies PolicySnapshot;
    const group = { workspaceId: "org", userId: "alice", groupId: "team-group", state: "active" } satisfies PolicySnapshot["groupMemberships"][number];
    expect(canPage({ ...closed, groupMemberships: [group] }, "root", "page.read")).toBe(true);
    expect(canPage({ ...closed, groupMemberships: [{ ...group, state: "revoked" }] }, "root", "page.read")).toBe(false);
    expect(canPage({ ...closed, groupMemberships: [{ ...group, workspaceId: "other" }] }, "root", "page.read")).toBe(false);
  });

  it("requires guests to have teamspace membership and an explicit page grant", () => {
    const guest = { ...state, membership: { ...actor, role: "guest" } } satisfies PolicySnapshot;
    const granted = [page("root", { teamspaceId: "team", access: { mode: "inherit", grants: [allow("view")] } })];
    expect(canPage({ ...guest, pages: granted }, "root", "page.read")).toBe(false);
    const admitted = { ...guest, teamspaces: [{ ...teamspace, memberUserIds: ["alice"] }] };
    expect(canPage(admitted, "root", "page.read")).toBe(false);
    expect(canPage({ ...admitted, pages: granted }, "root", "page.read")).toBe(true);
  });

  it("lets a replace policy restrict the teamspace's inherited default", () => {
    expect(canPage({ ...state, pages: [page("root", { teamspaceId: "team", access: { mode: "replace", grants: [] } })] }, "root", "page.read")).toBe(false);
  });

  it("rejects absent, duplicated and cross-tenant teamspaces", () => {
    for (const teamspaces of [[], [teamspace, teamspace], [{ ...teamspace, workspaceId: "other" }]]) {
      expect(evaluatePageAccess({ ...state, teamspaces }, "root")).toEqual({ allowed: false });
    }
  });
});

describe("malformed and cross-tenant ancestry", () => {
  const full = { mode: "inherit", grants: [allow("full")] } satisfies PolicyPage["access"];
  const graphs: readonly PolicyPage[][] = [
    [page("root", { access: full, parentId: "missing" })],
    [page("root", { access: full, parentId: "root" })],
    [page("root", { access: full, parentId: "parent" }), page("parent", { parentId: "root" })],
    [page("root", { access: full, workspaceId: "other" })],
    [page("root", { access: full, parentId: "parent" }), page("parent", { workspaceId: "other" })],
    [page("root", { access: full }), page("root")],
    [page("root", { access: full, parentId: "parent", teamspaceId: "team" }), page("parent")],
  ];

  it.each(graphs.map((pages, index) => ({ pages, index })))("denies malformed ancestry $index and missing IDs identically", ({ pages }) => {
    const state = snapshot({ pages, membership: { ...actor, role: "owner" } });
    expect(evaluatePageAccess(state, "root")).toEqual(evaluatePageAccess(state, "missing"));
  });

  it("bounds deeply nested input without recursion", () => {
    const pages = Array.from({ length: 101 }, (_, index) =>
      page(`node-${index}`, {
        parentId: index === 0 ? null : `node-${index - 1}`,
        access: full,
      }),
    );
    const state = snapshot({ pages });
    expect(canPage(state, "node-99", "page.share")).toBe(true);
    expect(canPage(state, "node-100", "page.read")).toBe(false);
  });
});

describe("structural operations", () => {
  const shared = (id: string, grant: PageGrant, overrides: Partial<PolicyPage> = {}) =>
    page(id, { access: { mode: "inherit", grants: [allow(grant)] }, ...overrides });
  const state = snapshot({ pages: [shared("source", "full"), shared("destination", "edit"), page("child", { parentId: "source" })] });

  it("permits an authorized move and rejects self and descendant cycles", () => {
    expect(canMovePage(state, "source", "destination")).toBe(true);
    expect(canMovePage(state, "source", "source")).toBe(false);
    expect(canMovePage(state, "source", "child")).toBe(false);
  });

  it("requires source sharing authority because a move changes inherited access", () => {
    const editOnly = { ...state, pages: [shared("source", "edit"), shared("destination", "edit")] };
    expect(canPage(editOnly, "source", "page.move")).toBe(false);
    expect(canMovePage(editOnly, "source", "destination")).toBe(false);
  });

  it("requires destination create authority and a readable source for duplication", () => {
    const readOnly = { ...state, pages: [shared("source", "view"), shared("destination", "edit")] };
    expect(canDuplicatePage(readOnly, "source", "destination")).toBe(true);
    expect(canMovePage(readOnly, "source", "destination")).toBe(false);
    const deniedDestination = { ...state, pages: [shared("source", "full"), shared("destination", "view")] };
    expect(canDuplicatePage(deniedDestination, "source", "destination")).toBe(false);
    expect(canMovePage(deniedDestination, "source", "destination")).toBe(false);
    expect(canDuplicatePage(state, "missing", "destination")).toBe(false);
  });

  it("rejects cross-teamspace and cross-workspace moves", () => {
    const team = {
      id: "team",
      workspaceId: "org",
      visibility: "open",
      defaultGrant: "full",
      memberUserIds: [],
      memberGroupIds: [],
    } satisfies PolicySnapshot["teamspaces"][number];
    expect(
      canMovePage(
        { ...state, teamspaces: [team], pages: [shared("source", "full"), shared("destination", "full", { teamspaceId: "team" })] },
        "source",
        "destination",
      ),
    ).toBe(false);
    expect(canMovePage({ ...state, pages: [shared("source", "full"), shared("destination", "full", { workspaceId: "other" })] }, "source", "destination")).toBe(
      false,
    );
  });
});

describe("workspace governance", () => {
  it("keeps personal workspace membership and groups immutable", () => {
    const state = snapshot({ workspace: { id: "org", kind: "personal", state: "active", ownerId: "alice" }, membership: { ...actor, role: "owner" } });
    expect(canWorkspace(state, "workspace.manage_members")).toBe(false);
    expect(canWorkspace(state, "workspace.manage_groups")).toBe(false);
    expect(canWorkspace(state, "workspace.manage_settings")).toBe(true);
    expect(canWorkspace(state, "workspace.delete")).toBe(true);
  });

  it.each<WorkspaceRole>(["owner", "admin", "member", "guest"])("limits governance for %s", (role) => {
    const state = snapshot({ membership: { ...actor, role } });
    expect(canWorkspace(state, "workspace.manage_members")).toBe(role === "owner" || role === "admin");
    expect(canWorkspace(state, "workspace.manage_settings")).toBe(role === "owner" || role === "admin");
    expect(canWorkspace(state, "workspace.manage_groups")).toBe(role === "owner" || role === "admin");
    expect(canWorkspace(state, "workspace.delete")).toBe(role === "owner");
  });

  const owner = { ...actor, role: "owner" } satisfies WorkspaceMembership;
  const otherOwner = { ...owner, userId: "bob" };
  const state = snapshot({ membership: owner });

  it("protects the last owner against removal and demotion", () => {
    expect(canChangeMembership(state, [owner], "alice", { state: "revoked" })).toBe(false);
    expect(canChangeMembership(state, [owner], "alice", { state: "active", role: "member" })).toBe(false);
    expect(canChangeMembership(state, [owner], "alice", { state: "active", role: "owner" })).toBe(true);
    expect(canChangeMembership(state, [owner, otherOwner], "alice", { state: "revoked" })).toBe(true);
  });

  it("does not count other-workspace, revoked or duplicated owners", () => {
    for (const extra of [
      [{ ...otherOwner, workspaceId: "other" }],
      [{ ...otherOwner, state: "revoked" }],
      [otherOwner, { ...otherOwner, state: "revoked" }],
    ] satisfies WorkspaceMembership[][]) {
      expect(canChangeMembership(state, [owner, ...extra], "alice", { state: "revoked" })).toBe(false);
    }
  });

  it("prevents admins from changing owners or granting ownership", () => {
    const admin = { ...actor, role: "admin" } satisfies WorkspaceMembership;
    const state = snapshot({ membership: admin });
    const member = { ...actor, userId: "carol" };
    expect(canChangeMembership(state, [admin, otherOwner, member], "carol", { state: "active", role: "guest" })).toBe(true);
    expect(canChangeMembership(state, [admin, otherOwner, member], "carol", { state: "active", role: "owner" })).toBe(false);
    expect(canChangeMembership(state, [admin, otherOwner], "bob", { state: "active", role: "admin" })).toBe(false);
  });

  it("rejects missing, contradictory, stale and personal membership contexts", () => {
    expect(canChangeMembership(state, [owner], "missing", { state: "revoked" })).toBe(false);
    expect(canChangeMembership(state, [owner, owner, otherOwner], "alice", { state: "revoked" })).toBe(false);
    expect(canChangeMembership(state, [{ ...owner, role: "member" }, otherOwner], "bob", { state: "revoked" })).toBe(false);
    expect(canChangeMembership(state, [otherOwner], "bob", { state: "revoked" })).toBe(false);
    expect(
      canChangeMembership({ ...state, workspace: { ...state.workspace, kind: "personal", ownerId: "alice" } }, [owner, otherOwner], "bob", {
        state: "revoked",
      }),
    ).toBe(false);
  });
});
