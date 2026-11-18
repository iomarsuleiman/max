import { describe, expect, it } from "vitest";
import {
  MAX_MEETINGS_PER_DATABASE, meetingPreview, meetingRevision, meetingSummary,
  validMeetingInput, validMeetingLink, validMeetingRegistry, validMeetingRow,
  type MeetingInput, type MeetingRow,
} from "@/lib/domain/workspaceMeetingNotes";

const ws = "tenant01", db = "db01", now = 2000000000000;
const input: MeetingInput = {
  title: "Weekly planning", scheduledAt: now + 86400000,
  recurrence: "weekly", meetingLink: "https://meet.example.org/room",
  participants: ["Host", "Reviewer"], agenda: ["Review milestones"],
  decisions: ["Ship only after review"],
  actions: [
    { text: "Review migration", status: "open", dueAt: now + 1000 },
    { text: "Record risks", status: "done", dueAt: null },
  ],
};
const meeting: MeetingRow = {
  ...input, rowId: "meeting01", meetingKey: "weekly01",
  workspaceId: ws, databaseId: db, createdByAccountId: "clerk_owner",
  state: "draft", createdAt: now - 1000, updatedAt: now, archivedAt: null,
};
describe("Max 2.0 PR42 private manual meetings", () => {
  it("validates a complete human-authored meeting draft", () => {
    expect(validMeetingInput(input)).toBe(true);
    expect(validMeetingRow(meeting)).toBe(true);
  });
  it("permits an empty manual note without AI or a provider link", () => {
    expect(validMeetingInput({ ...input, meetingLink: null, participants: [],
      agenda: [], decisions: [], actions: [], recurrence: "none" })).toBe(true);
  });
  it("accepts only HTTPS links without embedded credentials", () => {
    expect(validMeetingLink(null)).toBe(true);
    expect(validMeetingLink("https://example.org/path?a=1")).toBe(true);
    for (const bad of ["http://example.org", "javascript:alert(1)", "https://a:b@x.com",
      "not a url", " https://example.org", "https://example.org\nx", "x".repeat(501)]) {
      expect(validMeetingLink(bad)).toBe(false);
    }
  });
  it("rejects blank and control-character titles", () => {
    for (const title of ["", " ", " leading", "ok\nno", "x".repeat(161)]) {
      expect(validMeetingInput({ ...input, title })).toBe(false);
    }
  });
  it("rejects too many agenda items, decisions and participants", () => {
    for (const field of ["agenda", "decisions", "participants"] as const) {
      expect(validMeetingInput({
        ...input, [field]: Array.from({ length: 13 }, (_, i) => "item" + i),
      })).toBe(false);
    }
  });
  it("rejects duplicate participants, invalid action state and long item text", () => {
    expect(validMeetingInput({ ...input, participants: ["A", "A"] })).toBe(false);
    expect(validMeetingInput({ ...input, actions: [{
      text: "x", status: "queued" as never, dueAt: null,
    }] })).toBe(false);
    expect(validMeetingInput({ ...input, actions: [{
      text: "x".repeat(241), status: "open", dueAt: null,
    }] })).toBe(false);
  });
  it("rejects overfull action items and invalid due dates", () => {
    expect(validMeetingInput({ ...input, actions: Array(13).fill(input.actions[0]) }))
      .toBe(false);
    expect(validMeetingInput({ ...input, actions: [{
      text: "Call back", status: "open", dueAt: NaN,
    }] })).toBe(false);
  });
  it("rejects invalid meeting time and recurrence", () => {
    expect(validMeetingInput({ ...input, scheduledAt: Infinity })).toBe(false);
    expect(validMeetingInput({ ...input, scheduledAt: -1 })).toBe(false);
    expect(validMeetingInput({ ...input, recurrence: "hourly" as never })).toBe(false);
  });
  it("caps total serialized content", () => {
    expect(validMeetingInput({
      ...input, agenda: Array.from({ length: 12 }, (_, i) => "a".repeat(230) + i),
      decisions: Array.from({ length: 12 }, (_, i) => "d".repeat(230) + i),
      actions: Array.from({ length: 12 }, (_, i) => ({
        text: "t".repeat(230) + i, status: "open" as const, dueAt: now,
      })),
    })).toBe(false);
  });
  it("rejects malformed creator, scope and timestamps", () => {
    expect(validMeetingRow({ ...meeting, createdByAccountId: "not a user" })).toBe(false);
    expect(validMeetingRow({ ...meeting, workspaceId: "bad" })).toBe(false);
    expect(validMeetingRow({ ...meeting, rowId: "" })).toBe(false);
    expect(validMeetingRow({ ...meeting, updatedAt: now - 2000 })).toBe(false);
  });
  it("requires exact draft/archived state invariants", () => {
    expect(validMeetingRow({ ...meeting, archivedAt: now })).toBe(false);
    const archived: MeetingRow = { ...meeting, state: "archived", archivedAt: now };
    expect(validMeetingRow(archived)).toBe(true);
    expect(validMeetingRow({ ...archived, archivedAt: null })).toBe(false);
    expect(validMeetingRow({ ...archived, archivedAt: now + 1 })).toBe(false);
    expect(validMeetingRow({ ...meeting, state: "published" as never })).toBe(false);
  });
  it("requires exact tenant and database scope", () => {
    expect(validMeetingRegistry([meeting], ws, db)).toBe(true);
    expect(validMeetingRegistry([{ ...meeting, workspaceId: "tenant02" }], ws, db))
      .toBe(false);
    expect(validMeetingRegistry([{ ...meeting, databaseId: "otherdb" }], ws, db))
      .toBe(false);
  });
  it("fails closed on duplicate note keys and row IDs", () => {
    expect(validMeetingRegistry([meeting, { ...meeting, rowId: "meeting02" }], ws, db))
      .toBe(false);
    expect(validMeetingRegistry([meeting, { ...meeting, meetingKey: "other" }], ws, db))
      .toBe(false);
  });
  it("caps shadow notes and does not recycle archived IDs", () => {
    const full = Array.from({ length: MAX_MEETINGS_PER_DATABASE }, (_, i) => ({
      ...meeting, meetingKey: "note" + i, rowId: "row" + i,
    }));
    expect(validMeetingRegistry(full, ws, db)).toBe(true);
    expect(validMeetingRegistry([...full, { ...meeting, meetingKey: "extra" }], ws, db))
      .toBe(false);
  });
  it("enforces revision compare-and-set, including stale writes", () => {
    expect(meetingRevision(meeting, now, now + 2000)).toBe(now + 2000);
    expect(meetingRevision(meeting, now - 1, now + 2000)).toBe(null);
    expect(meetingRevision(meeting, now, now - 500)).toBe(now + 1);
  });
  it("never reopens a terminal archived meeting", () => {
    expect(meetingRevision({
      ...meeting, state: "archived", archivedAt: now,
    }, now, now + 2000)).toBe(null);
  });
  it("projects minimal metadata without participants, decisions or action text", () => {
    const preview = meetingPreview(meeting);
    expect(preview.meetingKey).toBe("weekly01");
    expect(JSON.stringify(preview)).not.toContain("Host");
    expect(JSON.stringify(preview)).not.toContain("Ship only");
    expect(JSON.stringify(preview)).not.toContain("Review migration");
    expect(JSON.stringify(preview)).not.toContain("clerk_owner");
  });
  it("aggregates only bounded status counts for the current database", () => {
    expect(meetingSummary([meeting], ws, db, now)).toEqual({
      meetings: 1, upcoming: 1, archived: 0, openActions: 1, doneActions: 1,
    });
  });
  it("excludes archived notes from upcoming meetings, retains action totals", () => {
    expect(meetingSummary([
      { ...meeting, state: "archived", archivedAt: now },
    ], ws, db, now)).toEqual({
      meetings: 1, upcoming: 0, archived: 1, openActions: 1, doneActions: 1,
    });
  });
  it("returns zero-count report for a valid, empty registry", () => {
    expect(meetingSummary([], ws, db, now)).toEqual({
      meetings: 0, upcoming: 0, archived: 0, openActions: 0, doneActions: 0,
    });
  });
  it("fails closed on malformed timestamps, duplicates or tenant mixing", () => {
    expect(meetingSummary([meeting], ws, db, NaN)).toBe(null);
    expect(meetingSummary([meeting, meeting], ws, db, now)).toBe(null);
    expect(meetingSummary([meeting], "tenant02", db, now)).toBe(null);
  });
  it("does not imply task creation from manual action items", () => {
    const result = meetingSummary([meeting], ws, db, now);
    expect(result?.openActions).toBe(1);
    expect(Object.keys(result ?? {})).toEqual([
      "meetings", "upcoming", "archived", "openActions", "doneActions",
    ]);
  });
});
