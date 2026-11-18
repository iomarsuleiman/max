# Max 2.0 — PR26/44: Block-anchored comments & authorized mentions

**Draft, disposable collaboration lab only. Stacked on PR25/#54; no merge to main/max-2.0 and no deployment.**

## Contract

- Thread anchors are stable BlockNote block IDs, never mutable offsets, line numbers or selected text. Client verifies a block exists at creation; when deleted or not yet synchronized, the thread is visibly **orphaned**, without guessing an attachment. Server cannot validate actual BlockNote existence because it deliberately stores opaque Yjs updates; independently verify CRDT/block correspondence before a production rollout.
- Separate `labCommentThreads` and `labThreadComments` in the **isolated PR17 Convex schema**, outside production tables, notes, presence, document updates, checkpoint packs and offline journals. No comments are written into Yjs update history.
- Current server-verified Clerk identity, live session, room, page ancestry, membership and ACL are evaluated **on every** read/write. Page `comment` grant is distinct from `edit_content`. View-only members can read; they cannot create/reply/resolve. Thread creator or current page manager may resolve/reopen, protected by expected revision.
- Mentions are exact **authenticated account IDs** supplied intentionally by the author, not user-typed display names. The server checks each mention target's current read permission in the same transaction. No email/identity directory, push notification, @-autocomplete or outbound delivery; revoked/inaccessible mentioned IDs and author IDs are redacted on subsequent reads.
- Fixed limits: up to 32 threads/room, 32 comments/thread, three distinct mentions/comment, 2,000 characters/comment. Idempotency keys are server-scoped to room + authenticated account, so the same operation cannot create another comment with changed payload. No edits, attachment uploads or arbitrary rich HTML.
- Optional `VITE_PR26_ENABLE_COMMENT_LAB=true` reveals a restrained React view in the **PR18 synthetic editor only**. Requires a separately provisioned `MAX_V2_PR17_PROVIDER_SANDBOX=true` Convex deployment and previously required Clerk/room configuration. Disabled by default; never turn either gate on against real user data.
- Client watcher fences clear threads and replies on account/room/session changes, disconnect, lease expiry, malformed remote data and authorization errors. Server remains source of truth for permissions. No automated offline comment replay.

## Verification

1. `pnpm test -- tests/unit/collaborationCommentsSandbox.test.ts` (or `pnpm exec vitest run tests/unit/collaborationCommentsSandbox.test.ts`) and `pnpm --filter @max-experiments/pr18-remote-blocknote-provider test`.
2. Exact-head lint, root/Convex TypeScript, provider/browser sandbox build, production build, unit/backup, Chromium and WebKit CI. Audit is configured `continue-on-error` and is **not** clearance.
3. Independent real three-account Clerk + Convex sandbox verification: comment-level permission, guest read-only, cross-room stolen session, grant downgrade/revocation, expiry, retry idempotency and no mention-ID leak after revocation. Review Unicode/Arabic keyboard behavior, screen readers, viewport/RTL and child-block movement/deletion.
4. Independent security review, performance/cost load tests, browser/device coverage, native cloud restore/attachment verification and baseline issue #42 reconciliation remain blockers. Do not deploy production collaboration.

## Rollback

Disable `VITE_PR26_ENABLE_COMMENT_LAB` to hide the preview. Reverse only PR26 lab schema/provider/transport additions if necessary; **do not delete** durable Yjs updates, recovery journals or user documents. Destroy test-only comment records only in a dedicated disposable sandbox with operator approval.
