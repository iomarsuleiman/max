# Max 2.0 — PR 12/44: Collaboration transport compatibility contract

## Scope and evidence
This draft stacks on PR #29. It adds a **read-only, provider-neutral codec probe** for the exact persisted BlockNote JSON used by Max, plus regression fixtures covering custom blocks, nested columns, tables, page/date mentions, mixed Arabic/English text, links, and media.

The probe refuses invalid JSON, duplicate/missing IDs, mismatched schema versions, malformed table data, excessive depth/size and lossy encode/decode output. It keeps the original raw content untouched. A passing probe means *only* that a candidate codec passed a structural round trip with a fixture; it is **not** proof of working multiplayer collaboration.

## Decision still required (ADR pending experimental evidence)
- Spike A: run the actual Convex ProseMirror Sync provider against Max's customized BlockNote 0.55 editor instance and custom extensions.
- Spike B: run a real BlockNote/Yjs provider with durable offline persistence and scoped server authorization.
- In both, test two/three simultaneous clients, undo/redo, IME, RTL selection, tables, drag/drop, disconnect/reconnect/crash/revocation, remote MCP edits, and deterministic versioning.
- Collect transport write amplification, 100/1,000/5,000-block latency, storage/step growth, and cost. Do not recommend one engine until empirical tests pass.

## Security and rollback
The new contract never opens a collaborative session, writes a Convex record, connects a network provider, renders new UI, or supplies an authorization token. MAX_V2 workspace preview flags and workspace write flags remain default OFF. The existing 650ms autosave, local draft recovery, revisions, owner-only pages, asset access and MCP are unchanged.

Rollback: remove the new codec contract, tests and document. No migration or data reversal is necessary.

## Release gates
Run exact-commit lint, root/Convex typechecks, unit and backup tests, production build and Chromium/WebKit CI. Independent provider testing, tenant isolation, live Clerk multi-account authorization/revocation, cloud recovery and attachment hashing, screen-reader/mobile/RTL/accessibility and performance budgets remain open. Dependency audit CI has a continue-on-error caveat.
