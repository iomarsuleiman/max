import { pageAuthorizedSharedRecords } from "./sharedDatabasePolicy";
import {
  readAuthorizedRecordSemantics,
  type SharedSemanticStore,
} from "./workspaceRecordSemantics";

/**
 * PR35: bounded, server-authorized task view read model. Not an aggregate or a
 * scheduler; the caller supplies a TRUSTED Convex snapshot, never browser rows.
 * A cursor anchors the page of visible metadata (including non-task records),
 * not the filtered task subset. This prevents unstable/unauthorized cursors.
 */
export const TASK_VIEW_STATES = ["todo", "in_progress", "blocked", "done"] as const;
export type TaskViewState = (typeof TASK_VIEW_STATES)[number];

export interface TaskViewRecord {
  recordId: string;
  title: string;
  state: TaskViewState;
  dueAt: number | null;
  assignedToMe: boolean;
  projectId: string | null;
  updatedAt: number;
}
export interface TaskViewPage {
  records: TaskViewRecord[];
  nextCursor: string | null;
}
const empty = (): TaskViewPage => ({ records: [], nextCursor: null });

/**
 * The only rows returned have fresh database AND record permissions. The linked
 * project's own ACL is checked by PR33's reader; a valid hidden project is
 * redacted. Third-party assignee IDs, relation IDs, hidden totals, formulas and
 * document bodies never enter this view.
 *
 * Missing semantics mean a registered but untyped record (skip it). A malformed
 * typed record, duplicate semantics, broken project link or backend exception
 * invalidates the WHOLE page instead of returning a partial result.
 */
export async function readAuthorizedTaskViewPage(
  store: SharedSemanticStore,
  verifiedAccountId: string | null,
  workspaceId: string,
  databaseId: string,
  limit = 20,
  after: string | null = null,
  state: TaskViewState | null = null,
): Promise<TaskViewPage> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 25 ||
      (state !== null && !TASK_VIEW_STATES.includes(state))) return empty();
  try {
    const page = await pageAuthorizedSharedRecords(
      store, verifiedAccountId, workspaceId, databaseId, limit, after,
    );
    const records: TaskViewRecord[] = [];
    for (const item of page.records) {
      const rows = await store.semanticRows(item.pageId);
      if (rows.length === 0) continue; // Not yet a typed task/project/wiki.
      if (rows.length !== 1) return empty();
      const preview = await readAuthorizedRecordSemantics(
        store, verifiedAccountId, workspaceId, databaseId, item.pageId,
      );
      if (!preview) return empty();
      if (preview.kind !== "task") continue;
      if (!TASK_VIEW_STATES.includes(preview.state as TaskViewState)) return empty();
      if (state !== null && preview.state !== state) continue;
      records.push({
        recordId: item.pageId,
        title: item.title,
        state: preview.state as TaskViewState,
        dueAt: preview.dueAt,
        assignedToMe: preview.assignedToMe,
        projectId: preview.projectId,
        updatedAt: Math.max(item.updatedAt, preview.updatedAt),
      });
    }
    return { records, nextCursor: page.nextCursor };
  } catch {
    return empty();
  }
}
