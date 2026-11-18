# Max 2.0 — PR29/44: Room Activity Timeline & Revocation Fences

**Draft, experimental only. Stacked on PR28 (#57); do not merge into main, max-2.0 or deploy.**

## Implementation

- A read-only, metadata-only **room-scoped** collaboration timeline in the separate PR17 Convex schema, not the production Max schema, existing personal notes or the Yjs CRDT.
- Successful thread open/reply/resolve/reopen and suggestion propose/accept/reject operations atomically append activity alongside the original authorized mutation. Source retry/idempotency rules prevent duplicate events.
- Every reactive read checks the **live authenticated Clerk identity, session lease, room scope, current workspace membership and page grants**. A revoked actor's ID is redacted on later reads, and revoked viewers lose access.
- Activity stores only room, action kind, source record ID, actor ID and timestamp. It excludes page/document text, comment bodies, suggested replacements, rationale, email and Yjs bytes. An event pointer is never authorization to load the referenced source.
- Per-room retention: 128 rows, evict oldest on insertion; query validates the bound and returns at most the latest 40 actions. Older events cannot be recovered from this demo timeline.
- The isolated PR18 editor provides a read-only, keyboard and RTL-friendly preview behind **VITE_PR29_ENABLE_ACTIVITY_LAB=true**. No production UI, public activity feed, push/email, history backfill, search, archival export, pagination or offline cache.

## Verification

- \`pnpm exec vitest run tests/unit/collaborationActivitySandbox.test.ts\`: transactional source events; no content leakage; retries; cross-account and cross-room denial; leases; revocation/redaction; retention.
- \`pnpm --filter @max-experiments/pr18-remote-blocknote-provider test\`: client validation, session binding, stale callbacks, expirations and read-only lifecycle.
- Full CI: lint, both TypeScript projects, unit/backup, production build, provider and browser labs. A configured dependency audit is not independent security clearance.

## Outstanding release blockers

Independent three-real-account Clerk + Convex sandbox tests, security review, native Arabic keyboard and accessibility verification, cloud backup/restore with attachments, CRDT applicability races, and baseline issue #42 reconciliation. Do not enable production collaboration.

## Rollback

Disable \`VITE_PR29_ENABLE_ACTIVITY_LAB\` or abandon this draft branch. Delete lab-only records only in a disposable sandbox with owner authorization. Never rewrite production notes, CRDT log, recovery journals, main or max-2.0.
