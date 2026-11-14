# Max 2.0 — PR 22/44: Fenced checkpoint reads and real-cloud recovery evidence

**Draft, stacked on PR #40. Unmerged / undeployed. Production collaboration remains OFF.** This PR changes only the synthetic collaboration sandbox, isolated browser lab, CI tests and documentation.

## Implemented protocol
1. The standalone PR17 Convex readUpdates query accepts an optional integer throughSeq. It rejects a future, fractional, negative, or backward fence, and returns only original updates through that frozen sequence, even while other writers append or compact concurrently. Each page independently validates the real Clerk-authenticated session, expiry, room identity and live read ACL.
2. Existing unpinned reads retain the old behavior. A backup reader captures its first returned headSeq, then explicitly pins all remaining pages. An empty completed log returns no data and hasMore=false; gaps and truncation fail closed.
3. Owner-only checkpointStatus checks the entire bounded packed chain and raw tail against nextSeq and the stored-byte counter. It verifies every original sequence, actor/operation ID, payload encoding and duplicate identity. It returns aggregate counts only; a member or guest cannot use it to inspect another room.
4. Existing compaction still preserves original Yjs update byte strings. It is not a semantic Yjs snapshot, not cryptographic state attestation, and does not increase the room's 256-update capacity or reclaim bytes.
5. The experimental PR18 browser transport exposes compaction and owner integrity proof through its existing authenticated Convex client. Extra browser test hooks require BOTH VITE_PR19_ENABLE_TEST_HOOKS=true and VITE_PR22_ENABLE_TEST_HOOKS=true; they cannot override server permissions.

## Deterministic CI evidence
- Convex-test simulated concurrent owner/member writes and owner compaction, preserved 24 unique sequence numbers and operation IDs, validated read-only denial, replay from a pinned cursor and archived idempotent retry.
- Frozen read across an append/compaction boundary excludes subsequent updates and continues to present a constant head.
- Simulated partial-restore corruption of the stored-byte counter fails owner integrity inspection; no silent repair overwrites original logs.
- New recovery-evidence Node test verifies exact before/after SHA-256 logical transcript parity, packed/raw counts, separate Convex endpoints, nonempty operator references, and deliberate corruption. This does not imply an official cloud export ran.

## Real authenticated cloud tests — opt-in ONLY, no silent skipping
1. Provision a disposable Convex project from experiments/max-v2-pr17/convex with synthetic workspaces, registered page scopes, an owner, a member editor and a guest. Enable MAX_V2_PR17_PROVIDER_SANDBOX=true only in that project. Configure a separate Clerk test tenant/JWT template and a PR18 lab frontend with both test flags. Do not use real user data.
2. Obtain real, independent signed-in Playwright storageState files for Alice, Bob and the guest, and store them outside the repository. Set MAX_PR22_SOURCE_URL, MAX_PR22_ALICE_STATE, MAX_PR22_BOB_STATE, MAX_PR22_GUEST_STATE and the three corresponding *_ID account values.
3. Run only the real concurrent-access scenario:
   pnpm exec playwright test --config experiments/max-v2-pr22/live.playwright.config.mjs --grep "real concurrent"
   It exercises actual signed-in writes while owner compaction runs, owner-only proof, guest visibility, stable old-head capture, byte parity and browser reconnection. Missing credentials fail; CI does not run this suite automatically.
4. For a **genuine cloud backup**, take an official source Convex export with workspace ACLs, sessions, labRooms, labUpdates, labCheckpointSegments and labAuditEvents, then restore into a SECOND disposable Convex project. Preserve exported blob files/attachment manifests if any. Configure valid Clerk authentication on the restored project. Do not use a second frontend that still points to the source Convex backend.
5. Set MAX_PR22_RESTORED_URL, MAX_PR22_RESTORED_ALICE_STATE, MAX_PR22_SOURCE_CONVEX_URL, MAX_PR22_RESTORED_CONVEX_URL, MAX_PR22_BACKUP_EXPORT_REF and MAX_PR22_RESTORE_JOB_REF in addition to the source account variables. The two Convex URLs must be different HTTPS convex.cloud projects, not aliases.
6. Run:
   pnpm exec playwright test --config experiments/max-v2-pr22/live.playwright.config.mjs --grep "distinct restored"
   It compares independently authorized source/restored page streams byte-for-byte and verifies packed/raw and byte metadata parity. It refuses a self-comparison or mismatched backend URL.
7. Store official Convex job completion logs, timestamps, backup IDs, actual restored deployment IDs, export hashes, ACL identity mapping, and any attachment object hashes in a separately secured operator evidence bundle. The harness **cannot independently verify that operator-provided backup/restore reference strings are authentic**; successful stream equality is necessary but not enough to certify deployment recovery. Real cloud tests HAVE NOT been run by creating this PR.

## Limitations and blockers
- The stabilized sequence is a consistent **single-room prefix**: it is not a transactionally consistent backup of all workspaces and files, a global snapshot, Yjs semantic compaction, protected media blobs, or retention cleanup.
- For production readiness: multi-tab crash/IME/RTL cases, independent signed-in Clerk/Convex restore jobs, outage/partition injection, asset bytes, actual server-deployment evidence, provider cost budgets, cross-account privacy and independent security review still remain.
- Preceding PR #39/#40 standard E2E is failing: workspace-navigation-preview expects 404 but the disabled route returned HTTP 200. This inheritance is a merge blocker; this sandbox-only PR deliberately does not modify production routing.
- Backing out the lab must not roll a compacted server to an old provider unaware of labCheckpointSegments. First restore an independently verified pre-compaction backup into isolation; production Max personal pages remain unmodified.

**Next PR 23/44:** real multi-tab/network-partition/browser IME failure injection, operations cost evidence, and independent security verification of persistence and rollback.
