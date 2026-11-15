# Max 2.0 — PR28/44: Private Collaboration Inbox & Revocation Fences

**Experimental / draft only. Stacked directly on PR27 (#56). Neither `main` nor `max-2.0` is changed; there is no deployment or migration.**

## What this proves

- A per-recipient **metadata-only** inbox in the separate PR17 Convex sandbox. It is not part of production `convex/schema.ts`, user notes, Max's legacy personal comments, the Yjs document or its offline journal.
- Comment creation delivers mention events to the at-most-three already-authorized accounts; reply creation delivers a mention or thread-author reply event, never both for the same person.
- Suggestion approval/rejection delivers a decision event to the proposer. Approval is still only metadata and NEVER applies Yjs updates.
- Event insertion is in the same Convex mutation as the originating comment/reply/review; source idempotency and branch-fenced mutation checks prevent duplicate event delivery on identical retries.
- Events contain only `kind`, a referenced comment/suggestion ID, actor ID, timestamp, read timestamp and recipient/room scoping. They NEVER include comment bodies, proposed paragraph text, note contents, contact details or token material.
- Every inbox read or read-ack verifies the current Clerk subject, session lease, room and current page authorization. Revoked authors are redacted on each live read; recipients who lose access cannot continue reading or acknowledging old events.
- Acknowledgments are idempotent. The most recent **64 events per recipient per room** are kept; the oldest is evicted on new delivery. There is no unbounded notification history or cross-recipient cleanup.
- The isolated PR18 editor shows an opt-in, keyboard-accessible, RTL-compatible inbox with unread count and mark-as-read. It cannot send push notifications or expose production history.

## Boundaries and known limitations

- Requires `MAX_V2_PR17_PROVIDER_SANDBOX=true` **only** in a disposable Convex project, plus `VITE_PR28_ENABLE_INBOX_LAB=true` **only** when serving the isolated PR18 lab.
- The client has no durable inbox cache, offline delivery queue or local replay. Disconnect, lease expiry, account change and rejected subscription clear sensitive local UI data.
- Events are generated for **new** synthetic comments, replies and suggestion decisions only. Older PR26/27 records are not backfilled.
- No live page title, detailed activity feed, automatic review assignment, email, service worker, mobile push, browser notifications or production integration.
- A notification is a pointer, not a capability: to inspect referenced content, the viewer must use the existing authorized comment/suggestion APIs. The UI does not claim direct navigation.
- Recipient authorizations are checked during creation and again on read. If a user is revoked after creation, they cannot retrieve notifications. There is no third-party address-directory lookup or cross-workspace notification routing.
- Per-recipient retention is deliberately finite. Evicted events will not be recoverable through this experiment.

## Verification

1. `pnpm exec vitest run tests/unit/collaborationInboxSandbox.test.ts`: delivery, no text leakage, retries, cross-room/account denial, revocation and redaction, bounded eviction, decision provenance.
2. `pnpm --filter @max-experiments/pr18-remote-blocknote-provider test`: inbox protocol and client lease fencing, plus all earlier sandbox suites.
3. Exact-head `pnpm check`, root and isolated production builds, unit and backup tests, Chromium/WebKit labs and CI. Security audit is configured but is not independent clearance.
4. Before production: three genuine Clerk identities on a disposable Convex deployment, native Arabic/RTL and accessibility device tests, independent authorization review, cloud backup/restore including attachments, and baseline issue #42 reconciliation.

## Rollback

Disable `VITE_PR28_ENABLE_INBOX_LAB`, abandon this unmerged branch, or remove the sandbox-only notification functions/table/data. Do **not** change the production editor, legacy comments, source CRDT log, personal notes, `max-2.0` or `main`.
