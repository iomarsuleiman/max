# Max 2.0 — PR34/44: Scoped Task Hierarchy, Dependencies & Cycle Fences

**Draft stacked on PR33 (#62). Unmerged, undeployed and disabled by default.** The feature branch is `feat/max-v2-34-scoped-task-relations`. Neither `main` nor `max-2.0` changes. Personal pages, documents, BlockNote, asset storage and MCP stay untouched.

## Exact scope

- A separate Convex `workspaceTaskRelations` table for an **existing registered task** with an optional parent task ID, at most eight dependency task IDs, archived marker and server-controlled compare-and-set timestamp.
- Both parent and dependency edges must point to existing live **task** records in the same registered shadow database and workspace. A project or wiki cannot be a parent task or dependency.
- Per-database AND per-record edit authority on writes. The author also needs current view permission for every proposed linked task.
- A bounded snapshot of at most **100 relation rows** is checked for duplicate IDs, malformed IDs, wrong tenant/database, unsafe timestamps and cycles across **both** parent and dependency edges before the mutation commits.
- Existing PR32 metadata cap of 100 records per database remains. The graph is explicitly **not a scalable or production task scheduler**.
- Read responses reveal only authorized parent/dependency IDs. Hidden-but-valid task links are omitted and never counted; corrupt or unregistered links cause a null result. No private documents, relation targets' titles, third-party assignments, rollups or calculated values are exposed.
- The new API is `workspaceDatabases.readTaskRelations` and `workspaceDatabases.upsertTaskRelations`; there is no production UI, board, drag-and-drop, notifications, automation, task completion propagation or MCP expansion.

## Feature flags

Reads require all three:

1. `MAX_V2_SHARED_DATABASE_READS_ENABLED=true`
2. `MAX_V2_WORKSPACE_RECORD_SEMANTICS_READS_ENABLED=true`
3. `MAX_V2_TASK_RELATIONS_READS_ENABLED=true`

Writes require all four:

1. `MAX_V2_WORKSPACE_WRITES_ENABLED=true`
2. `MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED=true`
3. `MAX_V2_WORKSPACE_RECORD_SEMANTICS_WRITES_ENABLED=true`
4. `MAX_V2_TASK_RELATIONS_WRITES_ENABLED=true`

All flags default **OFF**. Do **not** enable them in production. Roll back by leaving flags off and closing the draft. No data migration has been authorized.

## Transactional write protocol

1. Derive account identity exclusively from authenticated Clerk/Convex subject.
2. Resolve exact registered workspace/database/record scopes; require existing task semantics and metadata.
3. Check current database and task edit permission, then independently authorize every proposed linked task's view permission.
4. Reject duplicate or non-task relation IDs, malformed state, any graph cycle and >100 relation rows from the same Convex transaction snapshot.
5. Require `expectedUpdatedAt: null` on initial creation or exact previous server timestamp on update; generate monotonic server timestamp. No silent overwrites on stale edits.

**Known constraint:** PR34 validates new link targets and scans the existing bounded graph for structural integrity and cycles; full retrospective referential-integrity repair and performance under highly fragmented ACLs need independent integration tests. A missing relation row represents a task with no outgoing relation edges.

## Regression coverage

`tests/unit/workspaceTaskRelations.test.ts` includes 12 test cases for visibility redaction, hidden parents, revocation, per-record denial, non-task targets, foreign/corrupt/duplicate rows, invalid IDs, direct/indirect/mixed cycles, 100-row caps and unknown identities.

The exact GitHub Actions head must still be checked for lint, root+Convex TypeScript, unit/backup tests, Next.js build, provider probes and Chromium/WebKit suites. The dependency audit uses a configured `continue-on-error`; passing it is not independent security clearance.

## Still required before merging/activation

- Independent code/security review, authenticated three-account Clerk/Convex revocation and role tests, concurrent CAS/graph-write tests.
- Live cloud export/restore of shadow relations with attachment integrity verification and rollback exercises.
- Arabic/RTL/assistive technology acceptance, query read-budget and scale measurements, and issue [#42](https://github.com/iomarsuleiman/max/issues/42) reconciliation.
- Review of upstream stacked drafts and final explicit production rollout decision.

Next roadmap slice after PR34 is a later shared-database/task/wiki slice, with views or verification features only after separate permissions and quality gates.
