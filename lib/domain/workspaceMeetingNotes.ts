import {
  nextAutomationRevision,
} from "./workspaceAutomationRules";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";

/** PR42: shadow manual meeting notes. This is not a page, permission grant,
 * calendar integration, task creator, notification, or automation runner. */
export const MAX_MEETINGS_PER_DATABASE = 32;
export const MAX_MEETING_ITEMS = 12;
export type MeetingRecurrence = "none" | "weekly" | "monthly";
export type MeetingState = "draft" | "archived";
export interface MeetingAction {
  text: string;
  status: "open" | "done";
  dueAt: number | null;
}
export interface MeetingInput {
  title: string;
  scheduledAt: number;
  recurrence: MeetingRecurrence;
  meetingLink: string | null;
  participants: string[];
  agenda: string[];
  decisions: string[];
  actions: MeetingAction[];
}
export interface MeetingRow extends MeetingInput {
  rowId: string;
  workspaceId: string;
  databaseId: string;
  meetingKey: string;
  createdByAccountId: string;
  state: MeetingState;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}
export interface MeetingPreview {
  meetingKey: string;
  title: string;
  scheduledAt: number;
  recurrence: MeetingRecurrence;
  state: MeetingState;
  updatedAt: number;
}
export interface MeetingSummary {
  meetings: number;
  upcoming: number;
  archived: number;
  openActions: number;
  doneActions: number;
}
const MAX_TIME = 4102444800000;
const time = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0 && n <= MAX_TIME;
const label = (s: unknown, max: number, allowEmpty = false): s is string =>
  typeof s === "string" && s === s.trim() && s.length <= max &&
  (allowEmpty || s.length > 0) && !/[\u0000-\u001f\u007f]/.test(s);
const labels = (items: unknown, maxLen: number): items is string[] =>
  Array.isArray(items) && items.length <= MAX_MEETING_ITEMS &&
  items.every((x) => label(x, maxLen)) &&
  new Set(items).size === items.length;
export function validMeetingLink(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string" || value.length > 500 || value.trim() !== value) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password &&
      !/[\u0000-\u001f\u007f]/.test(value);
  } catch { return false; }
}
export function validMeetingInput(input: MeetingInput): boolean {
  return !!input && label(input.title, 160) && time(input.scheduledAt) &&
    (input.recurrence === "none" || input.recurrence === "weekly" ||
      input.recurrence === "monthly") &&
    validMeetingLink(input.meetingLink) &&
    labels(input.participants, 80) && labels(input.agenda, 240) &&
    labels(input.decisions, 240) &&
    Array.isArray(input.actions) && input.actions.length <= MAX_MEETING_ITEMS &&
    input.actions.every((a) =>
      !!a && label(a.text, 240) &&
      (a.status === "open" || a.status === "done") &&
      (a.dueAt === null || time(a.dueAt))) &&
    // Small, bounded notes; this intentionally is not a free-form rich document.
    JSON.stringify(input).length <= 8000;
}
export function validMeetingRow(row: MeetingRow): boolean {
  if (!row || !validMeetingInput(row) ||
    !validScopeId(row.rowId) || !validWorkspaceId(row.workspaceId) ||
    !validScopeId(row.databaseId) || !validScopeId(row.meetingKey) ||
    !validPrincipalId(row.createdByAccountId) ||
    !time(row.createdAt) || !time(row.updatedAt) ||
    row.updatedAt < row.createdAt) return false;
  if (row.state === "draft") return row.archivedAt === null;
  return row.state === "archived" && time(row.archivedAt) &&
    row.archivedAt >= row.createdAt && row.archivedAt <= row.updatedAt;
}
export function validMeetingRegistry(
  rows: readonly MeetingRow[], workspaceId: string, databaseId: string,
): boolean {
  if (!validWorkspaceId(workspaceId) || !validScopeId(databaseId) ||
    rows.length > MAX_MEETINGS_PER_DATABASE) return false;
  const keys = new Set<string>(), ids = new Set<string>();
  for (const r of rows) {
    if (!validMeetingRow(r) || r.workspaceId !== workspaceId ||
      r.databaseId !== databaseId || keys.has(r.meetingKey) || ids.has(r.rowId)) return false;
    keys.add(r.meetingKey); ids.add(r.rowId);
  }
  return true;
}
export function meetingRevision(
  row: MeetingRow, expectedUpdatedAt: number, now: number,
): number | null {
  return validMeetingRow(row) && row.state === "draft" &&
    row.updatedAt === expectedUpdatedAt
    ? nextAutomationRevision(row.updatedAt, now) : null;
}
export function meetingPreview(row: MeetingRow): MeetingPreview {
  return { meetingKey: row.meetingKey, title: row.title,
    scheduledAt: row.scheduledAt, recurrence: row.recurrence,
    state: row.state, updatedAt: row.updatedAt };
}
/** Aggregate only after current manager authorization; never expose participant
 * names or meeting contents, and never approximate distinct-user tracking. */
export function meetingSummary(
  rows: readonly MeetingRow[], workspaceId: string, databaseId: string, now: number,
): MeetingSummary | null {
  if (!time(now) || !validMeetingRegistry(rows, workspaceId, databaseId)) return null;
  return rows.reduce<MeetingSummary>((sum, row) => {
    sum.meetings++;
    if (row.state === "archived") sum.archived++;
    if (row.state === "draft" && row.scheduledAt >= now) sum.upcoming++;
    for (const action of row.actions) {
      if (action.status === "open") sum.openActions++;
      else sum.doneActions++;
    }
    return sum;
  }, { meetings: 0, upcoming: 0, archived: 0, openActions: 0, doneActions: 0 });
}
