# Max 2.0 — PR27/44: Suggestions & Change Review

**Experimental / draft only. Stacked directly on PR26 (#55). No deployment, migration or production editor modification.**

## Design and permission boundaries

- Suggestions propose replacement **plain paragraph text** anchored to stable BlockNote block IDs, with a short rationale and the observed Yjs update-log head (baseSeq). The head is an optimistic-concurrency fence, **not** proof of actual content: the server intentionally stores opaque Yjs updates.
- All review records live in the separate labSuggestions Convex table on the disposable PR17 sandbox, not in Yjs updates, comments, presence, personal notes or production tables.
- Live Clerk subject, five-minute lease, room, page ancestry, membership and current grants are checked in one transaction on every read/write. **Comment** permission may propose; **edit_content** permission is required to approve/reject. Non-manager authors cannot review their own proposals; page managers may.
- Approval or rejection changes **proposal metadata only**. Approved changes are **not applied** to BlockNote/Yjs. No automatic patch endpoint, offline queue, rebasing or replay. A real editor must separately inspect the current block and manually apply desired edits via the existing authorized edit path.
- Approval requires the room's current Yjs head to equal the proposal baseSeq. A changed head fails closed. The client also checks that the live paragraph text still matches the preimage, and disables acceptance for unsupported/missing anchors. **This UI check is not atomic against remote Yjs edits.** A production-safe apply operation would require verified CRDT-aware transactional design.
- Rejection is allowed after content changes but must pass exact proposal revision. Single-use decisions with optimistic revision fencing, idempotent same-operation retries, no contradictory decisions.
- On permission revocation, author/reviewer identities are redacted to former collaborators; revoked sessions cannot read or write, and reactive clients clear stale data on disconnect, account switch, lease expiry, bad payload or authorization failure.
- Limits: **32 suggestions/room**, 2,000 UTF-16 code units per original/replacement text, 500 per rationale, stable scoped block IDs, 8–96 character operation IDs, exact-head and revision fences. Rich/custom blocks intentionally excluded.
- Opt-in VITE_PR27_ENABLE_SUGGESTIONS_LAB=true enables the diff/review panel **only** in the synthetic PR18 editor. The server-side MAX_V2_PR17_PROVIDER_SANDBOX=true gate must be provisioned only for a disposable Convex deployment and dedicated Clerk test accounts. Both disabled by default.

## Verification

1. pnpm exec vitest run tests/unit/collaborationSuggestionsSandbox.test.ts — synthetic Convex permissions, OCC, redaction, cross-room and revocation coverage.
2. pnpm --filter @max-experiments/pr18-remote-blocknote-provider test — node watcher/lease/invalid-response tests.
3. pnpm check, root and isolated builds, provider contracts, Chromium/WebKit labs and configured audit on exact PR head. Audit continue-on-error is not security clearance.
4. Before production: independent security review; three **real Clerk** test accounts; native Arabic keyboard/IME, bidi and screen-reader checks; verification of CRDT applicability and racing edits; complete cloud restore with attachment digests; baseline issue #42 reconciliation.

## Rollback

Disable VITE_PR27_ENABLE_SUGGESTIONS_LAB. Revert only PR27 sandbox UI/API/schema and disposable test data. Leave authoritative Yjs history, recovery journals, personal notes and deployed application untouched. The unmerged branch can be abandoned without changing max-2.0 or main.
