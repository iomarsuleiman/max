# Max 2.0 — PR 14/44: Provider evaluation & offline/reconnect safety groundwork

## Scope and dependency
Draft stacked directly on PR #31 (PR 13/44), using its non-destructive shadow migration plan and PR #30's lossless BlockNote codec. This PR is a **pure evaluation and recovery preflight**: no provider packages installed, transport chosen, collaboration enabled, shared page read/write added, migration executed, production flags changed, or personal save hook modified.

Max currently uses customized BlockNote 0.55, legacy owner-only Convex documents, 650ms autosaves and personal local drafts. The proposed collaboration adapter must not replace the editor schema or weaken those workflows. There are no live provider trial results in this PR.

## Provider A/B research (vendor claims, NOT verified in Max)

| Candidate | Document model and integration to test | Risks and missing evidence |
| --- | --- | --- |
| Convex ProseMirror Sync | Convex component with OT steps/snapshots and a BlockNote-oriented hook. Needs BlockNote custom schema extensions, authorized getSnapshot/submitSteps/latestVersion, and a real editor probe. | ProseMirror JSON representation is not Max's saved BlockNote JSON; custom blocks/IDs may be lost in conversion. Provider docs warn that unmounting with unsent steps during failed background submission can lose them. Validate offline and revoked-session behavior independently. |
| BlockNote native Yjs | Official withCollaboration binds BlockNote to a Y.Doc XmlFragment and provider; y-indexeddb is an optional browser persistence layer. Needs provider with authenticated server-side document-room authorization and durable update storage. | IndexedDB is origin-local and does not itself authorize rooms, guarantee successful remote persistence or securely purge revoked devices. Tests must cover custom schema, undo, concurrent edits, crash and stale devices. |

Sources:
- https://www.convex.dev/components/prosemirror-sync
- https://www.blocknotejs.org/docs/features/collaboration
- https://docs.yjs.dev/ecosystem/database-provider/y-indexeddb

**Decision: no production provider selected.** Source documentation cannot establish Max editor compatibility, performance, authorization correctness or reliable reconnect. A synthetic JSON codec success is not a real provider test.

## Contracts in this PR

- lib/domain/collaborationProviderRecovery.ts: assessProviderTrials takes explicit provider-specific run evidence and a PR12-verified BlockNote source; triages missing, failed and reported passing cases. Both candidate results always set canActivate=false, even after claimed isolated live passes. No score is silently treated as a rollout grant.
- Pure local recovery journal: validated original bytes, account/workspace/page/provider/revision/schema scope, sequential idempotency keys, maximum 16 drafts and 2 MiB total snapshot content. A repeated identical key is idempotent; a conflicting duplicate is rejected; restore rejects corrupt data and any account/scope mismatch. It does not read or write browser storage.
- assessOfflineReconnect: immutable advisory assessment. Mismatched identity, revoked/unknown access or invalid remote revision quarantines; revision divergence reports conflict; even a matching revision requires an authorized, provider-specific merge. canReplay is **always false** and preserveLocalCopy is always true. No overwrite, auto-resubmit, network requests or automatic deletion.
- Current provider activation remains explicitly false. All labels/observations are caller-supplied and do **not** prove access; future trusted server endpoints must independently reauthorize each read, write, reconnect, snapshot and revocation event.

## Required isolated live experiment (not completed here)

Execute identical fresh copies of the golden BlockNote fixture for each provider in **nonproduction, throwaway** environments, with Max custom schemas/extensions (including column, table, diagram, equation, page links and database-view blocks). Record the environment, commit, dependency versions, run identifier, browser versions, initial and final BlockNote JSON, original IDs, schema, attachments and byte-for-byte comparison. Run each case below for BOTH candidates, label pass/fail/not-run, and attach failing artifacts without exposing real user content.

1. Custom-block codec and editor create/load/export/import parity.
2. Two authenticated clients typing/inserting/deleting the same blocks concurrently.
3. Three clients converging under reorder/move/delete conflicts and high latency.
4. Two offline divergent edits, reconnect, server-authoritative reconciliation, no silent loss.
5. Force crash, background tab unmount, throttled network and unsent-step recovery.
6. Arabic IME composition, RTL cursor selection, undo/redo and multi-column structure.
7. Revoked member while connected/offline: denied updates, reads and future reconnect; no stale room grant.
8. Large documents, media URL authorization, cross-workspace asset isolation and size caps.
9. Old editor/client against upgraded schema, rollback and original personal history.
10. Edit latency, operation payload size, CPU/memory, join time and history growth vs baseline.

For every scenario: test authorized + unauthorized accounts using **actual Clerk/Convex identities**, reset fixture between candidates, repeat across Chromium/WebKit and real iOS/Android where relevant. Never reuse a personal document as a live migration fixture. Treat a reported pass as requiring independent inspection, not a signature or authorization token.

## Reconnect state and future integration ownership

- Offline provider adapter (future PR): persists CRDT updates / OT steps in a scoped and integrity-protected store, distinct from existing personal note drafts; handles idempotent remote ack and durable flush. A PR14 full-snapshot journal is only a **recovery artifact**, not an edit step stream and must never be blindly submitted as the latest page contents.
- Authenticated server adapter (future PR): verifies Clerk subject, workspace membership, page capability and revocation for every operation/room/snapshot. A browser's verified-access observation cannot grant access.
- Conflict/recovery UI (future PR): shows pending local work, preserve/export, retry only through provider merge, and explicit user conflict decisions. No auto-discard when access is revoked.
- Migration owner (later PR): requires immutable source backups, asset hashes, parity with shadow copies, version-preserving reversible cutover and approved operational rollback.
- This PR has **no IndexedDB/localStorage implementation**, no offline syncing, no acknowledgment or replay, and no user-visible collaboration controls. Existing personal editor and MCP behavior remain unaffected.

## Acceptance gates and rollback

Synthetic regression cases cover malformed and duplicate provider reports, missing trials, failed codec, adversarial offline IDs/scope, duplicate and out-of-order drafts, local bounds, stale revisions, revoked sessions and exact byte retention. These are not replacements for real multi-client tests.

CI: lint, root+Convex TypeScript, Vitest, backup tests, Next production build, Chromium/WebKit E2E. Audit currently uses continue-on-error: a passing job does not certify dependency safety. Release additionally requires 2/3 real authenticated clients, full offline convergence, security/revocation, server-side auth, actual cloud backup+assets recovery, performance/IME/RTL/device/accessibility evidence and independent review.

Rollback: revert these three new files (domain, tests, runbook). No database migration, new dependency, production flag, user data or shared content change exists. PR #31, all previous draft PRs, and personal notes remain unchanged.

## Next PR 15/44
Build isolated, genuine provider A/B test fixtures and adapter proof (not production integration), obtain measured convergence/crash/reconnect evidence and introduce server-authorized shared document entrypoints only after permissions/recovery review. Do **not** enable live shared editing or migrate owner-only records based on synthetic passes.
