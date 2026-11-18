# Max 2.0 — PR31: Shared Database Row Authorization Foundation

**Experimental contract only. No rollout, migration, new tables, or user-facing shared database API.** This PR is stacked on PR30 (#59). `main`, `max-2.0`, the personal database engine, existing MCP, and the production editor are unchanged.

## Purpose

The next Max 2.0 roadmap area is shared databases, tasks, projects and wiki. The first slice establishes authorization rules **before** adding shared record readers/writers or reusing the existing personal database engine in a workspace.

The domain-owned `lib/domain/sharedDatabasePolicy.ts` exports:

- `previewAuthorizedSharedRecords`: bounded, metadata-only prototype that requires an authenticated principal, one active database binding, live database page permission and separately evaluated page permission for **each** record. It rejects wrong-tenant, malformed, duplicate or wrong-parent candidates. The response contains only page ID, title and update time for records the account can view; it excludes raw properties, formulas, rollups, relation targets, hidden totals and hidden pagination cursors.
- `canEditSharedRecord`: a non-mutating preflight requiring edit capability on **both** the database and the record. This is not sufficient authority to write; a future transactional mutation must recheck immediately before modifying data.
- `SharedDatabaseReadStore`: a trusted backend adapter contract reusing the existing `WorkspaceAuthorizationStore` and `canAccessWorkspacePageFromServer`. No alternate permission engine or client-supplied ACLs.

## Security boundaries

- All candidates, account IDs and workspace context must come from a server-verified identity and a trusted backend query, **not** client-input rows or claimed roles.
- The store must perform its reads in the same trusted transactional snapshot. Future queries must apply a database index and `.take(101)` or an equivalently bounded database read **before** calling the contract. The 100-candidate cap is a corruption guard, not a substitute for backend query limits.
- The prototype does not imply completeness: it has no total count, next cursor, or pagination contract. A real product reader needs a separate, authorization-safe cursor and incremental query design.
- Cross-database relation expansion, formula evaluation and rollup calculations remain disabled on shared data until all referenced rows are authorized, with no leaks through derived totals, sorting or filtering.
- No new Convex tables, queries, mutations, UI, collaboration flags, user invitations, shared documents, timeline, public links, or MCP tools are enabled. Personal databases continue to behave exactly as before.
- Failed or corrupted reads return an empty response (including invalid identities and inaccessible scopes), never partially authorized metadata. This is a privacy-first prototype; future user-facing errors require a carefully scoped error model.

## Verification

`pnpm test -- tests/unit/sharedDatabasePolicy.test.ts` (covered by root `pnpm test`), `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test:backup`, and the existing multi-browser GitHub workflow.

Tests cover cross-workspace isolation, no database-level access, record denial, revoked accounts, corrupt bindings, duplicate IDs, limit checks, parent mismatch, malformed ancestry, archive filtering, no exposed derived/private data, backend exceptions, and edit preflight.

## Not yet complete

True shared database persistence and indexes; membership-bound registration and lifecycle; typed assignees/tasks/projects/wiki; real per-row view/filter/aggregate semantics; incremental queries; authorized mutations; UI/MCP parity; independent three-account Clerk/Convex security proof; native Arabic/RTL, assistive technology, real cloud backup/restore with attachments; CRDT review, performance evidence, independent security review and [baseline reconciliation #42](https://github.com/iomarsuleiman/max/issues/42).

Rollback: abandon the unmerged draft. No database migration, runtime feature flag activation, or production data modification is involved.
