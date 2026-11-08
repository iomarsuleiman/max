# Architecture

Max is a single-owner workspace: every row belongs to exactly one account. There are no organizations, sharing or collaborative editing.

## One operation layer for the UI and MCP

```
Browser UI ──useOp/useCall──▶ Convex  ops.query / ops.mutation  (Clerk identity)  ─┐
                                                                                   ├─▶ lib/domain/ops  ──▶ Db adapter ──▶ Convex tables
MCP client ──/mcp (token or OAuth)──▶ Next route ──▶ ops.serverQuery / serverMutation ┘                    (or the local file store)
```

- `lib/domain/ops/*` defines every operation once: a name, a Zod input schema, a description, flags (`destructive`, `uiOnly`) and a handler that takes `{ db, storage, ownerId, now, source }`.
- `execute()` validates input, enforces `confirm: true` for destructive operations, blocks UI-only operations for assistants, and records assistant writes in the audit log (operation names only).
- The Convex functions in `convex/ops.ts` derive `ownerId` from the Clerk identity (browser) or from a server-verified token (MCP, guarded by `MAX_SERVER_SECRET`). Handlers never accept an owner from the caller.
- The MCP server (`lib/server/mcp.ts`) registers every non-UI-only operation as a tool, generated from the same registry, so parity is structural. `tests/unit/parity.test.ts` scans the UI for every operation it calls and fails if one is missing from the registry or not exposed to MCP.
- Local mode swaps Convex for `MemoryDb` persisted to `.max-data/db.json` (atomic writes, serialized transactions), served through `/api/local/*` with server-sent events for live updates.

## Data model

| Table | Notes |
| --- | --- |
| `pages` | Pages, databases (`kind: "database"` with `properties` and `views`) and database rows (`databaseId`, `values`). Fractional `rank` keys order siblings; `archivedAt`/`archivedRootId` implement trash; `favoriteRank`, `lastOpenedAt`, `isTemplate`. |
| `documents` | One per page: BlockNote JSON (`content`), plain `text` for search, `revision` for optimistic concurrency, `wordCount`. |
| `settings` | Preferences, sidebar order and state. |
| `assets` | Uploaded files (Convex storage), referenced from content as `max-asset://<id>` and resolved per request after an ownership check. |
| `tokens` | Personal access tokens (SHA-256 hash only). |
| `audit` | Assistant operations: name, target id, outcome, time. |

## Editor

`components/editor` is the Chaos block editor (BlockNote with the shadcn theme) adapted for Max: Chaos's side menu, block action menu, slash-menu search, drag feedback and drop placement, link and paste policy, error boundaries, callouts, equations, YouTube and diagrams, plus Max's page links, mentions, bookmarks and table of contents. The canonical format is BlockNote JSON; Markdown conversion (`lib/domain/blocks.ts`) runs only at import/export and for MCP.

## Saving

`useDocumentSync` debounces edits (650 ms), mirrors unsent content to localStorage, sends `documents.save` with the base revision, and marks "Saved" only on acknowledgement. Conflicts (`CONFLICT`) keep the local draft and offer "Load latest" or "Keep my version". Network failures retry with exponential backoff and immediately on reconnect.

## Security

- Ownership is enforced in every handler (`requirePage` returns the same "not found" for another account's ids).
- Inputs are validated with Zod; content size, nesting depth, page count, upload type and size are limited (`LIMITS` in `lib/domain/ops/helpers.ts`).
- Pasted HTML is sanitized; only http(s), mailto and internal links survive.
- Formulas run in a small interpreter with no access to JavaScript globals.
- MCP: bearer tokens or Clerk OAuth, per-account rate limiting, destructive operations require explicit confirmation, credential and account-deletion operations are not exposed.
