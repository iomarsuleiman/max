# Max 2.0 — PR20/44: live authorization downgrade and lease fences

**Draft, stacked directly on PR #38 (PR19/44). Not merged or deployed. Production collaboration stays disabled.**

## Implemented (isolated sandbox only)

1. A `sessionStatus` reactive Convex query rechecks the authenticated Clerk subject, active 5-minute session, current workspace/page ACL and current edit permission in the same server transaction. The subscribed result can drop from edit to view without requiring a failed mutation to discover it.
2. A sandbox-only owner operation `downgradeMemberEdit` switches exactly one synthetic page-level account grant from edit to view. It rejects ambiguous grants, invalid actor/target, lack of owner authority, and any effective edit permission remaining after the patch. It audits only the successful downgrade and leaves the view lease active. This is a test-only operation, **not** a production workspace-management API.
3. PR18's actual authenticated Convex transport subscribes to that capability query. The browser provider immediately removes edit entitlement on a server-notified downgrade. It deliberately ignores any later status claiming more privilege until a new explicit authenticated join. Server operations *always* recheck permission independently.
4. The provider enforces the signed lease's expiry time via a local deadline timer rather than depending on a reactive query to tick. Revocation, status mismatch, missed permissions or lease expiry block the provider and stop subscriptions. Unsent Yjs updates are retained for manual review/export rather than transmitted without permission.
5. An explicit reconnect with recovered pending edits into a newly read-only session remains readable, but will not transmit pending edits or enable offline editing. The UI's sandbox test hook now reports the actual `canEdit` value.

## Evidence and commands

- Root emulated-Convex tests in `tests/unit/collaborationProviderSandbox.test.ts` verify authorized query, active edit-to-view grant downgrade, guest/cross-account denial, revocation, expired leases and preserved server reads.
- `cd experiments/max-v2-pr18 && npm test && npm run build` covers synthetic provider status notifications, denied write paths, downgrade-plus-offline pending changes, explicit expiry, and status-identity corruption.
- Existing PR19 Chromium/WebKit IndexedDB checks and PR16 real BlockNote fixture checks still run in CI.
- The opt-in `experiments/max-v2-pr19/live.spec.mjs` suite now adds a **real** owner-initiated page-grant downgrade and requires Bob to observe read-only status before Bob's full revocation. Real Clerk/Convex environments and three independent authorized accounts are still required. **Do not call that suite passed unless it was actually run against the dedicated remote deployment.**
- GitHub Actions conclusions must be checked at this PR's exact SHA. A green audit step using `continue-on-error` does not establish vulnerability-free dependencies.

## Security boundaries and remaining work

This work **does not** migrate personal pages, enable production shared workspaces, grant access from the browser, implement presence, or ship encrypted IndexedDB storage. The server is still an opaque bounded Yjs update log, with no verified compaction/snapshots or remote backups. Any already-downloaded local content may remain in browser storage after server access is revoked; the experiment must only contain synthetic material.

Reactive ACL changes rely on network delivery. An offline client cannot learn about server-side downgrades until it reconnects; on reconnect, server ACLs deny writes and the provider preserves pending data for review. Update mutations racing *before* a downgrade transaction can still legitimately commit. A read-only status remains a client UI hint, not a security boundary.

**Release blockers:** genuine independent multi-account Clerk/Convex run (not synthetic tests); WebKit/Chromium Arabic IME and multi-tab concurrency; permission downgrade/revocation under partitions; server snapshot/compaction and cloud restore; media/table/column asset parity; large-document benchmarks, accessibility, operations and independent security review. Do not merge/deploy a production collaboration feature from this PR.

**Rollback:** revert the experimental provider/transport, test-only Convex handlers, tests and docs. Production Max routes, schema, notes, editor and MCP are unchanged.