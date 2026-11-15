import {
  validMeetingRegistry, type MeetingRow,
} from "./workspaceMeetingNotes";

/**
 * PR43: a deliberately tiny, identity-free reporting projection. A report is
 * calculated only after the caller has been reauthorized in the Convex query.
 * No user-supplied text, identifiers or links are carried into the export.
 */
export const MAX_REPORT_WINDOW_MS = 93 * 24 * 60 * 60 * 1000;
const MAX_TIME = 4102444800000;
const validTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) &&
  value >= 0 && value <= MAX_TIME;

export interface MeetingReportPack {
  generatedAt: number;
  windowStart: number;
  windowEnd: number;
  totalMeetings: number;
  draftMeetings: number;
  archivedMeetings: number;
  scheduledDraftsInWindow: number;
  upcomingDraftsInWindow: number;
  pastDatedDrafts: number;
  weeklyDrafts: number;
  monthlyDrafts: number;
  openActions: number;
  doneActions: number;
  overdueOpenActions: number;
  openActionsDueInWindow: number;
  openActionsWithoutDueDate: number;
  archivedActionItems: number;
  handoffMarkdown: string;
}

/** Window is [start, end); a maximum of 93 days avoids expensive exports. */
export function validMeetingReportWindow(
  windowStart: unknown, windowEnd: unknown, generatedAt: unknown,
): boolean {
  return validTime(windowStart) && validTime(windowEnd) &&
    validTime(generatedAt) && windowEnd > windowStart &&
    windowEnd - windowStart <= MAX_REPORT_WINDOW_MS;
}

type Counts = Omit<MeetingReportPack, "handoffMarkdown">;

/**
 * Text is a fixed template over validated counts and timestamps only.
 * Never interpolate note titles, labels, participants, URLs, actor IDs,
 * page content or arbitrary caller-provided strings into ChatGPT handoff.
 */
export function formatMeetingReportHandoff(pack: Counts): string {
  const date = (n: number) => new Date(n).toISOString();
  return [
    "# Max workspace meeting report — aggregate only",
    "",
    "This is a deterministic summary for manual review. It contains no meeting",
    "content, participants, member identities, links or page-view analytics.",
    "It is not an AI-generated meeting summary or a source of task updates.",
    "",
    `Generated (UTC): ${date(pack.generatedAt)}`,
    `Window (UTC, end exclusive): ${date(pack.windowStart)} to ${date(pack.windowEnd)}`,
    "",
    "## Meeting-note inventory",
    `- Total notes: ${pack.totalMeetings}`,
    `- Draft notes: ${pack.draftMeetings}`,
    `- Archived notes: ${pack.archivedMeetings}`,
    `- Drafts scheduled in window: ${pack.scheduledDraftsInWindow}`,
    `- Upcoming drafts in window: ${pack.upcomingDraftsInWindow}`,
    `- Draft notes dated before report generation: ${pack.pastDatedDrafts}`,
    `- Draft recurrence labels — weekly: ${pack.weeklyDrafts}, monthly: ${pack.monthlyDrafts}`,
    "",
    "## Human-authored action items on draft notes",
    `- Open: ${pack.openActions}`,
    `- Done: ${pack.doneActions}`,
    `- Open and overdue: ${pack.overdueOpenActions}`,
    `- Open and due in window: ${pack.openActionsDueInWindow}`,
    `- Open without a due date: ${pack.openActionsWithoutDueDate}`,
    `- Historical action items on archived notes (excluded above): ${pack.archivedActionItems}`,
    "",
    "Action items are text-only records, not shared tasks. Recurrence metadata",
    "does not schedule events. Counts cannot establish attendance, completion",
    "of meetings, unique viewers or organization-wide adoption.",
  ].join("\n");
}

export function buildMeetingReportPack(
  rows: readonly MeetingRow[],
  workspaceId: string, databaseId: string,
  windowStart: number, windowEnd: number, generatedAt: number,
): MeetingReportPack | null {
  if (!validMeetingReportWindow(windowStart, windowEnd, generatedAt) ||
    !validMeetingRegistry(rows, workspaceId, databaseId)) return null;

  const pack: Counts = {
    generatedAt, windowStart, windowEnd,
    totalMeetings: rows.length, draftMeetings: 0, archivedMeetings: 0,
    scheduledDraftsInWindow: 0, upcomingDraftsInWindow: 0,
    pastDatedDrafts: 0, weeklyDrafts: 0, monthlyDrafts: 0,
    openActions: 0, doneActions: 0, overdueOpenActions: 0,
    openActionsDueInWindow: 0, openActionsWithoutDueDate: 0,
    archivedActionItems: 0,
  };
  for (const row of rows) {
    if (row.state === "archived") {
      pack.archivedMeetings++;
      pack.archivedActionItems += row.actions.length;
      continue;
    }
    pack.draftMeetings++;
    if (row.scheduledAt < generatedAt) pack.pastDatedDrafts++;
    if (row.recurrence === "weekly") pack.weeklyDrafts++;
    if (row.recurrence === "monthly") pack.monthlyDrafts++;
    if (row.scheduledAt >= windowStart && row.scheduledAt < windowEnd) {
      pack.scheduledDraftsInWindow++;
      if (row.scheduledAt >= generatedAt) pack.upcomingDraftsInWindow++;
    }
    for (const action of row.actions) {
      if (action.status === "done") {
        pack.doneActions++;
        continue;
      }
      pack.openActions++;
      if (action.dueAt === null) {
        pack.openActionsWithoutDueDate++;
        continue;
      }
      if (action.dueAt < generatedAt) pack.overdueOpenActions++;
      if (action.dueAt >= windowStart && action.dueAt < windowEnd)
        pack.openActionsDueInWindow++;
    }
  }
  return { ...pack, handoffMarkdown: formatMeetingReportHandoff(pack) };
}
