# Collaboration boundaries and migration constraints

Date: 2026-11-10. Status: accepted constraints; implementation remains gated by
phase 00. Source: saved Max Collaboration 2.0 plan, phases 00, 01 and 03.

## Context

Max currently derives a single `ownerId` at the server boundary. The UI and MCP
share domain operations, and local mode persists the same domain model without
Clerk or Convex. Collaboration must add membership without replacing the editor,
breaking personal notes or requiring cloud credentials for local use.

## Workspace hierarchy

Content belongs to a Max workspace, either personal or organization. Preserve
one personal workspace per existing account. An account may also belong to
multiple organizations. Teamspaces group content within an organization; groups
assign permissions; projects and databases remain content. Notion workspace IDs
are external identifiers and must not become Max workspace IDs.

Backfill existing rows in place. Keep page IDs, block IDs, links and revisions.
Persist the owner-to-personal-workspace mapping and reuse it on retries. Schema
expansion must support existing open tabs during the rollback window. A JSON
content import, which creates new page IDs, is not the migration mechanism.

## One permission authority

Resolve identity and membership on the server before constructing an authorized
workspace context. A caller-supplied workspace ID selects a requested resource;
it cannot establish access. Keep the same evaluator behind UI, Convex and MCP.

Initial workspace roles are owner, admin, member and guest. Page grants separate
full access, edit, edit content, comment and view. Represent operations through
capabilities so later roles do not require changes in every handler. Exact grant
precedence and inheritance overrides need a tested matrix before implementation.

Apply the policy to assets, search, counts, graph edges, backlinks, history,
exports, notifications and embedded databases, as well as page writes. Moves
must validate both source and destination. Keep unauthorized identifiers
indistinguishable from missing ones. Reject hierarchy cycles and protect the
last workspace owner.

## Canonical content and transport

BlockNote JSON remains canonical. Custom block properties, table variants,
mentions, formatting, nesting and stable IDs are part of the compatibility
contract exercised by the corpus. Markdown remains an import/export format.

Transport is undecided. Phase 04 must compare Convex ProseMirror Sync and
BlockNote's Yjs path using the actual corpus and two clients. Select neither
through documentation alone. Do not add a transport dependency or reinterpret
stored documents before the proof of concept passes.

## Offline and revocation

Retain local draft recovery, acknowledged-save status and optimistic revision
checks until the replacement sync adapter proves equivalent behavior. A draft
is not a successful remote write. Reconnect must recheck access before replaying
queued edits. Revocation must reject pending writes and clear or redact remote
subscriptions, previews and cached results. The UI must offer a clear personal
workspace fallback rather than a redirect loop or ghost shared content.

The treatment and export of a local unsent draft after revocation must be
specified and tested before enabling shared offline editing. Never silently
overwrite a newer document or report a rejected write as saved.

## Delivery and rollback

Use backup, schema expansion, resumable backfill, shadow reads, validation,
cutover, a rollback window and only then cleanup. Retain the original data and
application version throughout that window. Test rollback on representative
local and isolated cloud data before applying a cloud migration.

Shared capabilities remain unavailable until their gates pass. Do not invent
environment flags that appear to enable unfinished collaboration. The future
flag contract must cover server operations, subscriptions and UI together, with
a documented disable path. Local mode maps to a local personal workspace and
does not advertise multi-user guarantees.

## Module responsibilities

- Domain operations own capabilities and invariant checks; adapters own storage
  access and transaction boundaries.
- Convex and local/server entry points own verified identity and context creation.
- The editor owns rendering and interaction; the sync adapter owns transport,
  acknowledgment and recovery.
- Import/export owns explicit reference mapping. It must never rewrite arbitrary
  prose or block IDs to move content between containers.
- The workspace shell owns selection, focus restoration and revoked-access
  presentation. It cannot grant access by hiding or showing controls.

## Consequences

Storage cannot become shared by changing an owner filter alone. Migration,
permission, revocation and two-client tests are prerequisites for rollout.
Phase 00 fixtures and local recovery provide evidence for current behavior;
they do not certify a cloud migration or a collaboration transport.
