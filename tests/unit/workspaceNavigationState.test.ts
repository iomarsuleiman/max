import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREVIEW_NAVIGATION_STATE, isWorkspacePreviewRoute,
  normalizePreviewNavigationState, previewNavigationStorageKey,
  readPreviewNavigationState, verifiedNavigationSummaries,
  workspaceSwitchIntent, writePreviewNavigationState,
} from "@/lib/domain/workspaceNavigationState";

const memberships = [
  { workspaceId: "team-01", role: "owner" as const },
  { workspaceId: "team-02", role: "guest" as const },
];

describe("Max 2.0 PR10 scoped navigation security", () => {
  it("accepts the exact server membership projection and preserves order", () => {
    expect(verifiedNavigationSummaries(memberships)).toEqual(memberships);
    expect(verifiedNavigationSummaries([])).toEqual([]);
  });
  it("fails closed for duplicate, oversized, corrupt or augmented membership payloads", () => {
    expect(verifiedNavigationSummaries([...memberships, memberships[0]])).toBeNull();
    expect(verifiedNavigationSummaries(Array.from({ length: 51 }, (_, i) => ({
      workspaceId: "team-" + String(i).padStart(2, "0"), role: "member",
    })))).toBeNull();
    for (const forged of [
      [{ workspaceId: "../secret", role: "owner" }],
      [{ workspaceId: "team-01", role: "superuser" }],
      [{ workspaceId: "team-01", role: "owner", secret: "page" }],
      [{ workspaceId: "team-01" }],
      null,
      {},
    ]) expect(verifiedNavigationSummaries(forged)).toBeNull();
  });
  it("does not treat unrelated URL paths or query strings as workspace previews", () => {
    expect(isWorkspacePreviewRoute("/w/team-01")).toBe(true);
    for (const path of ["/p/private-123", "/home", "/w/../p/private", "/w/team-01/x", "/w/team-01?peek=secret"]) {
      expect(isWorkspacePreviewRoute(path)).toBe(false);
    }
  });
  it("opens previews in new tabs from every personal editor location", () => {
    expect(workspaceSwitchIntent("/p/private-123", "team-01", memberships))
      .toEqual({ href: "/w/team-01", newTab: true });
    expect(workspaceSwitchIntent("/home", "team-01", memberships)?.newTab).toBe(true);
    expect(workspaceSwitchIntent("/w/team-01", "team-02", memberships))
      .toEqual({ href: "/w/team-02", newTab: false });
  });
  it("never offers an unlisted or forged workspace destination", () => {
    expect(workspaceSwitchIntent("/home", "team-99", memberships)).toBeNull();
    expect(workspaceSwitchIntent("/w/team-01", "../p/private", memberships)).toBeNull();
    expect(workspaceSwitchIntent("/home", "team-01", [])).toBeNull();
  });
  it("isolates account and workspace navigation-memory keys", () => {
    const first = previewNavigationStorageKey("user_alice", "team-01");
    expect(first).toBeTruthy();
    expect(first).not.toBe(previewNavigationStorageKey("user_bob", "team-01"));
    expect(first).not.toBe(previewNavigationStorageKey("user_alice", "team-02"));
    expect(previewNavigationStorageKey("../alice", "team-01")).toBeNull();
    expect(previewNavigationStorageKey("user_alice", "../notes")).toBeNull();
  });
  it("round-trips bounded state without writing document IDs or global preferences", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => { memory.set(key, value); },
    };
    expect(readPreviewNavigationState(storage, "alice", "team-01")).toEqual(DEFAULT_PREVIEW_NAVIGATION_STATE);
    expect(writePreviewNavigationState(storage, "alice", "team-01", { collapsed: true, scrollTop: 45 })).toBe(true);
    expect(readPreviewNavigationState(storage, "alice", "team-01")).toEqual({ collapsed: true, scrollTop: 45 });
    expect(readPreviewNavigationState(storage, "bob", "team-01")).toEqual(DEFAULT_PREVIEW_NAVIGATION_STATE);
    expect(readPreviewNavigationState(storage, "alice", "team-02")).toEqual(DEFAULT_PREVIEW_NAVIGATION_STATE);
    expect([...memory.values()].join(" ")).not.toContain("private-123");
  });
  it("rejects malformed stored data, oversize values, and blocked storage APIs", () => {
    expect(normalizePreviewNavigationState({ collapsed: true, scrollTop: -1 })).toBeNull();
    expect(normalizePreviewNavigationState({ collapsed: true, scrollTop: 1, pageId: "leak" })).toBeNull();
    const blocked = {
      getItem: (_: string): string | null => { throw new Error("disabled"); },
      setItem: (_: string, __: string): void => { throw new Error("disabled"); },
    };
    expect(readPreviewNavigationState(blocked, "alice", "team-01")).toEqual(DEFAULT_PREVIEW_NAVIGATION_STATE);
    expect(writePreviewNavigationState(blocked, "alice", "team-01", { collapsed: false, scrollTop: 0 })).toBe(false);
  });
});
