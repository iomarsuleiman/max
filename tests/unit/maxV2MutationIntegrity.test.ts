import { describe, expect, it } from "vitest";
import { validAffiliationRows, validPageGrantRows } from "@/lib/domain/workspaceMutationIntegrity";

const workspace = "workspace01";
const account = "user_member";
const group = { workspaceId: workspace, accountId: account, groupId: "group1", status: "active" };
const team = { workspaceId: workspace, accountId: account, teamspaceId: "team1", status: "suspended" };
const grant = {
  workspaceId: workspace, pageId: "page1", subjectType: "account",
  subjectId: account, effect: "allow", level: "edit",
};
describe("fail-closed shadow mutation integrity", () => {
  it("accepts valid bounded affiliation sets", () => {
    expect(validAffiliationRows([group], workspace, account, "group")).toBe(true);
    expect(validAffiliationRows([team], workspace, account, "teamspace")).toBe(true);
    expect(validAffiliationRows([], workspace, account, "group")).toBe(true);
  });
  it("rejects unrelated duplicate, cross-tenant and malformed affiliation rows", () => {
    expect(validAffiliationRows([group, group], workspace, account, "group")).toBe(false);
    expect(validAffiliationRows([{ ...group, workspaceId: "otherws" }], workspace, account, "group")).toBe(false);
    expect(validAffiliationRows([{ ...team, accountId: "user_other" }], workspace, account, "teamspace")).toBe(false);
    expect(validAffiliationRows([{ ...group, groupId: "../bad" }], workspace, account, "group")).toBe(false);
    expect(validAffiliationRows([{ ...group, status: "unknown" }], workspace, account, "group")).toBe(false);
    expect(validAffiliationRows(Array.from({ length: 101 }, (_, i) => ({ ...group, groupId: "group" + i })), workspace, account, "group")).toBe(false);
  });
  it("accepts scoped grants and rejects duplicated or foreign page entries", () => {
    expect(validPageGrantRows([grant], workspace, "page1")).toBe(true);
    expect(validPageGrantRows([{ ...grant, subjectType: "workspace_role", subjectId: "member" }], workspace, "page1")).toBe(true);
    expect(validPageGrantRows([grant, { ...grant, effect: "deny" }], workspace, "page1")).toBe(false);
    expect(validPageGrantRows([{ ...grant, workspaceId: "otherws" }], workspace, "page1")).toBe(false);
    expect(validPageGrantRows([{ ...grant, pageId: "otherPage" }], workspace, "page1")).toBe(false);
  });
  it("fails on invalid grant principals, type, effect, level and oversized ACLs", () => {
    expect(validPageGrantRows([{ ...grant, subjectId: "../bad" }], workspace, "page1")).toBe(false);
    expect(validPageGrantRows([{ ...grant, subjectType: "workspace_role", subjectId: "superadmin" }], workspace, "page1")).toBe(false);
    expect(validPageGrantRows([{ ...grant, effect: "overwrite" }], workspace, "page1")).toBe(false);
    expect(validPageGrantRows([{ ...grant, level: "root" }], workspace, "page1")).toBe(false);
    expect(validPageGrantRows(Array.from({ length: 101 }, (_, i) => ({ ...grant, subjectId: "account" + i })), workspace, "page1")).toBe(false);
  });
});
