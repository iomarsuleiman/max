# Max 2.0 — PR36/44: Team Wiki Ownership, Verification & Expiry Safeguards

**Experimental shadow metadata; draft stacked directly on PR35 (#64).**
No merge into `max-2.0` or `main`; no deployment or production feature flags.

## Scope
- `workspaceWikiGovernance` is a new isolated table for existing registered, typed `wiki` workspace records: owner, independent reviewer, verification timestamp, checked semantic and title-metadata revisions, expiry, and monotonic CAS revision.
- `workspaceDatabases.setWikiGovernance` requires manage permission on the database AND record, a currently active designated owner who can view the record, exact ancestry, and an expiry no more than 366 days ahead. Reassignment **clears verification**.
- `workspaceDatabases.verifyWikiGovernance` requires an independent, active reviewer who can manage both scopes; an approved wiki semantic state; precise current metadata/semantic revision claims; a still-active owner; and a future expiry. The mutation stores the verified revisions transactionally.
- `workspaceDatabases.readWikiGovernance` requires current database and per-record view permission. It exposes only `ownedByMe`, `verification` (`unverified`, `verified`, `stale`, `expired`), expiry and metadata update timestamp. No owner/reviewer identity, hidden record count, or content is disclosed.
- Status is computed on every authorized read; no background job or mutable expiry bit. Changes to semantic state/revision, registered title metadata, reviewer permissions, owner membership, or reviewer membership invalidate a prior verified result.
- Duplicate, archived, wrong-tenant, invalid, missing and stale CAS rows fail closed. No automatic publication or external sharing.

**Important limit:** this certifies *metadata revisions only*. The shadow wiki model does not contain shared article bodies or a content review workflow. Do not present `verified` as certification of the current article body. Future content verification must bind a durable content hash/revision to the proof and invalidate on each edit.

## Feature gates (default OFF)
Read: `MAX_V2_SHARED_DATABASE_READS_ENABLED`, `MAX_V2_WORKSPACE_RECORD_SEMANTICS_READS_ENABLED`, `MAX_V2_WIKI_GOVERNANCE_READS_ENABLED`.
Write: `MAX_V2_WORKSPACE_WRITES_ENABLED`, `MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED`, `MAX_V2_WORKSPACE_RECORD_SEMANTICS_WRITES_ENABLED`, `MAX_V2_WIKI_GOVERNANCE_WRITES_ENABLED`.

## Verification / release blockers
New unit coverage: status/identity minimization, expiry, revision drift, membership and permission revocation, wrong-tenant/ancestry, corruption, self-review and time bounds.
Run CI for lint, both TypeScript projects, tests, browser suites, build and probe. The dependency audit is configured and is *not* an independent security assessment.

Still required: independent security review; real three-account Clerk/Convex write and revocation drills, role downgrade, permission-change races, metadata-edit replay/CAS races, clock boundary tests, cloud backup/restore, performance, Arabic/RTL accessibility, and issue #42 baseline reconciliation. Do not enable gates or deploy. Rollback is to leave gates OFF and close this unmerged draft.
