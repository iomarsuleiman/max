# Max 2.0 — PR35/44: Permission-Fenced Task View Projections

**Draft, stacked directly on PR34 (#63). Unmerged, undeployed, default OFF.** Branch: `feat/max-v2-35-authorized-task-view-projections`. Neither `main` nor `max-2.0` is modified.

## Scope

This PR introduces a **read-only shadow task-view query**, not a production UI or shared database migration:

- `workspaceDatabases.listTaskView`: server-authorized `list`, `board`, `calendar`, and `timeline` projections for existing registered workspace tasks.
- `list` sorts by title then stable task ID; `board` sorts by fixed task states then title; `calendar` and `timeline` sort by due-date milestone then title. No private document text, custom properties, formulas, rollups, task dependency expansion or attachments.
- Calendar accepts a **half-open UTC range** `[from, to)` of at most 45 days; timeline accepts at most 366 days. Tasks without a due date are omitted from date views. A due date is a **milestone**, not an invented start/end duration or Gantt span.
- `limit` must be 1–25. `after` is the ID of a task visible in the **current projection**. The cursor is reauthorized on every read; forged, hidden, revoked or out-of-range anchors fail closed. Ordering changes between pages can cause duplicates/skips; this is not snapshot-pinned pagination.
- A single bounded metadata scan (maximum **100** registered records, using the existing Convex `take(101)`) applies database and individual record permissions before projection. Only registered live tasks with valid typed semantics are projected. Untyped, wiki and project records are not returned.
- Every visible typed task is rechecked through PR33 semantics policy, including current project access. Hidden project IDs are redacted. Third-party assignee identities are never returned; only `assignedToMe` is exposed.
- Corrupt/duplicate semantic records, inconsistent ancestry, bad linked projects or backend failures return the same empty envelope as an inaccessible or empty view. No hidden counts, raw index offsets, private relation IDs, or partial results.
- No new database tables, dependencies, writers, bulk edits, UI/drag-and-drop, saved filters, view configuration, MCP routes or production enablement. Existing personal database views and BlockNote remain unchanged.

## Gates and rollback

Reads require all of:

1. `MAX_V2_SHARED_DATABASE_READS_ENABLED=true`
2. `MAX_V2_WORKSPACE_RECORD_SEMANTICS_READS_ENABLED=true`
3. `MAX_V2_TASK_VIEWS_READS_ENABLED=true`

**All default OFF. Do not enable in production.** PR35 adds no writer and does not require the PR34 task-relation gate. Roll back by leaving the new flag off and closing the unmerged draft. No data or user-facing migration occurs.

## Test plan and limitations

`tests/unit/workspaceTaskViews.test.ts` covers deterministic ordering, date-window boundaries, hidden records, hidden projects, other-assignee privacy, cursor revocation, invalid inputs, wrong-tenant/ancestry corruption, duplicate semantics, 100-candidate cap, missing identities and storage failures.

The current implementation intentionally rechecks authorization per record and is bounded to **100 records per database**. It is not a medium/large board solution, does not include persisted saved views, does not support multi-assignee task properties or reminders, and does not implement a timeline with actual start/end dates. These belong to later reviewed slices.

## Release blockers

- Exact-head GitHub CI (lint, root/Convex TypeScript, Vitest, backup, Next build, provider contracts, Chromium/WebKit) and independent code/security review.
- Real three-account Clerk/Convex authorization, revocation, project redaction and cursor tests.
- Performance/read-budget measurements, concurrency and pagination-drift tests, live isolated Convex backup/restore and attachment verification.
- Arabic/RTL/accessibility checks for eventual UI, review of stacked draft predecessors, and baseline reconciliation in [issue #42](https://github.com/iomarsuleiman/max/issues/42).
- No production activation, deployment or merge into `main` is authorized.

**Next:** PR36 can address team-wiki ownership, verification, expiry and stale-content cues under independent permissions and release gates. This PR does not claim to complete the shared database UI.
