# Max 2.0 — PR21/44: Server checkpoint packs and recovery evidence

Draft, stacked on PR #39. Unmerged and undeployed. Changes are limited to the disposable standalone PR17 Convex collaboration sandbox and tests.

## Implementation
- Authorized owner-only compactLog mutation uses current Clerk identity, a valid five-minute lease, current manage permission, and the workspace owner record. A member or guest cannot compact a room.
- At most eight sequential original updates (64 KiB decoded maximum) are repacked to a durable immutable labCheckpointSegments document. Source row removal, checkpoint watermark advancement and the pack insert are one atomic Convex mutation: an interruption cannot leave half-compacted rows.
- Existing authorized readUpdates returns the same sequence and byte strings across archived packs plus the raw log, including late joiners starting from sequence zero.
- appendUpdate checks archived operation IDs and preserves retry idempotence. Changed bytes for the same actor+operation ID are rejected.
- Checkpoint corruption and log gaps fail closed; every destructive operation rechecks the full checkpoint chain.
- This is *lossless record packing*, NOT merged Yjs state, NOT an encrypted semantic snapshot and NOT a cloud backup. It reduces raw-row count but not original room byte quota or the 256-update cap. These deliberate restrictions avoid accidental data loss.

## Backup and recovery procedure
1. Use only a dedicated synthetic Clerk/Convex lab, never real Max notes. Capture readUpdates pages from sequence zero via an authorized session and store a JSON transcript with {scope:{workspaceId,pageId},headSeq,pages:[{headSeq,hasMore,updates}]}.
2. Take an actual **official Convex deployment backup/export** with labRooms, labUpdates and labCheckpointSegments, including checkpointThrough. Retain signed export metadata privately.
3. Restore into a distinct disposable Convex deployment, configure matching synthetic Clerk subjects, and independently capture a new authorized readUpdates transcript from sequence zero.
4. Run: node experiments/max-v2-pr21/recovery.mjs before.json restored.json
5. The verifier checks strict sequence continuity, original update identities, canonical byte payloads, pagination and a SHA-256 fingerprint; it fails if the source and restore differ. This verifies logical stream parity only; also compare official export/restore record counts, indexes, deployment metadata and rollback readiness.
6. Include cursor-boundary tests, concurrent appends/compaction, partial backup failure, ACL downgrade/revocation and client crash/restart with REAL accounts before considering a release.

## Verified locally vs still needed
- Existing emulated Convex tests cover owner-only compaction, cursor replay, persisted idempotence, corrupted raw log refusal, revocation and sandbox flag gating.
- Node synthetic verifier tests cover exact restore parity and intentional corruption. GitHub CI must be checked at the PR's exact commit.
- **NOT performed here:** live Convex cloud backup/restore, actual independent Clerk accounts, real snapshot semantic merge, media/RTL full-schema parity, external penetration test, or production release approval.
- Rollback warning: do not deploy old provider code against any compacted sandbox data, because old versions cannot read checkpoint packs. Restore a verified pre-compaction backup in isolation first. No production Convex schema, personal pages, document migrations, app routes or MCP handlers change.

**Next PR22/44** can pursue authenticated multi-tab and multi-user checkpoint reconnect proof, recovery stress testing, and genuine Yjs semantic snapshots only after equivalence verification.
