# Max 2.0 — PR33: Scoped Tasks, Assignees, Projects & Wiki Record Semantics

**Experimental shadow metadata only. Draft stacked on PR32 (#61). Unmerged and undeployed.**
No changes to `main`, `max-2.0`, existing personal databases/documents, the production editor, or MCP.

## Scope and data model

- `workspaceRecordSemantics` contains **only** an existing registered workspace record ID, its workspace/database IDs, typed kind/state, an optional assignee account ID, optional same-database project ID, optional task due date, an archive marker and a server-controlled update timestamp.
- Types: task (`todo`, `in_progress`, `blocked`, `done`), project (`planned`, `active`, `paused`, `completed`), and wiki (`draft`, `in_review`, `approved`). **Wiki approval is internal metadata, not publishing or public sharing.**
- Only tasks may have an assignee, project link or due date. Only an existing typed `project` record in the **same database** may be linked; no arbitrary relations, rollups, formulas, hidden projects, freeform properties or document bodies are exposed.
- The 100-record cap and the 25-item metadata-read limit from PR32 remain unchanged. This PR does not claim scalable pagination.

## Security invariants

1. Every call uses the authenticated Clerk/Convex subject, current server-side workspace ACLs and existing shadow scopes. No client-supplied account or role grants authority.
2. Reading a semantic record requires fresh view permission for **both** its database and its record, a unique live metadata registration and exact ancestry.
3. Project links require a registered, typed, nonarchived project and a separate live authorization check. A valid project hidden from the viewer is redacted as `projectId: null`; a corrupt link fails closed.
4. Read responses contain a small allowlist: record ID, kind/state, due date, `assignedToMe`, authorized project ID and update time. **Third-party assignee IDs are never returned.** A task with no assignee and one assigned to another member have the same public self-assignment boolean.
5. Writes require both PR32 write gates **and** the PR33 write gate, a current edit permission for the database and record, exact direct-child scope, and an existing record metadata registration. No record, membership, grant or personal page is implicitly created.
6. Assignees must have exactly one active workspace membership and current view permission on the task. This prevents assignment to a revoked identity or a principal unable to read the record.
7. Existing semantics may be updated only with the previous server timestamp (compare-and-set). The semantic kind is immutable after creation to avoid breaking project links. The server supplies the next monotonic timestamp.
8. Duplicate IDs, malformed links, cross-tenant rows, archived metadata, failed backend reads and revoked access fail closed. All required checks occur inside the Convex transaction snapshot.

## Activation / rollback

- Reads additionally require `MAX_V2_SHARED_DATABASE_READS_ENABLED=true` and `MAX_V2_WORKSPACE_RECORD_SEMANTICS_READS_ENABLED=true`.
- Writes require **all three**: `MAX_V2_WORKSPACE_WRITES_ENABLED=true`, `MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED=true` and `MAX_V2_WORKSPACE_RECORD_SEMANTICS_WRITES_ENABLED=true`.
- All gates default OFF. Do **not** enable in production. Rollback: leave gates off, close the unmerged draft. No production migration or automatic shared database activation.

## Verification

Unit coverage: `tests/unit/workspaceRecordSemantics.test.ts` for task/project/wiki states, self-assignment privacy, project redaction, record ACL revocation, wrong ancestry, wrong tenant, malformed/duplicate semantics, invalid fields, and backend failures. CI must additionally pass lint, root and Convex TypeScript, unit/backup, production build, provider contracts and Chromium/WebKit.

## Outstanding gates

- Independent security review and real three-account Clerk/Convex authorization including assignment, revocation, project-link visibility and transaction races.
- Cloud backup and restoration of shadow metadata; real Arabic/RTL and assistive-technology acceptance; performance and concurrency limits.
- Baseline reconciliation in [issue #42](https://github.com/iomarsuleiman/max/issues/42).
- No member picker, task board, project hierarchy, wiki pages, publishing, shared document editing, public routes, notification delivery or MCP parity. Those need later reviewed PRs and explicit rollout approval.

Next roadmap slice: PR34/44, subject to the canonical implementation plan; this PR intentionally does not preempt it.
