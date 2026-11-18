# Max 2.0 — PR30/44: Read-Surface Lease Deadlines & Revocation Preflight

**Draft · experimental only · stacked on PR29 (#58).** No merge to `max-2.0` or `main`, no deployment, no production collaboration activation.

## Why

The PR18 sandbox provider has its own lease timer and emits status changes. The opt-in comments, suggestions, inbox, and activity view clients previously relied on those status events to clear their own cached data. PR30 adds an independent, fail-closed deadline to each read surface. Even if a provider status event is dropped, its read surface is cleared when the lease expires.

## Changes

- Shared `LocalReadLeaseDeadline` with cancellable generation tokens and bounded timer delays, including early wake-up rechecking.
- Independent lease timers in all four read surfaces. Each clears subscription callbacks and local data; unread counts and suggestion capabilities are reset.
- Reconnection and account switches replace prior deadline generations. Stale timer callbacks cannot clear the new session.
- Deterministic Node tests simulate three account identifiers, revocation/status changes, late callbacks, time jumps and expiry with **no** provider event.
- No new Convex tables, server writes, Yjs operations, network endpoints, retention changes, release flags, private data exports or persistence.

## Verification

`node --test experiments/max-v2-pr18/read-lease-deadline.test.mjs`

`pnpm --filter @max-experiments/pr18-remote-blocknote-provider test`

Full PR CI must additionally pass TypeScript, lint, backup/unit, builds and browser labs before review.

## Limitations / release gates

Tests use a deterministic mock transport; they are **not** substitutes for an independent audit or real three-account Clerk + isolated Convex deployment. The server remains the source of truth for membership, page scope, permissions and lease. Access revocations require server revalidation; a browser timer cannot independently discover a revoked grant before the provider sends an update. Real cloud recovery, Arabic IME, accessibility, concurrent CRDT review and baseline issue #42 are still release blockers.

## Rollback

Abandon the unmerged PR30 branch. Existing PR18 client flags are unchanged, and the production editor is unaffected.
