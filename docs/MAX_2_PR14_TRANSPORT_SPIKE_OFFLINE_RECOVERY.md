# Max 2.0 — PR 14/44: Transport evidence matrix & safe offline/reconnect groundwork

## Stack and intent
Draft stacked directly on PR #31 (13/44), consuming PR12's lossless BlockNote codec validation and PR13's immutable shadow-document checks. This is **not** multiplayer activation. It introduces two pure, testable modules and synthetic regression suites without any new dependency, Convex schema, editor mount, server endpoint, browser cache, network session or production feature flag.

## A/B provider evaluation contract
The `collaborationTransportEvaluation` module builds comparable evidence reports for **Convex ProseMirror Sync** and **BlockNote/Yjs**. Required tests are real BlockNote editor mounting, custom-block roundtrip, 2/3-client convergence and conflicts, disconnect/reconnect, offline crash/restart, mid-session revocation, undo/redo, Arabic RTL/IME/selection, tables/media/columns, version history/server-initiated mutations, and performance at 100/1,000/5,000 blocks.

- Every test is explicit pass/fail/not-run; missing/duplicate/invalid results are blockers.
- The existing codec probe must retain every BlockNote ID and custom property, not just text.
- `real-provider` and package strings are **self-declared evidence**, not proof; independent reviewers must verify actual library setup, reproducible traces, package versions and infrastructure.
- Even a fully passing, self-reported matrix is only `eligibleForIndependentReview`. `canEnableCollaboration` is always false; both-provider comparison always has `selected: null`.
- This PR's tests use an in-memory **JSON fixture codec**, not the actual Yjs or ProseMirror Sync runtimes. Therefore neither provider has been experimentally proven or selected. This is an evaluation framework, **not an accomplished real-provider A/B spike**.

Primary upstream references: https://www.blocknotejs.org/docs/features/collaboration and https://www.convex.dev/components/prosemirror-sync. Verify the specific API of installed BlockNote 0.55 before attempting integration. Avoid sample WebRTC providers for production, which cannot enforce Max workspace server authorization on their own.

## Safe offline/reconnect preflight
`collaborationOfflinePreflight` holds a bounded (16 drafts / 512 KiB total), immutable, **in-memory only** ledger of exact original BlockNote JSON bytes. It prevents reused operation IDs changing content, stale base revisions, corrupt schema/JSON and oversized queues. Drafts can be quarantined without deletion. Reconnect preflight checks account/workspace/document/session scope, remote revision, schema and permission state and distinguishes no-op, conflict, quarantine and provider-merge-required cases.

**Critically: every result returns `canReplay: false` and `canWrite: false`.** A matching revision or caller-supplied `permission: granted` cannot authorize a write. Full-document snapshots must never be replayed over other editors' concurrent CRDT/OT edits; native provider merges, trustworthy server-validated sessions, revocation fencing and confirmation are not implemented here. The draft ledger is neither durable offline persistence nor a replacement for existing local drafts or 650ms personal autosave.

## Required independent live experiments before selecting a transport
1. Reproduce both integrations in isolated, default-off test deployments with the current customized BlockNote schema; record exact packages, provider configuration, custom extensions, fixtures and failure traces.
2. Drive separate authenticated Clerk accounts and a revoked guest through all transport read/write/snapshot/subscribe paths, including cached reconnect tokens and background tabs. Authorize **each operation** on trusted server identity and workspace ACL. Never trust a client scope or a prior membership snapshot.
3. Run concurrent multi-browser editing, cross-client convergence, network partitions and 10-minute offline conflicts, tab crashes, reload/restart, Arabic IME, drag/drop, tables, and undo/redo. Compare original block IDs and custom data before/after.
4. Benchmark editor boot, time-to-converge, memory, payloads, storage growth, snapshot/step compaction and budget at 100/1,000/5,000 blocks under the same environment.
5. Validate legacy document/version/MCP/asset behavior, backup/restore with attachment hashes, reliable conflict recovery and explicit rollback. Run Chromebook/mobile/WebKit/Chromium and accessibility/device testing.
6. Choose a provider only with reviewed traces, a threat model, server-side permission integration, measured budget, independent approval and a separate explicitly gated activation PR.

## Rollback and non-goals
Delete this PR's two modules, two unit suites and runbook; no database or user data mutation needs reversal. Legacy owner-only notes, their 650ms autosave, versions, existing local draft recovery, personal MCP, workspace-preview flags and sharing permissions remain unchanged. No Yjs or ProseMirror dependency was installed, no offline IndexedDB storage was added, and no live collaborative editor, merge/replay, workspace document endpoint or automatic cutover exists.

CI requirement: exact-head lint, root+Convex typechecks, unit and backup tests, production build, Chromium/WebKit; the existing audit job has `continue-on-error` and is not proof that dependencies have no vulnerabilities. Live multi-account security, actual provider experiments, real offline durability, restoration and external review remain release blockers.
