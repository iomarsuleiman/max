import { describe, expect, it } from "vitest";
import {
  canManageAffiliation, canManageGrant, canManageMember, canTransferOwnership,
  validPrincipalId, validScopeId, validWorkspaceId,
} from "@/lib/domain/workspaceManagementPolicy";

const owner = { accountId: "user_owner", role: "owner" as const };
const admin = { accountId: "user_admin", role: "admin" as const };
const member = { accountId: "user_member", role: "member" as const };
const guest = { accountId: "user_guest", role: "guest" as const };
const currentOwner = { ...owner, status: "active" as const };
const currentAdmin = { ...admin, status: "active" as const };
const currentMember = { ...member, status: "active" as const };

describe("Max 2.0 workspace management policy (closed rollout)", () => {
  it("validates workspace keys and principal/scope identifiers", () => {
    expect(validWorkspaceId("acme-123")).toBe(true);
    expect(validWorkspaceId("a")).toBe(false);
    expect(validWorkspaceId("bad--")).toBe(false);
    expect(validWorkspaceId("../escape")).toBe(false);
    expect(validPrincipalId("user_2Ab:C")).toBe(true);
    expect(validPrincipalId(" ")).toBe(false);
    expect(validScopeId("page_abc-1")).toBe(true);
    expect(validScopeId("")).toBe(false);
  });
  it("allows owners to change existing non-owner roles but not create uninvited accounts", () => {
    expect(canManageMember(owner, owner.accountId, currentMember, { accountId: member.accountId, role: "admin", status: "active" })).toBe(true);
    expect(canManageMember(owner, owner.accountId, currentMember, { accountId: member.accountId, role: "guest", status: "suspended" })).toBe(true);
    expect(canManageMember(owner, owner.accountId, null, { accountId: "user_new", role: "admin", status: "active" })).toBe(false);
    expect(canManageMember(admin, owner.accountId, null, { accountId: "user_new", role: "member", status: "active" })).toBe(false);
  });
  it("never permits modifying the sole owner with the generic membership writer", () => {
    expect(canManageMember(owner, owner.accountId, currentOwner, { accountId: owner.accountId, role: "admin", status: "revoked" })).toBe(false);
    expect(canManageMember(admin, owner.accountId, currentOwner, { accountId: owner.accountId, role: "member", status: "revoked" })).toBe(false);
  });
  it("limits admins to managing other members and guests", () => {
    expect(canManageMember(admin, owner.accountId, currentMember, { accountId: member.accountId, role: "guest", status: "revoked" })).toBe(true);
    expect(canManageMember(admin, owner.accountId, currentMember, { accountId: member.accountId, role: "admin", status: "active" })).toBe(false);
    expect(canManageMember(admin, owner.accountId, currentAdmin, { accountId: admin.accountId, role: "member", status: "active" })).toBe(false);
    expect(canManageMember(guest, owner.accountId, currentMember, { accountId: member.accountId, role: "member", status: "revoked" })).toBe(false);
  });
  it("treats revoked membership as terminal and disallows ghost revocations", () => {
    expect(canManageMember(owner, owner.accountId, { ...currentMember, status: "revoked" }, { accountId: member.accountId, role: "member", status: "active" })).toBe(false);
    expect(canManageMember(owner, owner.accountId, null, { accountId: "user_new", role: "member", status: "revoked" })).toBe(false);
  });
  it("enforces active owner and active successor for atomic ownership transfer", () => {
    expect(canTransferOwnership(owner, owner.accountId, currentOwner, currentAdmin)).toBe(true);
    expect(canTransferOwnership(owner, owner.accountId, currentOwner, currentMember)).toBe(true);
    expect(canTransferOwnership(owner, owner.accountId, currentOwner, { ...guest, status: "active" })).toBe(false);
    expect(canTransferOwnership(admin, owner.accountId, currentOwner, currentAdmin)).toBe(false);
    expect(canTransferOwnership(owner, owner.accountId, currentOwner, { ...currentMember, status: "revoked" })).toBe(false);
    expect(canTransferOwnership(owner, owner.accountId, currentOwner, currentOwner)).toBe(false);
  });
  it("rejects role impersonation via mismatched ownerId", () => {
    expect(canManageMember(owner, "other_owner", null, { accountId: "user_new", role: "member", status: "active" })).toBe(false);
    expect(canTransferOwnership(owner, "other_owner", currentOwner, currentAdmin)).toBe(false);
  });
  it("guards owner/admin group and teamspace affiliation changes", () => {
    expect(canManageAffiliation(owner, owner.accountId, currentMember)).toBe(true);
    expect(canManageAffiliation(admin, owner.accountId, currentMember)).toBe(true);
    expect(canManageAffiliation(admin, owner.accountId, currentOwner)).toBe(false);
    expect(canManageAffiliation(admin, owner.accountId, currentAdmin)).toBe(false);
    expect(canManageAffiliation(member, owner.accountId, currentMember)).toBe(false);
  });
  it("keeps admins from setting owner and admin ACLs or self-denials", () => {
    expect(canManageGrant(owner, owner.accountId, "workspace_role", "owner")).toBe(true);
    expect(canManageGrant(admin, owner.accountId, "account", owner.accountId)).toBe(false);
    expect(canManageGrant(admin, owner.accountId, "account", admin.accountId)).toBe(false);
    expect(canManageGrant(admin, owner.accountId, "workspace_role", "owner")).toBe(false);
    expect(canManageGrant(admin, owner.accountId, "workspace_role", "admin")).toBe(false);
    expect(canManageGrant(admin, owner.accountId, "workspace_role", "member")).toBe(false);
    expect(canManageGrant(admin, owner.accountId, "group", "everyone")).toBe(false);
    expect(canManageGrant(admin, owner.accountId, "account", member.accountId)).toBe(true);
    expect(canManageGrant(member, owner.accountId, "account", member.accountId)).toBe(false);
  });
});
