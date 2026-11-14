import { describe, expect, it } from "vitest";
import {
  listAuthorizedWorkspaceSummaries, workspacePreviewHref,
  type NavigationMembership, type NavigationWorkspace, type NavigationStore,
} from "@/lib/domain/workspaceNavigation";

function fixture() {
  const members: NavigationMembership[] = [
    { workspaceId: "team-01", accountId: "alice", role: "owner", status: "active" },
    { workspaceId: "team-01", accountId: "bob", role: "member", status: "active" },
    { workspaceId: "team-02", accountId: "bob", role: "guest", status: "active" },
    { workspaceId: "team-02", accountId: "carol", role: "owner", status: "active" },
  ];
  const spaces: NavigationWorkspace[] = [
    { workspaceId: "team-01", ownerId: "alice", status: "active" },
    { workspaceId: "team-02", ownerId: "carol", status: "active" },
  ];
  const store: NavigationStore = {
    membershipsForAccount: async (account) => members.filter((row) => row.accountId === account),
    workspaces: async (id) => spaces.filter((row) => row.workspaceId === id),
    ownerMemberships: async (id, account) => members.filter((row) => row.workspaceId === id && row.accountId === account),
  };
  const list = (account: string | null) => listAuthorizedWorkspaceSummaries(store, account);
  return { members, spaces, store, list };
}

describe("Max 2.0 navigation membership boundary", () => {
  it("lists only signed-in active memberships, without pages or owner IDs", async () => {
    const a = fixture();
    expect(await a.list("bob")).toEqual([
      { workspaceId: "team-01", role: "member" },
      { workspaceId: "team-02", role: "guest" },
    ]);
    expect(await a.list("alice")).toEqual([{ workspaceId: "team-01", role: "owner" }]);
    expect(await a.list("stranger")).toEqual([]);
    expect(await a.list(null)).toEqual([]);
  });
  it("hides revoked/suspended memberships immediately", async () => {
    const a = fixture();
    a.members[1].status = "revoked";
    expect(await a.list("bob")).toEqual([{ workspaceId: "team-02", role: "guest" }]);
    a.members[2].status = "suspended";
    expect(await a.list("bob")).toEqual([]);
  });
  it("rejects another account or tenant mixed into the returned snapshot", async () => {
    const a = fixture();
    a.members[1].accountId = "alice";
    a.store.membershipsForAccount = async () => [a.members[1]];
    expect(await a.list("bob")).toEqual([]);
  });
  it("denies duplicated membership snapshots", async () => {
    const a = fixture();
    a.store.membershipsForAccount = async () => [a.members[1], { ...a.members[1] }];
    expect(await a.list("bob")).toEqual([]);
  });
  it("rejects forged owners and invalid statuses, roles or workspace IDs", async () => {
    for (const patch of [
      { role: "owner" }, { role: "super-admin" }, { status: "unknown" },
      { workspaceId: "../private" },
    ]) {
      const a = fixture();
      a.store.membershipsForAccount = async () => [{ ...a.members[1], ...patch } as NavigationMembership];
      expect(await a.list("bob")).toEqual([]);
    }
  });
  it("denies disabled, duplicate, cross-tenant or corrupt workspace records", async () => {
    for (const patch of [
      { status: "disabled" }, { workspaceId: "team-99" }, { ownerId: "../bad" },
    ]) {
      const a = fixture();
      a.spaces[0] = { ...a.spaces[0], ...patch } as NavigationWorkspace;
      expect(await a.list("bob")).toEqual([]);
    }
    const a = fixture();
    a.spaces.push({ ...a.spaces[0] });
    expect(await a.list("bob")).toEqual([]);
  });
  it("requires exactly one active matching owner membership", async () => {
    for (const patch of [{ status: "revoked" }, { role: "member" }, { accountId: "other" }]) {
      const a = fixture();
      a.members[0] = { ...a.members[0], ...patch } as NavigationMembership;
      expect(await a.list("bob")).toEqual([]);
    }
  });
  it("denies oversized membership snapshots instead of truncating authorizations", async () => {
    const a = fixture();
    a.store.membershipsForAccount = async () =>
      Array.from({ length: 51 }, (_, i) => ({
        ...a.members[1], workspaceId: `team-${String(i).padStart(2, "0")}`,
      }));
    expect(await a.list("bob")).toEqual([]);
  });
  it("never interpolates forged route IDs", () => {
    expect(workspacePreviewHref("team-01")).toBe("/w/team-01");
    expect(workspacePreviewHref("../p/secret")).toBeNull();
    expect(workspacePreviewHref("a")).toBeNull();
    expect(workspacePreviewHref("tenant?peek=secret")).toBeNull();
  });
});
