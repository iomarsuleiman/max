# Max 2.0 — PR35/44: Authorized Bounded Task List & Board Read Model

**Draft stacked on PR34 (#63). Unmerged, not deployed.** The branch `feat/max-v2-35-authorized-task-views` is based on `feat/max-v2-34-scoped-task-relations`; `main` and `max-2.0` are not modified.

## Scope

- `lib/domain/workspaceTaskViews.ts` composes PR32's authorized metadata cursor pagination with PR33's live, record-level semantic authorization; all reads remain in one trusted Convex query snapshot.
- New `workspaceDatabases.listTaskView` query projects **only authorized, typed task metadata**: record ID, registered title, task state, due date, whether the caller is assigned, redacted authorized project ID and last update timestamp. It returns at most 25 **metadata candidates** per page; some may be untyped, non-task or excluded by state filtering.
- A cursor references the last **visible metadata row**, even if it is not a returned task after filtering. This is intentional: each new request reauthorizes the cursor against the live candidate/ACL snapshot. An empty task page may have a cursor if later metadata remains.
- Client list and board presentation may group the authorized state values (`todo`, `in_progress`, `blocked`, `done`) without server-side hidden counts. This PR has **no interactive board**, drag/drop, calendar/timeline UI, aggregation, due-date notifications or task mutation.
- Missing typed semantics on an otherwise registered record means the record is skipped. Duplicate, malformed or foreign semantic records; broken project links; invalid ancestry; authorization failure; and backend errors fail the whole page closed.
- Unreadable but otherwise valid project associations are redacted using PR33 semantics. No other user's assignee ID, hidden task ID/title/count, parent/dependency relationship, wiki text, document body, arbitrary properties, rollup or formula is returned.

## Default-OFF activation

The new task view endpoint requires *all*:

1. `MAX_V2_SHARED_DATABASE_READS_ENABLED=true`
2. `MAX_V2_WORKSPACE_RECORD_SEMANTICS_READS_ENABLED=true`
3. `MAX_V2_TASK_VIEW_READS_ENABLED=true`

**Do not turn these flags on in production.** The new API is read-only. PR34 task-relation flags are not needed because no task hierarchy/dependencies are fetched. Existing scoped metadata, task-relations and personal notes are not modified.

## Pagination, filtering and consistency

The backend retains the existing **100 metadata records per database** scan cap and 25-candidate page limit. There is no promise of scalable DB pagination; every page requires server-side permission evaluation of the bounded candidate set and typed records. A `state` filter is applied *after* metadata paging, so it does not guarantee a full result page. Clients must advance an available cursor and stop on a null cursor; they must not infer hidden counts from gaps. A cursor can become invalid due to revocation, deletion or metadata changes, and in that case the endpoint safely returns an empty page.

In a single Convex read snapshot, a filtered task must pass the registered database/record ACL gates, typed state validation and linked project integrity checks. The server receives no user-supplied permission rows. Only the authenticated identity is used.

## Evidence and outstanding release gates

- New `tests/unit/workspaceTaskViews.test.ts` covers task-only responses, self-assignment privacy, hidden records/projects, filtered sparse pages, authorized cursor stability, revoked/forged cursors, corrupt and duplicate state, invalid ancestry, request caps, absent identities and backend failure.
- CI acceptance: ESLint, root+Convex TypeScript, Vitest, backup/recovery, production build, provider probe/contract, Chromium/WebKit and additional browser labs. Check the exact PR head; a passing configured dependency audit (which has `continue-on-error`) is not an independent security clearance.
- Still blocked: true multi-account Clerk+Convex revocation and concurrent mutation evidence; independent security review; restored cloud backup including shadow records and assets; Arabic/RTL assistive tech; measured query budgets and 100-record cap review; upstream draft review and [baseline issue #42](https://github.com/iomarsuleiman/max/issues/42).

**Rollback:** leave the task-view and other Max 2.0 read gates OFF; close the unmerged PR. No schema migration, shared document publication, mainline merge or deployment is authorized.
