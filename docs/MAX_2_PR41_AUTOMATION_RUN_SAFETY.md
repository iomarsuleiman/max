# Max 2.0 — PR41/44: Automation execution safety & inert run journal

**Status:** draft-only foundation, stacked on PR40. Do not deploy or enable without independent review. Neither personal pages, collaborative content, MCP, nor production automations are modified.

## What is implemented

- Shadow workspace automation intent records plus a transactionally append-only, two-step run-event journal. All new records use the inert state recorded, and the only exposed state transition is manager cancellation to canceled. Dead_letter is reserved as a future terminal contract; there is **no dead-letter writer or dispatcher** in PR41.
- Only an authenticated current manager may record an intent, and only against a current draft manual_button rule whose original creator still manages the unique, live database scope. The submitted expected rule revision must match. Other triggers, retired/paused rules, anonymous subjects, and cross-workspace scopes fail closed.
- An opaque 12–64 character idempotency key is scoped to one database; exact authenticated replay of the same rule revision returns the original ID without another write or audit row. Reuse for another actor, rule or revision is denied. Convex transactions serialize simultaneous submissions.
- A fixed maximum of **64 intents per database total**; ingestion rejects the 65th and rejects duplicate, overfull or malformed registries. This deliberately sacrifices availability until reviewed retention and compaction are introduced: do not silently delete history or recycle keys.
- Each write and journal event occur atomically with a generic shadow workspace security audit row. Journal reads validate sequence, tenant, terminal status and timing. Manager previews do not include actor identities, arbitrary payloads or document content. Current management authorization is rechecked on each read/write.
- Domain-only causal lineage policy rejects repeated rule keys and depth >= 4. Domain-only hypothetical backoff permits at most three attempts and only transient/rate-limit reasons, with 60s then 120s delays. **These contracts have no runtime consumer or scheduling side effect.**
- No worker, queued job, scheduler, enabled-rule state, notifications, webhook, task mutation, retry endpoint, Yjs update, browser UI, or MCP action.

## Default-off feature gates

All new endpoints are disabled unless an operator explicitly configures the flags **and** their predecessor gates:

- Read: MAX_V2_AUTOMATION_RUN_INTENTS_READS_ENABLED=true, plus MAX_V2_AUTOMATION_RULES_READS_ENABLED=true and MAX_V2_SHARED_DATABASE_READS_ENABLED=true.
- Write: MAX_V2_AUTOMATION_RUN_INTENTS_WRITES_ENABLED=true, plus MAX_V2_AUTOMATION_RULES_WRITES_ENABLED=true, MAX_V2_WORKSPACE_WRITES_ENABLED=true, and MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED=true.

This is **not** activation of actual automation execution. No flag for an executor exists.

## Threat model and invariants

1. **Impersonation/revocation:** account ID is obtained from current Convex authentication; never accept a caller-provided actor. Live author and caller permissions, unique workspace scope and current database registry are required on intent creation. Cancellation requires current manager rights. There is no bearer-token execution capability.
2. **Replay/collisions:** stable idempotency key plus rule revision, rule identity and authenticated actor fence replays. Concurrent writes are a single Convex transaction. Duplicates with mismatched fingerprints are rejected; terminal states cannot be restored.
3. **Rule editing:** no stale rule can generate a new intent. Retiring or pausing a rule denies subsequent intent creation. Previously recorded records remain inert; this PR does not authorize delayed future execution.
4. **Recursion/retry:** external callers cannot specify parent runs, attempts, task events or depth. A future trusted engine must prove event provenance, immutable causal chain, action-specific reauthorization, target row authorization, cycle prevention, finite retries, exponential backoff and dead-letter capture before any action is possible.
5. **Journal tampering or partial write:** record and first event and audit are inserted together; cancellation, second event and audit are updated together. Readers validate all rows and fail closed on missing, extra, cross-tenant or out-of-order entries. The generic security-events table is **not** itself a cryptographically tamper-evident log.
6. **Resource exhaustion:** at most 32 dormant rules/database from PR40 and at most 64 recorded intents/database here, with two journal rows per intent. Do not raise caps until quotas, rate limiting, retention, pagination, index costs, and operational cleanup are reviewed.
7. **Privacy:** the intent stores only key, rule revision and authenticated actor; no task data, page contents, recipient identifiers, webhook URLs, notification text, or raw event payloads. Reads expose only metadata to current managers.

## Tests and operator checks

Run pnpm lint, pnpm typecheck, pnpm test, pnpm test:backup, pnpm build and Chromium/WebKit E2E via exact-head CI. The unit suite at tests/unit/workspaceAutomationExecution.test.ts exercises strict key validation, status invariants, journal integrity, bounded registries, permission/revocation, CAS cancellation, idempotency, causal loops and hypothetical retry policy.

Independently test in isolated Convex staging: two distinct Clerk accounts; owner/guest and creator revocation; concurrent identical and conflicting idempotency keys; rule edit/retirement races; manager revocation between writes; deliberate event corruption; backup/export/restore with attachment-hash verification; measured query costs and malformed-data denial. Do not simulate those checks as real-account evidence.

## Rollback

Disable the two new run-intent flags first. There is no executor to stop. Preserve shadow journal rows for audit and do not delete historical IDs or recycle idempotency keys. Revert PR41 schema/functions only after a reviewed data-export/recovery plan; leave PR40 rule definitions intact. Existing personal and shared document access remains unaffected.

## Release blockers and handoff

Independent security review, real multi-account race proof, isolated cloud restore, accessibility/RTL browser verification where UI is eventually introduced, performance/retention budget, predecessor stacked PR review, and baseline reconciliation issue #42 remain outstanding. The configured dependency audit may be green despite a continued-on-error step; do not equate CI with security approval.

A subsequent **separately reviewed** PR may propose execution activation; it must introduce trusted internal event provenance, action-specific authorization, durable worker lease and exactly-once-effect/idempotent target mutations, observability and operator kill switch. **PR41 does not execute a single automation.**
