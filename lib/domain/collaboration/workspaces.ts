import { z } from "zod";
import { MaxError, notFound } from "../errors";
import { canChangeMembership, canWorkspace, type PolicySnapshot, type WorkspaceCapability } from "./policy";
import {
  COLLABORATION_LIMITS,
  type CollaborationAuditEvent,
  type CollaborationGroup,
  type CollaborationInvitation,
  type CollaborationMembership,
  type CollaborationRuntime,
  type CollaborationStore,
  type CollaborationTeamspace,
  type CollaborationTransaction,
  type CollaborationWorkspace,
  type ResolvedCollaborationActor,
} from "./collaborationStore";

const identifier = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() === value && !/[\u0000-\u001f]/.test(value));
const label = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/[\u0000-\u001f]/.test(value));
const email = z.string().trim().toLowerCase().max(320).pipe(z.email());
const actorSchema = z.object({ userId: identifier, verifiedEmail: email.nullable() }).strict();
const workspaceInput = z.object({ workspaceId: identifier }).strict();
const role = z.enum(["owner", "admin", "member", "guest"]);
const invitationRole = z.enum(["admin", "member", "guest"]);
const grant = z.enum(["view", "comment", "edit_content", "edit", "full"]);
const visibility = z.enum(["open", "closed", "private"]);
const ids = z
  .array(identifier)
  .max(200)
  .transform((values) => [...new Set(values)]);
const TOKEN_PATTERN = /^max-invite-v1\.[a-f0-9]{64}$/;
const DAY = 86_400_000;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new MaxError("VALIDATION", "Check the supplied workspace details and try again.");
  return result.data;
}

function bounded<T>(values: T[], maximum: number): T[] {
  if (values.length > maximum) throw new MaxError("LIMIT", "This workspace exceeds the supported collaboration limit.");
  return values;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const noAccess = () => notFound("workspace");
const publicInvitation = (invitation: CollaborationInvitation) => ({
  id: invitation.id,
  workspaceId: invitation.workspaceId,
  invitedBy: invitation.invitedBy,
  recipientEmail: invitation.recipientEmail,
  role: invitation.role,
  state: invitation.state,
  createdAt: invitation.createdAt,
  expiresAt: invitation.expiresAt,
});

/** Suitable for Node/local adapters. Convex must inject trusted action-generated entropy. */
export function webCryptoCollaborationRuntime(): CollaborationRuntime {
  return {
    now: () => Date.now(),
    newId: () => globalThis.crypto.randomUUID(),
    createInvitationToken: () => {
      const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
      return `max-invite-v1.${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
    },
    hashInvitationToken: async (token) => {
      const hash = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
      return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  };
}

/**
 * Transactional collaboration lifecycle, separate from existing content ops.
 * The actor and runtime are adapter-owned; request bodies select resources only.
 */
export class WorkspaceService {
  constructor(
    private readonly store: CollaborationStore,
    private readonly runtime: CollaborationRuntime = webCryptoCollaborationRuntime(),
  ) {}

  private now() {
    const now = this.runtime.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new MaxError("INTERNAL", "The workspace clock is unavailable.");
    return now;
  }

  private snapshot(workspace: CollaborationWorkspace, member: CollaborationMembership, now: number): PolicySnapshot {
    return { workspace, membership: member, userId: member.userId, groupMemberships: [], teamspaces: [], pages: [], now };
  }

  private async context(tx: CollaborationTransaction, actor: ResolvedCollaborationActor, workspaceId: string, now: number) {
    const workspace = await tx.getWorkspace(workspaceId);
    const member = await tx.getMembership(workspaceId, actor.userId);
    if (
      !workspace ||
      workspace.id !== workspaceId ||
      workspace.state !== "active" ||
      !member ||
      member.state !== "active" ||
      member.userId !== actor.userId ||
      member.workspaceId !== workspaceId
    )
      throw noAccess();
    if (workspace.kind === "personal" && (workspace.ownerId !== actor.userId || member.role !== "owner")) throw noAccess();
    return { workspace, member, policy: this.snapshot(workspace, member, now) };
  }

  private async organization(
    tx: CollaborationTransaction,
    actor: ResolvedCollaborationActor,
    workspaceId: string,
    now: number,
    capability?: WorkspaceCapability,
  ) {
    const context = await this.context(tx, actor, workspaceId, now);
    if (context.workspace.kind !== "organization" || (capability && !canWorkspace(context.policy, capability))) throw noAccess();
    return context;
  }

  private audit(
    tx: CollaborationTransaction,
    actor: ResolvedCollaborationActor,
    workspaceId: string,
    type: CollaborationAuditEvent["type"],
    targetId: string,
    at: number,
    detail: CollaborationAuditEvent["detail"] = {},
  ) {
    return tx.appendAudit({ id: this.runtime.newId(), workspaceId, actorId: actor.userId, type, targetId, at, detail });
  }

  private async activeTarget(tx: CollaborationTransaction, workspaceId: string, userId: string) {
    const member = await tx.getMembership(workspaceId, userId);
    if (!member || member.workspaceId !== workspaceId || member.userId !== userId || member.state !== "active") throw noAccess();
    return member;
  }

  private async group(tx: CollaborationTransaction, workspaceId: string, groupId: string) {
    const group = await tx.getGroup(groupId);
    if (!group || group.id !== groupId || group.workspaceId !== workspaceId || group.state !== "active") throw notFound("group");
    return group;
  }

  private async teamspace(tx: CollaborationTransaction, workspaceId: string, teamspaceId: string) {
    const teamspace = await tx.getTeamspace(teamspaceId);
    if (!teamspace || teamspace.id !== teamspaceId || teamspace.workspaceId !== workspaceId || teamspace.state !== "active") throw notFound("teamspace");
    return teamspace;
  }

  private async admitted(tx: CollaborationTransaction, member: CollaborationMembership, teamspace: CollaborationTeamspace) {
    if (member.workspaceId !== teamspace.workspaceId || member.state !== "active") return false;
    if (teamspace.visibility === "open" && member.role !== "guest") return true;
    if (teamspace.memberUserIds.includes(member.userId)) return true;
    const groups = await tx.listUserGroupMemberships(member.workspaceId, member.userId);
    for (const membership of groups) {
      if (
        membership.workspaceId !== member.workspaceId ||
        membership.userId !== member.userId ||
        membership.state !== "active" ||
        !teamspace.memberGroupIds.includes(membership.groupId)
      )
        continue;
      const group = await tx.getGroup(membership.groupId);
      if (group?.workspaceId === member.workspaceId && group.state === "active") return true;
    }
    return false;
  }

  private assertTeamspaceManager(member: CollaborationMembership, teamspace: CollaborationTeamspace) {
    if (member.role === "guest" || !teamspace.managerUserIds.includes(member.userId)) throw notFound("teamspace");
  }

  async ensurePersonalWorkspace(resolvedActor: ResolvedCollaborationActor, input: unknown = {}) {
    const actor = parse(actorSchema, resolvedActor);
    const { name } = parse(z.object({ name: label.default("Personal") }).strict(), input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const existing = await tx.getPersonalWorkspace(actor.userId);
      if (existing) {
        if (existing.kind !== "personal" || existing.ownerId !== actor.userId) throw noAccess();
        await this.context(tx, actor, existing.id, now);
        return { workspace: existing, created: false };
      }
      const memberships = bounded(await tx.listUserMemberships(actor.userId), COLLABORATION_LIMITS.membershipsPerUser);
      if (memberships.length >= COLLABORATION_LIMITS.membershipsPerUser) throw new MaxError("LIMIT", "This account has too many workspace memberships.");
      const workspace: CollaborationWorkspace = {
        id: this.runtime.newId(),
        kind: "personal",
        ownerId: actor.userId,
        name,
        state: "active",
        createdAt: now,
        updatedAt: now,
      };
      await tx.insertWorkspace(workspace);
      await tx.putMembership({ workspaceId: workspace.id, userId: actor.userId, role: "owner", state: "active", joinedAt: now, updatedAt: now });
      await this.audit(tx, actor, workspace.id, "workspace.created", workspace.id, now, { kind: "personal" });
      return { workspace, created: true };
    });
  }

  async createOrganization(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { name } = parse(z.object({ name: label }).strict(), input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const memberships = bounded(await tx.listUserMemberships(actor.userId), COLLABORATION_LIMITS.membershipsPerUser);
      if (memberships.length >= COLLABORATION_LIMITS.membershipsPerUser) throw new MaxError("LIMIT", "This account has too many workspace memberships.");
      const workspace: CollaborationWorkspace = { id: this.runtime.newId(), kind: "organization", name, state: "active", createdAt: now, updatedAt: now };
      await tx.insertWorkspace(workspace);
      await tx.putMembership({ workspaceId: workspace.id, userId: actor.userId, role: "owner", state: "active", joinedAt: now, updatedAt: now });
      await this.audit(tx, actor, workspace.id, "workspace.created", workspace.id, now, { kind: "organization" });
      return { workspace };
    });
  }

  async listWorkspaces(resolvedActor: ResolvedCollaborationActor) {
    const actor = parse(actorSchema, resolvedActor);
    return this.store.transaction(async (tx) => {
      const memberships = bounded(await tx.listUserMemberships(actor.userId), COLLABORATION_LIMITS.membershipsPerUser);
      const workspaces: { workspace: CollaborationWorkspace; role: CollaborationMembership["role"] }[] = [];
      for (const membership of memberships) {
        if (membership.userId !== actor.userId || membership.state !== "active") continue;
        const workspace = await tx.getWorkspace(membership.workspaceId);
        if (
          !workspace ||
          workspace.state !== "active" ||
          (workspace.kind === "personal" && (workspace.ownerId !== actor.userId || membership.role !== "owner"))
        )
          continue;
        workspaces.push({ workspace, role: membership.role });
      }
      return { workspaces };
    });
  }

  async renameWorkspace(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId, name } = parse(workspaceInput.extend({ name: label }), input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const context = await this.context(tx, actor, workspaceId, now);
      if (!canWorkspace(context.policy, "workspace.manage_settings")) throw noAccess();
      if (context.workspace.name !== name) {
        await tx.patchWorkspace(workspaceId, { name, updatedAt: now });
        await this.audit(tx, actor, workspaceId, "workspace.renamed", workspaceId, now);
      }
      return { workspace: { ...context.workspace, name, updatedAt: context.workspace.name === name ? context.workspace.updatedAt : now } };
    });
  }

  async archiveOrganization(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId } = parse(workspaceInput, input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      await this.organization(tx, actor, workspaceId, now, "workspace.delete");
      await tx.patchWorkspace(workspaceId, { state: "archived", updatedAt: now });
      await this.audit(tx, actor, workspaceId, "workspace.archived", workspaceId, now);
      return { archived: true };
    });
  }

  async listMembers(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId } = parse(workspaceInput, input);
    return this.store.transaction(async (tx) => {
      await this.organization(tx, actor, workspaceId, this.now(), "workspace.manage_members");
      return { members: bounded(await tx.listWorkspaceMemberships(workspaceId), COLLABORATION_LIMITS.membersPerWorkspace) };
    });
  }

  async changeMembership(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const args = parse(
      workspaceInput.extend({
        userId: identifier,
        next: z.discriminatedUnion("state", [z.object({ state: z.literal("active"), role }).strict(), z.object({ state: z.literal("revoked") }).strict()]),
      }),
      input,
    );
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const context = await this.organization(tx, actor, args.workspaceId, now, "workspace.manage_members");
      const members = bounded(await tx.listWorkspaceMemberships(args.workspaceId), COLLABORATION_LIMITS.membersPerWorkspace);
      const target = members.find((member) => member.userId === args.userId);
      if (!target || !canChangeMembership(context.policy, members, args.userId, args.next)) throw noAccess();
      const membership: CollaborationMembership = {
        ...target,
        state: args.next.state,
        role: args.next.state === "active" ? args.next.role : target.role,
        updatedAt: now,
      };
      if (membership.state === target.state && membership.role === target.role) return { membership: target };
      await tx.putMembership(membership);
      if (membership.state === "revoked") await this.removeAdmission(tx, args.workspaceId, args.userId, now);
      let revokedInvitations = 0;
      if (membership.state === "revoked" || (membership.role !== "owner" && membership.role !== "admin")) {
        for (const invitation of bounded(await tx.listOpenInvitations(args.workspaceId, now), COLLABORATION_LIMITS.openInvitationsPerWorkspace)) {
          if (invitation.invitedBy !== args.userId) continue;
          await tx.putInvitation({ ...invitation, state: "revoked", revokedBy: actor.userId, revokedAt: now });
          revokedInvitations++;
        }
      }
      await this.audit(tx, actor, args.workspaceId, "membership.changed", args.userId, now, {
        state: membership.state,
        role: membership.role,
        revokedInvitations,
      });
      return { membership };
    });
  }

  private async removeAdmission(tx: CollaborationTransaction, workspaceId: string, userId: string, now: number) {
    for (const membership of await tx.listUserGroupMemberships(workspaceId, userId)) {
      if (membership.workspaceId === workspaceId && membership.userId === userId && membership.state === "active")
        await tx.putGroupMembership({ ...membership, state: "revoked", updatedAt: now });
    }
    for (const teamspace of bounded(await tx.listTeamspaces(workspaceId), COLLABORATION_LIMITS.teamspacesPerWorkspace)) {
      if (teamspace.memberUserIds.includes(userId) || teamspace.managerUserIds.includes(userId)) {
        await tx.patchTeamspace(teamspace.id, {
          memberUserIds: teamspace.memberUserIds.filter((id) => id !== userId),
          managerUserIds: teamspace.managerUserIds.filter((id) => id !== userId),
          updatedAt: now,
        });
      }
    }
  }

  async createGroup(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId, name } = parse(workspaceInput.extend({ name: label }), input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      await this.organization(tx, actor, workspaceId, now, "workspace.manage_groups");
      const groups = bounded(await tx.listGroups(workspaceId), COLLABORATION_LIMITS.groupsPerWorkspace);
      if (groups.length >= COLLABORATION_LIMITS.groupsPerWorkspace) throw new MaxError("LIMIT", "This workspace has too many groups.");
      if (groups.some((group) => sameName(group.name, name))) throw new MaxError("CONFLICT", "A group with this name already exists.");
      const group: CollaborationGroup = { id: this.runtime.newId(), workspaceId, name, state: "active", createdAt: now, updatedAt: now };
      await tx.insertGroup(group);
      await this.audit(tx, actor, workspaceId, "group.created", group.id, now);
      return { group };
    });
  }

  async listGroups(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId } = parse(workspaceInput, input);
    return this.store.transaction(async (tx) => {
      await this.organization(tx, actor, workspaceId, this.now(), "workspace.manage_groups");
      return { groups: bounded(await tx.listGroups(workspaceId), COLLABORATION_LIMITS.groupsPerWorkspace) };
    });
  }

  async setGroupMember(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const args = parse(workspaceInput.extend({ groupId: identifier, userId: identifier, state: z.enum(["active", "revoked"]) }), input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const context = await this.organization(tx, actor, args.workspaceId, now, "workspace.manage_groups");
      await this.group(tx, args.workspaceId, args.groupId);
      if (args.state === "active") {
        await this.activeTarget(tx, args.workspaceId, args.userId);
        // Group governance must not be an indirect route into an unadmitted private boundary.
        for (const teamspace of bounded(await tx.listTeamspaces(args.workspaceId), COLLABORATION_LIMITS.teamspacesPerWorkspace)) {
          if (teamspace.visibility !== "open" && teamspace.memberGroupIds.includes(args.groupId) && !(await this.admitted(tx, context.member, teamspace)))
            throw notFound("group");
        }
      }
      const memberships = bounded(await tx.listGroupMemberships(args.workspaceId, args.groupId), COLLABORATION_LIMITS.membersPerWorkspace);
      const existing = memberships.find((membership) => membership.userId === args.userId);
      if (!existing && args.state === "revoked") return { changed: false };
      if (existing?.state === args.state) return { changed: false };
      await tx.putGroupMembership({
        workspaceId: args.workspaceId,
        groupId: args.groupId,
        userId: args.userId,
        state: args.state,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      await this.audit(tx, actor, args.workspaceId, "group.membership_changed", args.groupId, now, { userId: args.userId, state: args.state });
      return { changed: true };
    });
  }

  async updateGroup(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const args = parse(
      workspaceInput.extend({
        groupId: identifier,
        change: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("rename"), name: label }).strict(),
          z.object({ kind: z.literal("archive") }).strict(),
        ]),
      }),
      input,
    );
    return this.store.transaction(async (tx) => {
      const now = this.now();
      await this.organization(tx, actor, args.workspaceId, now, "workspace.manage_groups");
      const group = await this.group(tx, args.workspaceId, args.groupId);
      if (args.change.kind === "rename") {
        const nextName = args.change.name;
        if ((await tx.listGroups(args.workspaceId)).some((other) => other.id !== group.id && sameName(other.name, nextName)))
          throw new MaxError("CONFLICT", "A group with this name already exists.");
        if (group.name === nextName) return { changed: false };
        await tx.patchGroup(group.id, { name: nextName, updatedAt: now });
        await this.audit(tx, actor, args.workspaceId, "group.renamed", group.id, now);
      } else {
        await tx.patchGroup(group.id, { state: "archived", updatedAt: now });
        for (const member of await tx.listGroupMemberships(args.workspaceId, group.id))
          if (member.state === "active") await tx.putGroupMembership({ ...member, state: "revoked", updatedAt: now });
        await this.audit(tx, actor, args.workspaceId, "group.archived", group.id, now);
      }
      return { changed: true };
    });
  }

  private async validateTeamspaceMembers(
    tx: CollaborationTransaction,
    workspaceId: string,
    userIds: readonly string[],
    groupIds: readonly string[],
    managers: readonly string[],
  ) {
    if (!managers.length) throw new MaxError("VALIDATION", "Keep at least one active teamspace manager.");
    for (const userId of new Set([...userIds, ...managers])) {
      const member = await this.activeTarget(tx, workspaceId, userId);
      if (managers.includes(userId) && (member.role === "guest" || !userIds.includes(userId)))
        throw new MaxError("VALIDATION", "Teamspace managers must be direct, non-guest members.");
    }
    for (const groupId of groupIds) await this.group(tx, workspaceId, groupId);
  }

  async createTeamspace(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const args = parse(
      workspaceInput.extend({
        name: label,
        visibility: visibility.default("closed"),
        defaultGrant: grant.default("edit"),
        memberUserIds: ids.default([]),
        memberGroupIds: ids.default([]),
      }),
      input,
    );
    return this.store.transaction(async (tx) => {
      const now = this.now();
      await this.organization(tx, actor, args.workspaceId, now, "workspace.manage_settings");
      const teamspaces = bounded(await tx.listTeamspaces(args.workspaceId), COLLABORATION_LIMITS.teamspacesPerWorkspace);
      if (teamspaces.length >= COLLABORATION_LIMITS.teamspacesPerWorkspace) throw new MaxError("LIMIT", "This workspace has too many teamspaces.");
      // Do not disclose private names by rejecting collisions with an invisible private teamspace.
      const memberUserIds = [...new Set([actor.userId, ...args.memberUserIds])];
      await this.validateTeamspaceMembers(tx, args.workspaceId, memberUserIds, args.memberGroupIds, [actor.userId]);
      const teamspace: CollaborationTeamspace = {
        id: this.runtime.newId(),
        workspaceId: args.workspaceId,
        name: args.name,
        state: "active",
        visibility: args.visibility,
        defaultGrant: args.defaultGrant,
        memberUserIds,
        memberGroupIds: args.memberGroupIds,
        managerUserIds: [actor.userId],
        createdAt: now,
        updatedAt: now,
      };
      await tx.insertTeamspace(teamspace);
      await this.audit(tx, actor, args.workspaceId, "teamspace.created", teamspace.id, now, { visibility: teamspace.visibility });
      return { teamspace };
    });
  }

  async listTeamspaces(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId } = parse(workspaceInput, input);
    return this.store.transaction(async (tx) => {
      const context = await this.organization(tx, actor, workspaceId, this.now());
      const teamspaces: { id: string; name: string; visibility: CollaborationTeamspace["visibility"]; admitted: boolean; canManage: boolean }[] = [];
      for (const teamspace of bounded(await tx.listTeamspaces(workspaceId), COLLABORATION_LIMITS.teamspacesPerWorkspace)) {
        const admitted = await this.admitted(tx, context.member, teamspace);
        if (!admitted && (teamspace.visibility === "private" || context.member.role === "guest")) continue;
        teamspaces.push({
          id: teamspace.id,
          name: teamspace.name,
          visibility: teamspace.visibility,
          admitted,
          canManage: context.member.role !== "guest" && teamspace.managerUserIds.includes(actor.userId),
        });
      }
      return { teamspaces };
    });
  }

  async getTeamspace(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId, teamspaceId } = parse(workspaceInput.extend({ teamspaceId: identifier }), input);
    return this.store.transaction(async (tx) => {
      const context = await this.organization(tx, actor, workspaceId, this.now());
      const teamspace = await this.teamspace(tx, workspaceId, teamspaceId);
      if (!(await this.admitted(tx, context.member, teamspace))) throw notFound("teamspace");
      return { teamspace };
    });
  }

  async updateTeamspace(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const args = parse(
      workspaceInput.extend({
        teamspaceId: identifier,
        name: label,
        visibility,
        defaultGrant: grant,
        memberUserIds: ids,
        memberGroupIds: ids,
        managerUserIds: ids,
      }),
      input,
    );
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const context = await this.organization(tx, actor, args.workspaceId, now);
      const teamspace = await this.teamspace(tx, args.workspaceId, args.teamspaceId);
      this.assertTeamspaceManager(context.member, teamspace);
      await this.validateTeamspaceMembers(tx, args.workspaceId, args.memberUserIds, args.memberGroupIds, args.managerUserIds);
      const { workspaceId, teamspaceId, ...patch } = args;
      await tx.patchTeamspace(teamspaceId, { ...patch, updatedAt: now });
      await this.audit(tx, actor, workspaceId, "teamspace.access_changed", teamspaceId, now, { visibility: args.visibility });
      return { teamspace: { ...teamspace, ...patch, updatedAt: now } };
    });
  }

  async recoverTeamspace(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId, teamspaceId } = parse(workspaceInput.extend({ teamspaceId: identifier }), input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const context = await this.organization(tx, actor, workspaceId, now, "workspace.delete");
      const teamspace = await this.teamspace(tx, workspaceId, teamspaceId);
      for (const managerId of teamspace.managerUserIds) {
        const manager = await tx.getMembership(workspaceId, managerId);
        if (manager?.state === "active" && manager.role !== "guest") throw new MaxError("CONFLICT", "This teamspace already has an active manager.");
      }
      await tx.patchTeamspace(teamspaceId, {
        managerUserIds: [context.member.userId],
        memberUserIds: [...new Set([...teamspace.memberUserIds, actor.userId])],
        updatedAt: now,
      });
      await this.audit(tx, actor, workspaceId, "teamspace.recovered", teamspaceId, now);
      return { recovered: true };
    });
  }

  async archiveTeamspace(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId, teamspaceId } = parse(workspaceInput.extend({ teamspaceId: identifier }), input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const context = await this.organization(tx, actor, workspaceId, now);
      const teamspace = await this.teamspace(tx, workspaceId, teamspaceId);
      this.assertTeamspaceManager(context.member, teamspace);
      await tx.patchTeamspace(teamspaceId, { state: "archived", updatedAt: now });
      await this.audit(tx, actor, workspaceId, "teamspace.archived", teamspaceId, now);
      return { archived: true };
    });
  }

  async createInvitation(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const args = parse(
      workspaceInput.extend({
        email,
        role: invitationRole.default("member"),
        expiresInMs: z
          .number()
          .int()
          .min(60_000)
          .max(30 * DAY)
          .default(7 * DAY),
      }),
      input,
    );
    const token = this.runtime.createInvitationToken();
    if (!TOKEN_PATTERN.test(token)) throw new MaxError("INTERNAL", "The invitation token generator is unavailable.");
    const tokenHash = await this.runtime.hashInvitationToken(token);
    if (!/^[a-f0-9]{64}$/.test(tokenHash)) throw new MaxError("INTERNAL", "The invitation token hasher is unavailable.");
    return this.store.transaction(async (tx) => {
      const now = this.now();
      await this.organization(tx, actor, args.workspaceId, now, "workspace.manage_members");
      const invitations = bounded(await tx.listOpenInvitations(args.workspaceId, now), COLLABORATION_LIMITS.openInvitationsPerWorkspace);
      if (invitations.some((invitation) => invitation.recipientEmail === args.email))
        throw new MaxError("CONFLICT", "An unexpired invitation for this recipient already exists.");
      if (invitations.length >= COLLABORATION_LIMITS.openInvitationsPerWorkspace)
        throw new MaxError("LIMIT", "This workspace has too many pending invitations.");
      const invitation: CollaborationInvitation = {
        id: this.runtime.newId(),
        workspaceId: args.workspaceId,
        invitedBy: actor.userId,
        recipientEmail: args.email,
        role: args.role,
        tokenHash,
        createdAt: now,
        expiresAt: now + args.expiresInMs,
        state: "pending",
      };
      await tx.insertInvitation(invitation);
      await this.audit(tx, actor, args.workspaceId, "invitation.created", invitation.id, now, { role: invitation.role });
      return { invitation: publicInvitation(invitation), token };
    });
  }

  async listInvitations(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId } = parse(workspaceInput, input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      await this.organization(tx, actor, workspaceId, now, "workspace.manage_members");
      return { invitations: bounded(await tx.listOpenInvitations(workspaceId, now), COLLABORATION_LIMITS.openInvitationsPerWorkspace).map(publicInvitation) };
    });
  }

  async revokeInvitation(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { workspaceId, invitationId } = parse(workspaceInput.extend({ invitationId: identifier }), input);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      await this.organization(tx, actor, workspaceId, now, "workspace.manage_members");
      const invitation = await tx.getInvitation(invitationId);
      if (!invitation || invitation.workspaceId !== workspaceId) throw notFound("invitation");
      if (invitation.state !== "pending") return { revoked: false };
      await tx.putInvitation({ ...invitation, state: "revoked", revokedBy: actor.userId, revokedAt: now });
      await this.audit(tx, actor, workspaceId, "invitation.revoked", invitation.id, now);
      return { revoked: true };
    });
  }

  async acceptInvitation(resolvedActor: ResolvedCollaborationActor, input: unknown) {
    const actor = parse(actorSchema, resolvedActor);
    const { token } = parse(z.object({ token: z.string().max(128) }).strict(), input);
    if (!actor.verifiedEmail || !TOKEN_PATTERN.test(token)) throw notFound("invitation");
    const tokenHash = await this.runtime.hashInvitationToken(token);
    return this.store.transaction(async (tx) => {
      const now = this.now();
      const invitation = await tx.getInvitationByHash(tokenHash);
      if (!invitation || invitation.state !== "pending" || invitation.expiresAt <= now || invitation.recipientEmail !== actor.verifiedEmail)
        throw notFound("invitation");
      // Pending invitations cannot outlive their issuer's membership/authority.
      const issuer: ResolvedCollaborationActor = { userId: invitation.invitedBy, verifiedEmail: null };
      const context = await this.organization(tx, issuer, invitation.workspaceId, now, "workspace.manage_members");
      const existing = await tx.getMembership(invitation.workspaceId, actor.userId);
      let membership: CollaborationMembership;
      let joined = false;
      if (existing?.state === "active") {
        membership = existing;
      } else {
        const members = bounded(await tx.listWorkspaceMemberships(invitation.workspaceId), COLLABORATION_LIMITS.membersPerWorkspace);
        if (existing && !canChangeMembership(context.policy, members, actor.userId, { state: "active", role: invitation.role })) throw notFound("invitation");
        if (!existing) {
          if (members.length >= COLLABORATION_LIMITS.membersPerWorkspace) throw new MaxError("LIMIT", "This workspace has too many members.");
          if (bounded(await tx.listUserMemberships(actor.userId), COLLABORATION_LIMITS.membershipsPerUser).length >= COLLABORATION_LIMITS.membershipsPerUser)
            throw new MaxError("LIMIT", "This account has too many workspace memberships.");
        }
        membership = {
          workspaceId: invitation.workspaceId,
          userId: actor.userId,
          role: invitation.role,
          state: "active",
          joinedAt: existing?.joinedAt ?? now,
          updatedAt: now,
        };
        await tx.putMembership(membership);
        joined = true;
      }
      await tx.putInvitation({ ...invitation, state: "accepted", acceptedBy: actor.userId, acceptedAt: now });
      await this.audit(tx, actor, invitation.workspaceId, "invitation.accepted", invitation.id, now, { joined });
      return { workspaceId: invitation.workspaceId, membership, joined };
    });
  }
}
