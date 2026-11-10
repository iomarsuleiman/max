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
