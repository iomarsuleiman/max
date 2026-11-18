# Max 2.0 — PR32: Server-Authorized Shared Database Metadata & Incremental Reads

**Draft experimental backend only.** Stacked on PR31 (#60). No production editor changes, personal data migration, MCP exposure, real database content, task assignments, formulas, rollups, or rollout.

## Implemented
- Two separate shadow Convex tables: workspaceDatabaseBindings and workspaceRecordMetadata. The latter contains only a scope ID, title, timestamp, and database linkage.
- workspaceDatabases.readMetadata: authenticated, current database-level view permission; returns an authorized database ID and type only.
- workspaceDatabases.listRecordMetadata: authenticated, indexed take(101) for one workspace/database, all-or-nothing integrity and live per-record view checks, max 25 visible records per request.
- workspaceDatabases.registerMetadataDatabase: registers an existing, globally unique shadow scope after live manage permission is checked.
- workspaceDatabases.upsertRecordMetadata: metadata-only creation/update for an existing direct child scope after both database and record edit checks. Strict expected-timestamp compare-and-set, trusted server timestamps, 100-row cap and globally unique record IDs.
- Reuses canAccessWorkspacePageFromServer; never accepts client-supplied account, role, ACL snapshots, or candidate rows.

## Safety limits
- Read routes are OFF by default and require MAX_V2_SHARED_DATABASE_READS_ENABLED=true.
- Metadata writes are OFF by default and require BOTH MAX_V2_WORKSPACE_WRITES_ENABLED=true and MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED=true.
- A continuation cursor is only an ID from an already authorized and currently visible record; the server rechecks current authorization on every page. No hidden raw index cursor, offset, unauthorized totals, derived values, or relations.
- At most 100 metadata records per database; writers reject the 101st, and readers fail closed on a corrupt or oversized batch. This is a deliberately bounded security prototype, NOT scalable pagination.
- New shadow tables never read or write legacy owner-only personal pages/documents. No content editor, workspace UI, MCP access, invitations, public links or auto-activation.
- Metadata registration requires pre-existing trusted workspace scopes. No ACL or membership is created implicitly.

## Verification / release gates
- Unit: tests/unit/sharedDatabaseIncremental.test.ts plus all PR31 regressions.
- CI: lint, root + Convex TypeScript, unit, backup, build, provider contracts, Chromium/WebKit and audit-as-configured.
- Still blocked: three real Clerk accounts and revocation, concurrent compare-and-set proof, independent security review, cloud backup/restore, Arabic/RTL accessibility, performance, and baseline issue #42.
- Rollback: leave flags off and close the draft. No production migration or deployment is approved.

Next suggested slice: PR33 — scoped task, assignee, project and wiki record semantics behind the same default-off boundary.
