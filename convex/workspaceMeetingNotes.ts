import {
  mutationGeneric, queryGeneric, type GenericDataModel, type GenericQueryCtx,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import { automationStore } from "./workspaceAutomationRules";
import { canManageAutomationScope } from "../lib/domain/workspaceAutomationRules";
import {
  MAX_MEETINGS_PER_DATABASE, meetingPreview, meetingRevision, meetingSummary,
  validMeetingInput, validMeetingRegistry, type MeetingInput, type MeetingRow,
} from "../lib/domain/workspaceMeetingNotes";
import { validPrincipalId, validScopeId, validWorkspaceId } from "../lib/domain/workspaceManagementPolicy";

/** PR42: isolated MANUAL notes and aggregate counts, not active automation,
 * task delivery, shared page storage, calendar integration or MCP. */
type Ctx = Pick<GenericQueryCtx<GenericDataModel>, "db" | "auth">;
const READ_GATE = "MAX_V2_MEETING_NOTES_READS_ENABLED";
const WRITE_GATE = "MAX_V2_MEETING_NOTES_WRITES_ENABLED";
const nullableTimeV = v.union(v.number(), v.null());
const recurrenceV = v.union(v.literal("none"), v.literal("weekly"), v.literal("monthly"));
const stateV = v.union(v.literal("draft"), v.literal("archived"));
const actionV = v.object({
  text: v.string(), status: v.union(v.literal("open"), v.literal("done")),
  dueAt: nullableTimeV,
});
const inputV = {
  title: v.string(), scheduledAt: v.number(), recurrence: recurrenceV,
  meetingLink: v.union(v.string(), v.null()),
  participants: v.array(v.string()), agenda: v.array(v.string()),
  decisions: v.array(v.string()), actions: v.array(actionV),
};
const previewV = v.object({
  meetingKey: v.string(), title: v.string(), scheduledAt: v.number(),
  recurrence: recurrenceV, state: stateV, updatedAt: v.number(),
});
const detailV = v.object({
  meetingKey: v.string(), ...inputV,
  state: stateV, createdAt: v.number(), updatedAt: v.number(),
});
function denied(): never {
  throw new ConvexError({ code: "FORBIDDEN", message: "Meeting notes operation denied." });
}
function canRead(): boolean {
  return process.env[READ_GATE] === "true" &&
    process.env.MAX_V2_SHARED_DATABASE_READS_ENABLED === "true";
}
function canWrite(): void {
  if (process.env[WRITE_GATE] !== "true" ||
    process.env.MAX_V2_WORKSPACE_WRITES_ENABLED !== "true" ||
    process.env.MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED !== "true") denied();
}
async function who(ctx: Ctx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity?.subject || !validPrincipalId(identity.subject)) denied();
  return identity.subject;
}
async function manager(ctx: Ctx, actor: string, ws: string, db: string): Promise<void> {
  if (!validWorkspaceId(ws) || !validScopeId(db) ||
    !(await canManageAutomationScope(automationStore(ctx), actor, ws, db))) denied();
}
async function allMeetings(ctx: Ctx, ws: string, db: string): Promise<MeetingRow[]> {
  const rows = await ctx.db.query("workspaceMeetingNotes")
    .withIndex("by_workspace_database", (q) =>
      (q.eq("workspaceId", ws) as unknown as {
        eq(field: string, value: string): never;
      }).eq("databaseId", db))
    .take(MAX_MEETINGS_PER_DATABASE + 1);
  const result: MeetingRow[] = rows.map((r) => ({
    rowId: r._id as string, workspaceId: r.workspaceId,
    databaseId: r.databaseId, meetingKey: r.meetingKey,
    createdByAccountId: r.createdByAccountId,
    title: r.title, scheduledAt: r.scheduledAt, recurrence: r.recurrence,
    meetingLink: r.meetingLink, participants: r.participants,
    agenda: r.agenda, decisions: r.decisions, actions: r.actions,
    state: r.state, createdAt: r.createdAt,
    updatedAt: r.updatedAt, archivedAt: r.archivedAt,
  } as unknown as MeetingRow));
  if (!validMeetingRegistry(result, ws, db)) denied();
  return result;
}
function input(a: MeetingInput): MeetingInput {
  const value = {
    title: a.title, scheduledAt: a.scheduledAt, recurrence: a.recurrence,
    meetingLink: a.meetingLink, participants: a.participants,
    agenda: a.agenda, decisions: a.decisions, actions: a.actions,
  };
  if (!validMeetingInput(value)) denied();
  return value;
}

/** Current managers alone can list bounded previews; never participant names. */
export const listMeetingNotes = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string() },
  returns: v.array(previewV),
  handler: async (ctx, a) => {
    if (!canRead()) return [];
    try {
      await manager(ctx, await who(ctx), a.workspaceId, a.databaseId);
      return (await allMeetings(ctx, a.workspaceId, a.databaseId))
        .map(meetingPreview).sort((a, b) => a.meetingKey.localeCompare(b.meetingKey));
    } catch { return []; }
  },
});

/** Full private manual note, reauthorized on every request. */
export const getMeetingNote = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(), meetingKey: v.string() },
  returns: v.union(v.null(), detailV),
  handler: async (ctx, a) => {
    if (!canRead() || !validScopeId(a.meetingKey)) return null;
    try {
      await manager(ctx, await who(ctx), a.workspaceId, a.databaseId);
      const found = (await allMeetings(ctx, a.workspaceId, a.databaseId))
        .find((m) => m.meetingKey === a.meetingKey);
      if (!found) return null;
      return { meetingKey: found.meetingKey, ...input(found),
        state: found.state, createdAt: found.createdAt, updatedAt: found.updatedAt };
    } catch { return null; }
  },
});

/** No page or task is created. This only writes a bounded shadow draft. */
export const createMeetingNote = mutationGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(),
    meetingKey: v.string(), ...inputV },
  returns: v.id("workspaceMeetingNotes"),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    if (!validScopeId(a.meetingKey)) denied();
    await manager(ctx, actor, a.workspaceId, a.databaseId);
    const value = input(a);
    const rows = await allMeetings(ctx, a.workspaceId, a.databaseId);
    if (rows.length >= MAX_MEETINGS_PER_DATABASE ||
      rows.some((r) => r.meetingKey === a.meetingKey)) denied();
    const id = await ctx.db.insert("workspaceMeetingNotes", {
      workspaceId: a.workspaceId, databaseId: a.databaseId,
      meetingKey: a.meetingKey, createdByAccountId: actor, ...value,
      state: "draft" as const, createdAt: now, updatedAt: now, archivedAt: null,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.workspaceId, actorId: actor,
      operation: "meeting_note.created", targetId: a.databaseId,
      previous: null, next: "draft", at: now,
    });
    return id;
  },
});

/** Revision-protected replacement. No external action-item side effects. */
export const updateMeetingNote = mutationGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(),
    meetingKey: v.string(), expectedUpdatedAt: v.number(), ...inputV },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    if (!validScopeId(a.meetingKey)) denied();
    await manager(ctx, actor, a.workspaceId, a.databaseId);
    const value = input(a);
    const row = (await allMeetings(ctx, a.workspaceId, a.databaseId))
      .find((r) => r.meetingKey === a.meetingKey);
    if (!row) denied();
    const revision = meetingRevision(row, a.expectedUpdatedAt, now);
    if (revision === null) denied();
    await ctx.db.patch(row.rowId as never, { ...value, updatedAt: revision });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.workspaceId, actorId: actor,
      operation: "meeting_note.updated", targetId: a.databaseId,
      previous: "draft", next: "draft", at: now,
    });
    return revision;
  },
});

/** Terminal archive; deletion/recovery and key recycling are not exposed. */
export const archiveMeetingNote = mutationGeneric({
  args: { workspaceId: v.string(), databaseId: v.string(),
    meetingKey: v.string(), expectedUpdatedAt: v.number() },
  returns: v.number(),
  handler: async (ctx, a) => {
    canWrite();
    const actor = await who(ctx), now = Date.now();
    if (!validScopeId(a.meetingKey)) denied();
    await manager(ctx, actor, a.workspaceId, a.databaseId);
    const row = (await allMeetings(ctx, a.workspaceId, a.databaseId))
      .find((r) => r.meetingKey === a.meetingKey);
    if (!row) denied();
    const revision = meetingRevision(row, a.expectedUpdatedAt, now);
    if (revision === null) denied();
    await ctx.db.patch(row.rowId as never, {
      state: "archived" as const, archivedAt: now, updatedAt: revision,
    });
    await ctx.db.insert("workspaceSecurityEvents", {
      workspaceId: a.workspaceId, actorId: actor,
      operation: "meeting_note.archived", targetId: a.databaseId,
      previous: "draft", next: "archived", at: now,
    });
    return revision;
  },
});

/** Bounded, identity-free manager report; no tracking of page views or users. */
export const getMeetingSummary = queryGeneric({
  args: { workspaceId: v.string(), databaseId: v.string() },
  returns: v.union(v.null(), v.object({
    meetings: v.number(), upcoming: v.number(), archived: v.number(),
    openActions: v.number(), doneActions: v.number(),
  })),
  handler: async (ctx, a) => {
    if (!canRead()) return null;
    try {
      await manager(ctx, await who(ctx), a.workspaceId, a.databaseId);
      return meetingSummary(
        await allMeetings(ctx, a.workspaceId, a.databaseId),
        a.workspaceId, a.databaseId, Date.now(),
      );
    } catch { return null; }
  },
});
