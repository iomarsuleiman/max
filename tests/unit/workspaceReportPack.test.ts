import { describe, expect, it } from "vitest";
import {
  buildMeetingReportPack, formatMeetingReportHandoff,
  MAX_REPORT_WINDOW_MS, validMeetingReportWindow,
} from "@/lib/domain/workspaceReportPack";
import {
  MAX_MEETINGS_PER_DATABASE, type MeetingRow,
} from "@/lib/domain/workspaceMeetingNotes";

const workspaceId = "tenant01", databaseId = "db01";
const now = Date.UTC(2026, 10, 15, 12);
const day = 86400000;
const from = now, to = now + 7 * day;
const draft: MeetingRow = {
  rowId: "meeting01", meetingKey: "weekly01", workspaceId, databaseId,
  createdByAccountId: "clerk_owner",
  title: "PRIVATE meeting title", scheduledAt: now + day, recurrence: "weekly",
  meetingLink: "https://secret.example.com/meeting",
  participants: ["PRIVATE PARTICIPANT"], agenda: ["PRIVATE AGENDA"],
  decisions: ["PRIVATE DECISION"],
  actions: [
    { text: "PRIVATE ACTION 1", status: "open", dueAt: now - day },
    { text: "PRIVATE ACTION 2", status: "open", dueAt: now + day },
    { text: "PRIVATE ACTION 3", status: "open", dueAt: null },
    { text: "PRIVATE DONE ACTION", status: "done", dueAt: now + day },
  ],
  state: "draft", createdAt: now - 10 * day, updatedAt: now - day,
  archivedAt: null,
};
function report(rows: readonly MeetingRow[] = [draft], at = now, start = from, end = to) {
  return buildMeetingReportPack(rows, workspaceId, databaseId, start, end, at);
}

describe("Max 2.0 PR43 private ChatGPT-ready reporting pack", () => {
  it("reports a valid seven-day UTC window", () => {
    expect(validMeetingReportWindow(from, to, now)).toBe(true);
  });
  it("rejects zero-length and inverted windows", () => {
    expect(validMeetingReportWindow(from, from, now)).toBe(false);
    expect(validMeetingReportWindow(to, from, now)).toBe(false);
  });
  it("rejects windows exceeding the resource cap", () => {
    expect(validMeetingReportWindow(from, from + MAX_REPORT_WINDOW_MS, now)).toBe(true);
    expect(validMeetingReportWindow(from, from + MAX_REPORT_WINDOW_MS + 1, now)).toBe(false);
  });
  it("rejects NaN, fractions, negative values and timestamps beyond year 2100", () => {
    for (const invalid of [NaN, Infinity, -1, 1.2, 4102444800001, "2026"]) {
      expect(validMeetingReportWindow(invalid, to, now)).toBe(false);
      expect(validMeetingReportWindow(from, invalid, now)).toBe(false);
      expect(validMeetingReportWindow(from, to, invalid)).toBe(false);
    }
  });
  it("safely produces zero counts for an empty registry", () => {
    const pack = report([]);
    expect(pack?.totalMeetings).toBe(0);
    expect(pack?.openActions).toBe(0);
    expect(pack?.handoffMarkdown).toContain("- Total notes: 0");
  });
  it("counts only draft action items as actionable", () => {
    const pack = report();
    expect(pack?.draftMeetings).toBe(1);
    expect(pack?.openActions).toBe(3);
    expect(pack?.doneActions).toBe(1);
    expect(pack?.overdueOpenActions).toBe(1);
    expect(pack?.openActionsDueInWindow).toBe(1);
    expect(pack?.openActionsWithoutDueDate).toBe(1);
  });
  it("never converts human-authored text to a task or automatic event", () => {
    const pack = report()!;
    expect(Object.keys(pack)).not.toContain("tasksCreated");
    expect(pack.handoffMarkdown).toContain("not shared tasks");
  });
  it("excludes archived note action items from actionable counts", () => {
    const archived: MeetingRow = {
      ...draft, rowId: "archived01", meetingKey: "archived01",
      state: "archived", archivedAt: now,
      updatedAt: now,
    };
    const pack = report([archived]);
    expect(pack?.archivedMeetings).toBe(1);
    expect(pack?.archivedActionItems).toBe(4);
    expect(pack?.openActions).toBe(0);
    expect(pack?.scheduledDraftsInWindow).toBe(0);
  });
  it("counts past-dated draft notes without claiming they are overdue meetings", () => {
    const pack = report([{ ...draft, scheduledAt: now - day }]);
    expect(pack?.pastDatedDrafts).toBe(1);
    expect(pack?.upcomingDraftsInWindow).toBe(0);
  });
  it("honors start-inclusive and end-exclusive date boundaries", () => {
    expect(report([{ ...draft, scheduledAt: from }])?.scheduledDraftsInWindow).toBe(1);
    expect(report([{ ...draft, scheduledAt: to }])?.scheduledDraftsInWindow).toBe(0);
    const atBoundary = { ...draft, actions: [{ text: "item", status: "open" as const, dueAt: to }] };
    expect(report([atBoundary])?.openActionsDueInWindow).toBe(0);
  });
  it("upcoming means future relative to generation time, not just window position", () => {
    const pack = report([{ ...draft, scheduledAt: now + day }], now + 2 * day);
    expect(pack?.scheduledDraftsInWindow).toBe(1);
    expect(pack?.upcomingDraftsInWindow).toBe(0);
    expect(pack?.pastDatedDrafts).toBe(1);
  });
  it("treats weekly and monthly recurrence as passive labels", () => {
    const second = {
      ...draft, rowId: "second01", meetingKey: "second01", recurrence: "monthly" as const,
    };
    const pack = report([draft, second]);
    expect(pack?.weeklyDrafts).toBe(1);
    expect(pack?.monthlyDrafts).toBe(1);
  });
  it("never exposes free text, participants, URLs, account IDs or scope IDs", () => {
    const pack = report()!;
    const serialized = JSON.stringify(pack);
    for (const secret of [
      draft.title, "PRIVATE PARTICIPANT", "PRIVATE AGENDA", "PRIVATE DECISION",
      "PRIVATE ACTION", "secret.example.com", "clerk_owner",
      workspaceId, databaseId, draft.meetingKey,
    ]) expect(serialized).not.toContain(secret);
  });
  it("renders deterministic UTC markdown without user-controlled templates", () => {
    const pack = report()!;
    expect(formatMeetingReportHandoff(pack)).toBe(pack.handoffMarkdown);
    expect(pack.handoffMarkdown).toContain("2026-11-15T12:00:00.000Z");
    expect(pack.handoffMarkdown).toContain("end exclusive");
  });
  it("fails closed on cross-tenant rows", () => {
    expect(report([{ ...draft, workspaceId: "tenant02" }])).toBeNull();
    expect(report([{ ...draft, databaseId: "otherdb" }])).toBeNull();
  });
  it("fails closed on duplicate row identities or meeting keys", () => {
    expect(report([draft, draft])).toBeNull();
    expect(report([draft, { ...draft, rowId: "newrow01" }])).toBeNull();
    expect(report([draft, { ...draft, meetingKey: "newnote01" }])).toBeNull();
  });
  it("fails closed on corrupt content", () => {
    expect(report([{ ...draft, title: "invalid\ncontrol" }])).toBeNull();
    expect(report([{ ...draft, recurrence: "daily" as never }])).toBeNull();
  });
  it("supports the bounded maximum but denies overfull registries", () => {
    const full = Array.from({ length: MAX_MEETINGS_PER_DATABASE }, (_, i) => ({
      ...draft, rowId: "row" + i, meetingKey: "note" + i,
    }));
    expect(report(full)?.totalMeetings).toBe(MAX_MEETINGS_PER_DATABASE);
    expect(report([...full, { ...draft, rowId: "overfull", meetingKey: "overfull" }])).toBeNull();
  });
  it("does not attach a workspace access grant or an execution status", () => {
    const pack = report()!;
    for (const forbidden of ["allowed", "permission", "accessToken", "webhookUrl", "recipientId", "runId"])
      expect(Object.keys(pack)).not.toContain(forbidden);
  });
});
