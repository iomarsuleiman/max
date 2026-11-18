# Max 2.0 — PR 23/44: Multi-tab, network partition and Arabic composition safety

**Draft only. Target: `max-2.0` (after merged PR22/#41). Do not merge to `main`, deploy or enable production collaboration.** This work is limited to the isolated PR16/18/19/23 browser labs, tests and CI. The separate `feat/max-v2-baseline` review remains open in issue #42.

## Implemented

1. **Browser room lease.** The PR18 sandbox claims a native exclusive Web Lock keyed to the authenticated Clerk account ID, workspace and page **before reading IndexedDB or mounting the editor**. A second tab for the same account+room fails closed and cannot mount the editor or start the provider. No fallback to racy localStorage/BroadcastChannel leadership and no automatic lease steal; closing the first tab releases its browser lock. The lock is released by cleanup only after the provider has stopped and its persistence barrier settled. Reload/account change stops the old provider.
2. **Stale async join fence.** Delayed server join or recovery cannot resurrect a provider after it has been destroyed, preventing an old tab from reconnecting after relinquishing the lock.
3. **Network partition proof (simulated).** Fault injection covers lost responses BEFORE a commit, lost responses AFTER a commit, denied read during reconnect, revoked edit rights, and join returning after provider teardown. Durable operation IDs are stable across explicit reviewed retry; a commit-after-lost-ack is not duplicated. An unacknowledged local update remains in the outbox until both server response and local journal acknowledgment.
4. **Arabic input smoke test.** Chromium and WebKit mount real Max-schema BlockNote editors; an offline synthetic composition event plus text insertion includes Arabic diacritics, punctuation and a joined emoji. After explicit in-memory Yjs reconnection, both editors and a reconstructed snapshot must retain the same text and structure. This does **not** emulate a genuine operating-system IME.
5. **Operational counters.** The isolated PR18 transport exposes a payload-free opt-in evidence summary (join/read/append attempts, errors, maximum observed latency, encoded update sizes and read rows). No URLs, account IDs, request bodies, tokens or Yjs bytes are recorded. This is not a Convex invoice, compute/storage benchmark, nor a comprehensive reactive-subscription traffic capture.

## Deterministic checks

- `npm test` in `experiments/max-v2-pr18`: synthetic transport, authorization, durable journal, Web Locks fake arbitration, partition idempotency and redacted metrics.
- `pnpm exec playwright test --config experiments/max-v2-pr23/room.playwright.config.mjs`: two actual tabs in the same browser context, exclusive ownership, handoff after tab closure, different account/page keys and IndexedDB's deliberately shared same-origin visibility, using Chromium + WebKit.
- `pnpm exec playwright test --config experiments/max-v2-pr16/playwright.config.mjs`: existing BlockNote custom-schema coverage plus Arabic synthetic composition across the offline relay.
- Root lint, typecheck, Vitest, backup/recovery checks, production build and standard E2E remain separate required CI jobs. Treat the exact PR head status, not tests from any other branch, as the source of truth.

## Operator-only real cloud validation required before shipping

Use disposable PR17 Convex and Clerk tenants with **no real patient, student or personal notes** and 3 independent signed-in accounts. All steps are manual and must create externally reviewable artifacts:

1. Open the same user and room in two tabs of the same browser profile. Confirm exactly one editable PR18 lab and a fail-closed error in the other. Close/crash the owner tab and verify the other tab requires an explicit fresh attempt; check the durable journal BEFORE any reviewed reconnect. Test Web Locks unsupported/denied as a non-editable state.
2. Repeat with another browser profile/device: Web Locks are **not global** across browser profiles, devices or machines. Verify the PR17 server still enforces leases, current ACL and operation-level authorization. Run the opt-in PR22 independent three-Clerk-account live tests with supplied credentials; missing credentials MUST fail, not skip.
3. Use network fault injection to stop requests before the server writes and to drop the response after an accepted write. Capture server operation IDs and local journal entries; verify a reconnect never uploads without review, and a retry commits at most once. Revoke a user while partitioned and verify both the UI and server reject upload.
4. Use a genuine Arabic keyboard/IME on Windows, macOS, iOS and Android, including composition during remote Yjs changes, cursor movement, selection, diacritics, RTL direction changes and reload. Synthetic JavaScript composition events alone do NOT prove native IME robustness.
5. Record the measurement environment (region, three-user concurrency, active tabs, physical devices), operation counters, real server query/mutation invocation counts, subscription events, server storage bytes, CPU/memory, latency percentiles, vendor invoice/quota and room growth through 256 updates. The JS counters alone do not measure Convex compute, reactive subscriptions or pricing. Repeat with a network partition and after checkpoint compaction.
6. Independently perform a native Convex export/restore into a different disposable deployment, plus attachment hash checking, full real BlockNote document parity, ACL/account mapping and rollback exercise. Use PR22's transcript verifier; its operator-supplied job reference strings are NOT independently authenticated. Document evidence links, identities, commands, actual log timestamps and two-person security/rollback signoff.

## Threat model and release blockers

- Web Locks is coordination among cooperating tabs **on one origin/browser profile**; it does not authorize access. The PR17 server remains authoritative. Malicious same-origin JavaScript can access the same IndexedDB: the durable journal is **not encrypted** and browser origin storage is **not an account security boundary**.
- A lost network acknowledgment leaves the operation pending even when already committed. Resending is safe only when the server's authenticated idempotency record remains durable and the user explicitly reviews pending changes. No silent replay.
- Cross-profile concurrent editing, high-volume updates, long-lived sessions, binary media attachments, production-scale performance, accessibility/RTL, native IME, real server partitions, data loss/corruption, import and backup/restore are NOT independently verified.
- Server checkpoint packs are lossless original update bytes, not a semantic Yjs snapshot or a quota fix. **Never roll back a compacted lab dataset to the pre-PR21 provider without a verified pre-compaction backup restore.**
- Independent security review, real-cost measurement, actual cloud backup/restore, native IME and production release approval are outstanding. The feature flag, live Convex deployment and main/personal-note behavior remain unchanged. The CI dependency audit still uses `continue-on-error`.

## Rollback

Revert this draft branch on `max-2.0` before production integration if Web Locks or browser tests fail. No data migration or new production tables were introduced. In the isolated test lab, export local Yjs bytes and journal evidence **before** removing any experimental data. Do not delete outboxes for failed/unacknowledged operations. Never auto-merge the separate baseline branch as part of PR23.

**Future roadmap**: proceed to item 24/44 only after exact-head CI and independently reviewed evidence are tracked; do not treat this PR as approval to activate collaboration.
