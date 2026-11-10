# Import copies from Notion

In **Settings → Connections**, connect Notion, select shared pages/data sources, choose a destination, and review the import. Imports continue in the backend when the tab closes. Import history includes progress and downloadable reports. Cancel stops new commits; retry resumes the same job without duplicating completed items. Disconnect removes saved provider access; imported pages remain.

## Server setup

Register a Max-branded Notion OAuth integration, with **Read content** capability and no update/insert permissions. Register the exact redirect URL `https://YOUR_MAX_ORIGIN/api/notion/callback`.

Configure these in the **Convex deployment environment**:

- `NOTION_CLIENT_ID`
- `NOTION_CLIENT_SECRET`
- `NOTION_REDIRECT_URI`, matching the registered redirect URL
- `NOTION_TOKEN_ENCRYPTION_KEY`, an independently generated 32-byte key encoded as 64 hexadecimal characters
- Existing `MAX_SERVER_SECRET`, shared with the Next.js server

The web app needs its existing Clerk/Convex configuration, `MAX_SERVER_SECRET`, and `NEXT_PUBLIC_APP_URL`. Notion tokens and secrets never belong in public environment variables. Changing the encryption key makes saved connections unreadable; reconnect after rotation. Deploy Convex functions before deploying the new frontend.

The public OAuth consent flow is owner-initiated. State is random, cookie-bound, short-lived and consumed once by the backend. Tokens use AES-GCM encryption. Every source/job/report is owner-scoped. Local file mode retains the ZIP importer; direct imports require Convex for persisted background processing.

## Supported content and limits

The connector targets Notion API version `2026-03-11`, including data sources and database row pages. Native text, headings, lists, checklists, quotes, callouts, code, toggles, tables and equations are converted. Supported Notion-hosted attachments are copied into Max storage. Internal links are repaired after import using revision checks so subsequent edits are preserved.

Each job is bounded to 2,000 source/journal work items, up to 1,000 blocks per page, 35 source levels and 10 MB per attachment. Existing Max page/property quotas also apply. Quota or source failures stop with a partial report; completed copies remain. Import a smaller subtree or use the existing ZIP importer for larger migrations.

Limitations are disclosed in preview and reports:

- Dates retain range/timezone text instead of changing their meaning into Max's simpler date format.
- Relations, formulas and rollups retain static readable values; behavior is not migrated.
- External media is not downloaded. Only allowlisted Notion storage hosts are fetched, without provider tokens or redirects. SVG attachments are excluded.
- Covers, source comments, permissions, history and database views are not transferred.
- Unsupported blocks become visible fallbacks and warnings. At 1,000 detailed warnings, the report explicitly announces the detail limit; use smaller imports for a complete itemized report.
- Source titles retain their text; metadata exceeding Max field limits stops with a report rather than silently claiming full fidelity.

## MCP

Assistants use `notion_status`, `notion_sources`, `notion_preview`, `notion_start`, `notion_job`, `notion_history`, `notion_report`, `notion_cancel` and `notion_retry`. A stable idempotency key is required to start. The browser and MCP call the same backend service. OAuth consent and connection credential management remain in Settings.

Source references: [Notion authorization](https://developers.notion.com/guides/authorization/overview), [API versioning](https://developers.notion.com/reference/versioning), [source search](https://developers.notion.com/reference/post-search).
