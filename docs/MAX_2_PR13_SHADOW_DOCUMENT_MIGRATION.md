# Max 2.0 — PR 13/44: Reversible shadow-document migration rehearsal

## Stacking and scope
This draft stacks directly on PR #30 (12/44) and consumes its lossless BlockNote codec checks. It adds a deterministic, **read-only** shadow migration planner and a fail-closed source/shadow comparison for owner-scoped documents. It does not issue or store collaboration tokens, add a Convex table, expose shared content, write document history, or migrate any page.

The planner keeps original content bytes, original IDs, source revisions, schema versions, page IDs, ownership and destination workspace labels. It canonicalizes only the candidate JSON in memory and limits preflight batches to 25 documents. Validation rejects duplicates, corrupt/unsupported content, stale revisions and changed fields; comparison requires exact owner/workspace identity, all source bytes and an equal structure. A successful comparison **always** returns canCutOver=false.

## Readiness and operational requirements
- Source rows must be loaded inside a trusted server-owned owner/tenant authorization context. A caller-supplied ownerId or workspaceId is not evidence of permission. These pure functions cannot replace server authorization.
- Before any write-side backfill: independent two-Clerk-account read/write/revocation proof, per-operation workspace page authorization, isolated backup restore including file hashes, an approved rollback mapping, and production-like version-history and attachment migration tests.
- The migration should become per-page idempotent and resumable, preserve versions, use double/shadow reads with audit-only mismatch telemetry, and keep the original rows until an explicitly approved irreversible cutover. Those workflows are **not implemented in PR13**.
- Retest concurrent editor/MCP writes, offline drafts, crash recovery, old-client behavior, undo/redo, IME/Arabic text, and large files before changing the legacy 650ms autosave path.

## Evidence, rollback and release
New unit tests cover real owner-only document snapshots, source and candidate tampering, cross-owner/workspace, stale revisions, duplicates, invalid schema/JSON, batch limits and all-or-nothing parity. These tests do not demonstrate live multiplayer correctness.

Rollback: remove the planner, tests and runbook. No database changes, production migrations, new feature flags or data reversal required. Current Max personal pages, 650ms saves, local drafts, versioning, MCP and export remain unchanged.

Exact-head ESLint, TypeScript (root+Convex), unit, backup, production build and Chromium/WebKit CI must pass. Existing dependency audit uses continue-on-error. Real security, recovery, device, accessibility, integration and performance gates remain outstanding.
