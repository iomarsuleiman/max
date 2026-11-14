import { describe, expect, it } from "vitest";
import {
  isAccidentalWorkspaceSwitchGesture,
  nextWorkspaceFocusIndex,
} from "@/lib/domain/workspaceNavigationErgonomics";
import { workspaceSwitchIntent } from "@/lib/domain/workspaceNavigationState";

const memberships = [
  { workspaceId: "team-01", role: "member" as const },
  { workspaceId: "team-02", role: "guest" as const },
];

describe("Max 2.0 PR11 workspace navigation ergonomics", () => {
  it("cycles keyboard focus without activating links or changing workspace", () => {
    expect(nextWorkspaceFocusIndex("ArrowDown", 0, 3)).toBe(1);
    expect(nextWorkspaceFocusIndex("ArrowDown", 2, 3)).toBe(0);
    expect(nextWorkspaceFocusIndex("ArrowUp", 0, 3)).toBe(2);
    expect(nextWorkspaceFocusIndex("ArrowUp", 2, 3)).toBe(1);
  });
  it("supports first and last focus targets for long lists", () => {
    expect(nextWorkspaceFocusIndex("Home", 30, 50)).toBe(0);
    expect(nextWorkspaceFocusIndex("End", 0, 50)).toBe(49);
  });
  it("leaves Tab, Escape, horizontal RTL keys, modifiers and invalid states native", () => {
    for (const key of ["Tab", "Escape", "ArrowLeft", "ArrowRight", "Enter", " ", "a"]) {
      expect(nextWorkspaceFocusIndex(key, 1, 3)).toBeNull();
    }
    expect(nextWorkspaceFocusIndex("ArrowDown", 0, 0)).toBeNull();
    expect(nextWorkspaceFocusIndex("ArrowDown", -1, 2)).toBeNull();
    expect(nextWorkspaceFocusIndex("Home", 5, 2)).toBeNull();
  });
  it("blocks movement gestures but never blocks taps, mouse clicks or keyboard activation", () => {
    expect(isAccidentalWorkspaceSwitchGesture("touch", 12, 0)).toBe(true);
    expect(isAccidentalWorkspaceSwitchGesture("pen", 0, -20)).toBe(true);
    expect(isAccidentalWorkspaceSwitchGesture("touch", 3, 4)).toBe(false);
    expect(isAccidentalWorkspaceSwitchGesture("mouse", 100, 100)).toBe(false);
    expect(isAccidentalWorkspaceSwitchGesture("", 12, 0)).toBe(false);
    expect(isAccidentalWorkspaceSwitchGesture("touch", Number.NaN, 20)).toBe(false);
  });
  it("still requires a verified membership and preserves an open personal editor", () => {
    expect(workspaceSwitchIntent("/p/draft-123", "team-01", memberships))
      .toEqual({ href: "/w/team-01", newTab: true });
    expect(workspaceSwitchIntent("/w/team-02", "team-01", memberships))
      .toEqual({ href: "/w/team-01", newTab: false });
    expect(workspaceSwitchIntent("/p/draft-123", "team-99", memberships)).toBeNull();
  });
});
