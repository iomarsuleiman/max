import { authorizedSharedRecordCandidates } from "./sharedDatabasePolicy";
import { readAuthorizedRecordSemantics, type SharedSemanticStore } from "./workspaceRecordSemantics";
import { validPrincipalId, validScopeId, validWorkspaceId } from "./workspaceManagementPolicy";

/**
 * PR35: read-only, permission-filtered projections of shadow task metadata.
 * This is NOT a shared database UI or a personal database query. The trusted
 * store must use the same Convex transaction snapshot for metadata and ACLs.
 */
export type TaskViewKind = "list" | "board" | "calendar" | "timeline";
export interface TaskViewRequest {
  view: TaskViewKind;
  limit: number;
  after: string | null;
  from: number | null;
  to: number | null;
}
export interface AuthorizedTaskViewItem {
  recordId: string;
  title: string;
  state: "todo" | "in_progress" | "blocked" | "done";
  dueAt: number | null;
  assignedToMe: boolean;
  projectId: string | null;
  updatedAt: number;
}
export interface AuthorizedTaskViewPage {
  records: AuthorizedTaskViewItem[];
  nextCursor: string | null;
}
const EMPTY = (): AuthorizedTaskViewPage => ({ records: [], nextCursor: null });
const DAY = 24 * 60 * 60 * 1000;
const MAX_DATE = 4102444800000; // 2100-01-01 UTC
const STATES = ["todo", "in_progress", "blocked", "done"] as const;
const VIEWS: readonly string[] = ["list", "board", "calendar", "timeline"];

export function validTaskViewRequest(input: TaskViewRequest): boolean {
  if (!input || !VIEWS.includes(input.view) ||
      !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 25 ||
      (input.after !== null && (typeof input.after !== "string" || !validScopeId(input.after)))) return false;
  if (input.view === "list" || input.view === "board") {
    return input.from === null && input.to === null;
  }
  return typeof input.from === "number" && typeof input.to === "number" &&
    Number.isSafeInteger(input.from) && Number.isSafeInteger(input.to) &&
    input.from >= 0 && input.to <= MAX_DATE && input.to > input.from &&
    input.to - input.from <= (input.view === "calendar" ? 45 : 366) * DAY;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortForView(items: AuthorizedTaskViewItem[], view: TaskViewKind): void {
  items.sort((a, b) => {
    if (view === "board") {
      const byState = STATES.indexOf(a.state) - STATES.indexOf(b.state);
      if (byState !== 0) return byState;
    }
    if (view === "calendar" || view === "timeline") {
      const byDue = (a.dueAt ?? MAX_DATE) - (b.dueAt ?? MAX_DATE);
      if (byDue !== 0) return byDue;
    }
    return compareText(a.title, b.title) || compareText(a.recordId, b.recordId);
  });
}

/**
 * A cursor is a task ID visible in the CURRENT projection, never an offset into
 * unfiltered data. Every request reauthorizes the database, each record and
 * linked project. A revoked, forged or out-of-window cursor returns empty.
 *
 * Untyped records are skipped. If an authorized record claims semantics but
 * they are corrupt, duplicate or become unreadable, the entire page fails
 * closed rather than returning a partially verified result.
 */
export async function pageAuthorizedTaskView(
  store: SharedSemanticStore,
  accountId: string | null,
  workspaceId: string,
  databaseId: string,
  request: TaskViewRequest,
): Promise<AuthorizedTaskViewPage> {
  if (!accountId || !validPrincipalId(accountId) ||
      !validWorkspaceId(workspaceId) || !validScopeId(databaseId) ||
      !validTaskViewRequest(request) || request.after === databaseId) return EMPTY();
  try {
    // Existing PR31/32 policy enforces a 100-record indexed scan, database and
    // record permissions, valid ancestry, and hidden-record filtering.
    const visible = await authorizedSharedRecordCandidates(
      store, accountId, workspaceId, databaseId,
    );
    const records: AuthorizedTaskViewItem[] = [];
    for (const metadata of visible) {
      const rows = await store.semanticRows(metadata.pageId);
      if (rows.length === 0) continue; // Legacy/untyped shadow record.
      if (rows.length !== 1) return EMPTY();
      const semantic = await readAuthorizedRecordSemantics(
        store, accountId, workspaceId, databaseId, metadata.pageId,
      );
      if (!semantic) return EMPTY();
      if (semantic.kind !== "task") continue;
      if (!STATES.includes(semantic.state as typeof STATES[number])) return EMPTY();
      if ((request.view === "calendar" || request.view === "timeline") &&
          (semantic.dueAt === null || semantic.dueAt < request.from! || semantic.dueAt >= request.to!)) continue;
      records.push({
        recordId: metadata.pageId,
        title: metadata.title,
        state: semantic.state as AuthorizedTaskViewItem["state"],
        dueAt: semantic.dueAt,
        assignedToMe: semantic.assignedToMe,
        projectId: semantic.projectId, // PR33 already redacts hidden projects.
        updatedAt: Math.max(metadata.updatedAt, semantic.updatedAt),
      });
    }
    sortForView(records, request.view);
    let start = 0;
    if (request.after !== null) {
      const index = records.findIndex((row) => row.recordId === request.after);
      if (index < 0) return EMPTY();
      start = index + 1;
    }
    const page = records.slice(start, start + request.limit);
    return {
      records: page,
      nextCursor: page.length && start + request.limit < records.length
        ? page[page.length - 1].recordId : null,
    };
  } catch {
    return EMPTY(); // No partial rows or hidden counts on failures/revocation.
  }
}
