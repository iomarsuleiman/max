# Max 2.0 — PR40/44: Deterministic Automation Rule Foundations

**Review state:** draft-only, OFF by default, unmerged and not deployed. Stacked on PR39. Do not merge or activate without independent review and real multi-account evidence.

## Scope
This introduces a bounded, **non-executing** rule registry for previously registered **shadow workspace databases**. A manager can store and inspect declarative automation intentions and inspect a hypothetical dry-run. No database task, document, notification or asset is changed by a rule. No trigger subscriptions, webhook transport, scheduler, worker, arbitrary code execution, active/enabled status, UI automation builder, or MCP tools exist in this PR.

Rule triggers: `task_state_changed` and `manual_button`.
Conditions: `always`, or `state_equals` with one of `todo`, `in_progress`, `blocked`, `done`.
Action intentions: `notify_creator` or `set_task_state`. These are **descriptors only**; no action has a runner. State-change-triggered state-write actions are rejected to avoid obvious loops.
Rules can be `draft`, `paused`, or terminally `retired`; no `enabled` state is expressible. Maximum 32 per database. Upserts do not execute, enqueue or schedule.

## Authorization and consistency
- Every query and mutation derives identity from current Convex authentication; no caller-supplied account, workspace role or ACL is trusted.
- Manager authorization is checked through existing default-deny workspace page policy on the database scope, with unique global scope ownership and a live shadow database binding.
- Rule listing is manager-only. It returns no creator account IDs, workspace IDs, hidden record data, passwords or action credentials.
- Dry-run uses **caller-supplied hypothetical before/after state**; it does not read real task records or promise future execution. Output always has `wouldRun: false`. It returns null for unauthorized/invalid/nonexistent/retired rules and verifies that the creator still manages the scope.
- Mutations are transactional with monotonic timestamp compare-and-set preconditions, stable keys and a terminal retirement status. Every mutation writes a shadow security audit event in the same transaction.
- List and preview fail closed if a query fails, schema is corrupt, keys or IDs are duplicated, tenant bindings are wrong, or the registry exceeds 32 rows. No partial results.
- No arbitrary scripts, inline JS, URL payloads, webhooks, cron expressions or cross-workspace recipient IDs are accepted.

## Feature flags and rollback
All default OFF:
- `MAX_V2_AUTOMATION_RULES_READS_ENABLED=true` **and** `MAX_V2_SHARED_DATABASE_READS_ENABLED=true` to allow manager metadata query/dry-run.
- `MAX_V2_AUTOMATION_RULES_WRITES_ENABLED=true` **and** both `MAX_V2_WORKSPACE_WRITES_ENABLED=true` and `MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED=true` to allow metadata mutations.

Unset/disable the two new flags to disable every PR40 endpoint. Shadow table creation alone does not connect to personal pages, existing document routes, the editor or MCP. Do not delete original data as a rollback method.

## Verification
`tests/unit/workspaceAutomationRules.test.ts` covers validation, state/action restrictions, direct loop prevention, scope authorization, invalid/duplicate/overfull registries, creator and tenant revocation, terminal retirement, CAS revisions, simulated backend failure, privacy and **non-executability**.

Release blockers: exact-commit GitHub CI (ESLint, root/Convex TypeScript, Vitest, backup and recovery, Next build, provider/browser E2E); independent cross-tenant security review; real Clerk multi-account permission and revocation races; isolated Convex cloud backup/restore with attachments; rule engine idempotency/retry/loop and quotas threat model; actual UI keyboard/RTL/mobile/screen reader testing; measured production query budgets; predecessor PR approval and Max baseline issue #42.

## PR41 hand-off (not implemented)
A separately reviewed execution-intent/run-journal contract with idempotency keys, bounded depth, explicit operator activation gates, retry/dead-letter rules and audit invariants should be proved **before** any runnable automation, webhook, timer or MCP action is exposed. PR42 can cover manual meeting notes and privacy-aware aggregate analytics depending on reviewed sequencing. Do not treat PR40 dry-runs as permission to trigger actions.
