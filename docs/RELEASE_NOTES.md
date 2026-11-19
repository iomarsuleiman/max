# Max 2.0.0

Max 2.0 lays the groundwork for shared workspaces and teams while keeping the private, single-owner Max you use today exactly as it is. All 44 planned milestones are merged.

## What changes for you today

- Notion-style sharing: a Share menu on every page (invite by email with full access, edit, comment or view; remove people; anyone-with-the-link), a Shared section in the sidebar, comments signed by their authors, live co-editing with named cursors, publishing to the web, duplicating shared pages into your workspace, sharing tools for assistants, and avatars of who else is on the page. See [MAX_2_GO_LIVE.md](MAX_2_GO_LIVE.md).
- A redesigned landing: the butterfly now flaps its wings (on arrival, hover, tap or the keyboard, and stays still with reduced motion), a matching paper grain in dark mode, a whole-screenshot product walkthrough on phones, and a new sample workspace in the screenshots.
- Multi-tab safety and recovery: one tab edits a page at a time, partitions recover cleanly, and Arabic input methods are protected while composing.
- Sturdier offline saving, server checkpoints and cloud recovery groundwork.

## Built in, switched off until you turn it on

Every shared-workspace capability is behind its own server flag (`MAX_V2_*`), and each flag is off unless set to `true`. With all flags off, Max behaves like 1.x and the MCP server stays owner-only.

- Workspaces with verified server-side authorization, management, invitations and scopes, and a navigation shell.
- Real-time co-editing foundations: collaboration codec, authenticated BlockNote provider, durable offline edits, live authorization and lease fences.
- Ephemeral presence, block-anchored comments with mentions, suggestions and change review, a private collaboration inbox and room activity.
- Shared databases with row-level authorization, scoped tasks, assignees, projects and wiki records, task hierarchy and dependencies, permission-fenced task views, and wiki ownership, verification and expiry.
- Guest and cross-workspace sharing, expiring link policies, revocation and default-deny access preflight.
- Deterministic automation rules with dry runs and an inert run journal (no worker, schedule or network side effects).
- Manual meeting notes, private reports and a privacy-safe report pack. Nothing is sent to ChatGPT or any other service automatically.
- A release-readiness lock (`scripts/max-v2-release-readiness.mjs`) that keeps the live rollout gates pending until each is verified.

## Before turning shared features on

The full command list is in [MAX_2_GO_LIVE.md](MAX_2_GO_LIVE.md).

1. Deploy the Convex backend (`pnpm convex:deploy`); the new tables are additive.
2. Work through the gates in [MAX_2_PR44_RELEASE_READINESS.md](MAX_2_PR44_RELEASE_READINESS.md) that need real accounts, devices or an external review.
3. Enable flags one area at a time.

# Max 1.0.0

Max brings private pages, rich documents, personal databases, and an MCP server into one workspace.

## In this release

- Nested pages, favorites, recents, search, templates, comments, history, and a graph of linked notes.
- A block editor with checklists, headings, tables, code, math, media, callouts, mentions, embeds, and inline databases.
- Mobile editing with a compact keyboard-aware toolbar, insertion menu, expanded formatting, undo/redo, and touch block actions. Columns stack on phones, long text wraps, and wide code or tables scroll inside their blocks. Phone layouts replace clipped hover handles with full-size block actions.
- Table, board, gallery, list, and calendar views with filters, sorts, relations, formulas, and rollups.
- Revision-aware saving, local draft recovery, conflict handling, and retry after reconnecting.
- Owner-scoped MCP tools for pages, documents, databases, imports, and profile cards.
- Direct Notion copy imports with selection, review, background progress, cancellation, retry, and reports. Notion originals remain unchanged.
- Compact membership cards with one shared workspace name, twelve color palettes, textured artwork including a curved-band design, a stable issue-date stamp, PNG export, gentle tilt, and reflective QR marks that open Max without publishing workspace data.
- A system-themed landing with a short Fraunces serif hero, angular touch spinner, static paper texture, scalloped section edge and real product screenshots in a clipped sticky walkthrough.
- Recovery screens and an optional offline Paper hop game with opt-in synthesized audio and an on-device best score. The service worker caches only the fallback and game assets, never private pages.

## Deployment requirements and limits

Cloud accounts require Clerk and Convex. Direct Notion imports additionally require an OAuth integration and encrypted token configuration in Convex, described in [NOTION.md](NOTION.md). Authorization requires the account owner's consent. Local mode retains file and ZIP import workflows.

Notion conversion and size limits are documented in the import preview and [NOTION.md](NOTION.md). Relations, formulas, and rollups import as static values.

The mobile editor is a browser editor. Automated Chromium and WebKit checks cover touch-sized layouts, viewport resizing, selection-preserving formatting, block insertion, undo/redo, and saving; physical iOS keyboard behavior requires device testing.

Automatic Vercel deployments run only from `main`. Preview deployments are disabled. Production uses its production Convex deployment key.
