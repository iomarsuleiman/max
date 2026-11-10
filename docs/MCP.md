# MCP server

Max exposes a remote MCP server (Streamable HTTP) at `https://max.chaos.fail/mcp`.

## Connecting

- **ChatGPT and Claude:** add a custom connector with the URL above and sign in with your Max account (OAuth through Clerk; see docs/SETUP.md step 7).
- **Other clients:** create a token in *Settings → Connections* and send `Authorization: Bearer max_…`.

## Behaviour

- Every tool acts only on the signed-in account's data.
- Writes accept `baseRevision` where content is involved; if the page changed since it was read, the tool returns `CONFLICT` instead of overwriting.
- Tools that permanently remove data need `confirm: true`. Moving to trash (`pages_archive`, `records_delete`) is reversible with `pages_restore`.
- `batch` runs up to 50 writes as one transaction.
- Every write accepts `idempotencyKey`; repeating a call with the same key within 24 hours returns the first result instead of applying it twice.
- Pages are also MCP resources: `max://page/{id}` returns the page as Markdown, and the resource list shows recent pages.
- `assets_upload` stores images from a public https URL (DNS-checked, private networks and redirects to them refused, 20 MB cap, type checked from the file's bytes) or from base64.
- Errors are structured: `{ error: { code, message, details } }` with codes `UNAUTHENTICATED`, `NOT_FOUND`, `VALIDATION`, `CONFLICT`, `LIMIT`, `CONFIRMATION_REQUIRED`, `READ_ONLY`, `INTERNAL`.
- `max_capabilities` lists every tool and the workspace limits.
- Rate limit: 240 requests per minute per account.

## Parity with the app

Every operation the app performs is a tool, generated from the same registry. The only operations not available to assistants are access-token management, the activity log and deleting all data, which stay in the app by design. `tests/unit/parity.test.ts` enforces this.

## Tools

<!-- tools:start -->
| MCP tool | Operation | Access | What it does |
| --- | --- | --- | --- |
| `—` | Delete all my data | UI only | Permanently deletes every page, database, file, token, setting and log in this account. This cannot be undone. |
| `account_init` | Set up workspace | Write | Prepares a new workspace on first sign-in (preferences and a welcome page). Safe to call again; does nothing once set up. |
| `assets_createUploadUrl` | Start an upload | Write | Returns a short-lived URL. POST the file body to it (with its Content-Type), then call assets.register with the returned storageId. |
| `assets_getUrl` | Get file URL | Read | Resolves a max-asset:// id to a URL the owner can load. |
| `assets_list` | List files | Read | Uploaded files, optionally for one page, with total storage used. |
| `assets_register` | Attach an uploaded file | Write | Registers an uploaded file on a page: images, PDFs, office documents, text, archives, audio and video (26 types), up to 50 MB. Returns a max-asset:// URL to use in image, file, audio or video blocks. |
| `assets_remove` | Delete file | Write · needs `confirm: true` | Permanently deletes an uploaded file. Image blocks that use it will show as missing. |
| `—` | Recent assistant activity | UI only | Operations performed by connected assistants (names and outcomes only, never note content). |
| `batch` | Run several operations | Write | Runs up to 50 write operations in order as one transaction: if any fails, none are applied, and the error says which one failed. Each item is { op, args } using the same names and inputs as the individual tools. |
| `blocks_delete` | Delete blocks | Write | Removes blocks (and their children) from a page. Page history isn't kept, so read the block first if you may need it. |
| `blocks_duplicate` | Duplicate block | Write | Copies a block (with children) right after itself, with new ids. |
| `blocks_formatText` | Format text in a block | Write | Applies inline styles (bold, italic, underline, strike, code, textColor, backgroundColor) or a link to every occurrence of `text` inside a block. Pass a style as false to remove it. |
| `blocks_get` | Get block | Read | Returns one block (with children) by its id, plus its parent block id. |
| `blocks_insert` | Insert blocks | Write | Inserts blocks (or Markdown) before/after a block, as its first/last child, or at the start/end of the page. Returns the new block ids. |
| `blocks_move` | Move blocks | Write | Moves blocks (keeping ids and children) before/after another block or into it as first/last child. |
| `blocks_update` | Update block | Write | Changes a block's type (e.g. paragraph → heading), props (e.g. { level: 2 }, { checked: true }) and/or content (string or inline items with styles). Children are kept. |
| `comments_add` | Add comment | Write | Adds a comment to a page, or to one block when blockId is given. |
| `comments_delete` | Delete comment | Write · needs `confirm: true` | Permanently deletes a comment. Resolving keeps it instead. |
| `comments_list` | List comments | Read | Comments on a page and its blocks, oldest first. Each block comment includes a short excerpt of the block it's on. Resolved comments are included only when asked. |
| `comments_resolve` | Resolve or reopen comment | Write | Marks a comment as resolved (hidden by default) or reopens it. |
| `comments_update` | Edit comment | Write | Changes a comment's text. |
| `databases_create` | Create database | Write | Creates a personal database (a table of rows, each row is also a page) with Name, Status, Tags and Date properties and one table view. |
| `databases_get` | Get database schema | Read | Returns a database's properties (with option ids/names) and saved views. |
| `databases_list` | List databases | Read | Lists all live personal databases with row counts. |
| `databases_query` | Query rows | Read | Returns rows of a database. Applies a saved view's filters and sorts when viewId is given, plus any extra filters/sorts/search. Paginate with cursor (an offset) and limit (max 200). |
| `documents_get` | Get page content | Read | Returns a page's full content as blocks (with stable block ids), its revision, and optionally Markdown. |
| `documents_save` | Save page content | Write | Replaces a page's entire content with the given blocks. Pass baseRevision from documents.get to avoid overwriting newer changes; force skips that check. |
| `documents_writeMarkdown` | Write page content as Markdown | Write | Replaces a page's content with Markdown, or appends Markdown to the end. Supports headings, lists, to-dos, quotes, callouts (> [!TIP]), code, math ($), tables, images, dividers and links. |
| `export_all` | Export everything | Read | Exports all your pages. format=json returns one Max backup (re-importable with import.maxExport). format=markdown returns a list of files with folder paths. |
| `export_page` | Export page | Read | Exports one page as Markdown or Max JSON (database pages include their rows as a Markdown table). |
| `gallery_install` | Add template from gallery | Write | Adds a built-in template to your workspace (at the top level or under parentId). Returns the new page id. |
| `gallery_list` | List template gallery | Read | Built-in templates (video projects, tasks, meeting notes, reading list, content calendar, journal, weekly planner, wiki) that can be added with gallery.install. |
| `graph_get` | Get the page graph | Read | Returns pages as nodes and their connections as edges: links and mentions in content (type link) and sub-page or database-row nesting (type parent). Pass pageId for a local graph around one page, with depth as the number of hops (1 to 4). Trashed pages and templates are left out. |
| `import_bundle` | Import pages and databases | Write | Imports a tree of pages and databases at once (used for Notion exports). Items reference parents by key; database rows can be parents too. Property types: text, number, select, multi_select, status, checkbox, date, url, email, phone. |
| `import_markdown` | Import Markdown | Write | Creates a page from Markdown. The first '# Heading' becomes the title unless a title is given. |
| `import_maxExport` | Restore a Max export | Write | Imports a Max JSON export as new pages (new ids; links between imported pages are updated). Existing pages are not changed. |
| `pages_archive` | Move page to trash | Write | Moves a page, its subpages and (for databases) its rows to the trash. Reversible with pages.restore until the trash is emptied. |
| `pages_backlinks` | List backlinks | Read | Lists live pages whose content links to or mentions this page. |
| `pages_children` | List child pages | Read | Lists the direct child pages of a page (or root pages when parentId is null), in sidebar order. |
| `pages_create` | Create page | Write | Creates a page at the root or inside a parent page. Optional `index` places it among siblings (default: last). Optional `markdown` sets initial content. |
| `pages_deletePermanently` | Delete page permanently | Write · needs `confirm: true` | Permanently deletes a page that is already in the trash, with everything trashed with it and its uploaded files. This cannot be undone. |
| `pages_duplicate` | Duplicate page | Write | Copies a page with its content, placed right after the original. Subpages (and database rows) are copied too unless includeChildren is false. |
| `pages_favorites` | List favorites | Read | Favorite pages in their saved order. |
| `pages_forgetRecent` | Remove from recents | Write | Removes a page from Recents without changing the page. |
| `pages_get` | Get page | Read | Returns a page's metadata, breadcrumbs, child pages and backlinks. Use documents.get for the content. |
| `pages_move` | Move page | Write | Moves a page to a new parent (null for the top level) and position. `index` is the position among the new siblings, not counting the page itself. A page can't move inside itself or its own subpages. |
| `pages_moveFavorite` | Reorder favorite | Write | Moves a favorite to a new position in the Favorites list. |
| `pages_recents` | List recent pages | Read | Pages and records most recently opened, newest first. |
| `pages_restore` | Restore page from trash | Write | Restores a trashed page and everything trashed with it. If its original parent is gone or still in the trash, it returns to the top level. |
| `pages_setFavorite` | Add or remove favorite | Write | Adds a page to Favorites (at the end) or removes it. |
| `pages_touch` | Mark page as opened | Write | Records that a page was opened so it appears in Recents. |
| `pages_tree` | List page tree | Read | Lists every live page and database in the sidebar hierarchy (lightweight metadata only, no content). Use parentId to rebuild nesting; siblings sort by rank. |
| `pages_update` | Update page | Write | Renames a page or changes its icon, cover, width, text size or lock. Only the fields you pass change. |
| `profileCard_export` | Export my workspace card | Read | Returns a self-contained SVG of your saved card using Max's native card renderer. No private information is uploaded or published. Use profileCard_exportPng for a PNG image. |
| `profileCard_get` | Read my workspace card | Read | Returns your private customizable Max card, including name, subtitle, biography, palette, artwork and pattern. Other accounts' cards are inaccessible. |
| `profileCard_update` | Customize my workspace card | Write | Saves your private workspace card with the same validation as Max's card editor. This does not change your sign-in identity or publish a public profile. |
| `properties_add` | Add property | Write | Adds a property (column) to a database. Types: text, number, select, multi_select, status, checkbox, date, url, email, relation (needs relationDatabaseId), created_time, updated_time. |
| `properties_delete` | Delete property | Write · needs `confirm: true` | Deletes a property and its values from every row. The Name property can't be deleted. This can't be undone. |
| `properties_update` | Update property | Write | Renames a property, changes its type, or replaces its select options. Changing type converts existing values where possible (values that can't convert are cleared). |
| `records_create` | Create row | Write | Adds a row to a database. `values` is keyed by property id or name (select values by option name; new names become options). Each row is a page and can have content via markdown. |
| `records_createMany` | Create rows in bulk | Write | Adds up to 200 rows at once. All rows are validated first; if any is invalid, none are added. |
| `records_delete` | Delete rows | Write | Moves rows to the trash (restore with pages.restore). |
| `records_move` | Reorder row | Write | Moves a row to a position in the database's manual order (used when a view has no sort). |
| `records_update` | Update row | Write | Sets property values on a row (keyed by property id or name). Pass null to clear a value. |
| `records_updateMany` | Update rows in bulk | Write | Applies the same values to several rows. All-or-nothing. |
| `search_query` | Search | Read | Searches page titles and content. Filters: kind (page, database, record), titleOnly, inside (a page id whose subpages to search). Results are ranked title-first and include a text snippet and breadcrumbs. |
| `settings_get` | Get settings | Read | Returns your personal preferences (theme, font, page width, sidebar order and more). |
| `settings_reset` | Reset settings | Write | Restores preferences to their defaults. `scope: sidebar` resets only the sidebar order and sections. |
| `settings_update` | Update settings | Write | Changes one or more preferences. Only the fields you pass change. |
| `tables_edit` | Edit table | Write | Edits a table block: set a cell's text, or insert/delete a row or column at an index (0-based). |
| `templates_apply` | Use template | Write | Creates a new page from a template (under parentId), or a new row from a database row template. Content, icon, property values and subpages are copied; {{today}} becomes today's date. |
| `templates_create` | Create template | Write | Creates a template: a page template, or a row template for a database (databaseId). Optionally copies content (and subpages) from an existing page. Use {{today}} in titles or text to insert the date when the template is used. |
| `templates_list` | List templates | Read | Lists your page templates, or a database's row templates when databaseId is given. |
| `—` | Create access token | UI only | Creates a personal access token. The secret is returned once. |
| `—` | List access tokens | UI only | Personal access tokens for connecting assistants. The secret itself is never shown again. |
| `—` | Revoke access token | UI only | Revokes a token immediately. Assistants using it lose access. |
| `trash_empty` | Empty trash | Write · needs `confirm: true` | Permanently deletes every page in the trash and its uploaded files. This cannot be undone. |
| `trash_list` | List trash | Read | Pages in the trash (only the pages you trashed directly; their subpages come back with them). |
| `versions_create` | Save a version now | Write | Keeps the page's current content in its history right away (for example before a big rewrite). |
| `versions_get` | Get a page version | Read | Returns one earlier version's content as blocks and/or Markdown, to compare with the current page. |
| `versions_list` | List page history | Read | Earlier versions of a page's content, newest first (time, revision, title, word count and whether an assistant made the change). The current content isn't included. |
| `versions_restore` | Restore a page version | Write | Replaces the page's content with an earlier version. The current content is kept in history first, so a restore can itself be undone. Optionally restores the title too. |
| `views_create` | Create view | Write | Adds a saved view (table, list or board) to a database. |
| `views_delete` | Delete view | Write | Removes a saved view (rows are not affected). A database keeps at least one view. |
| `views_move` | Reorder view | Write | Moves a view tab to a new position. |
| `views_update` | Update view | Write | Changes a view's name, layout, filters, sorts, hidden or ordered properties, column widths or board grouping. |
| `workspace_overview` | Workspace overview | Read | Counts, recently visited, recently edited, favorites and 14-day editing activity as a workspace summary. |
| `assets_upload` | Upload an image | Write | Stores an image from a public https URL (private networks refused) or base64 data and returns a max-asset:// URL. |
| `import_html` | Import HTML as a page | Write | Converts HTML (passed in or fetched from a public page) into a new page. |
| `max_capabilities` | What Max can do | Read | Lists tools, limits, resources and error codes. |
| `profileCard_exportPng` | Download my workspace card as PNG | Read | Renders the saved private card as a PNG image without publishing it. |
| `notion_status` | Get Notion connection status | Read | Returns safe connection metadata for your own Notion workspace. Connect or reconnect in Max Settings; no provider credential is returned. |
| `notion_sources` | List shared Notion sources | Read | Searches pages and data sources shared with your connected Notion integration. Follow nextCursor for more results; this is not the entire Notion workspace. |
| `notion_preview` | Preview a Notion import | Read | Reviews selected authorized Notion roots and a Max destination before importing copies. Estimates and known limitations are disclosed; source content is never modified. |
| `notion_start` | Import copies from Notion | Write | Starts a persisted background import of selected shared Notion pages and databases into your Max workspace. Supply a stable idempotencyKey to retry without duplicate trees. This never changes Notion originals. |
| `notion_job` | Get Notion import progress | Read | Returns persisted progress, counts, warnings and errors for an import owned by your Max account. Use rootIds to open imported copies. |
| `notion_report` | Read a Notion import report | Read | Returns the owner-scoped migration report with created, skipped and failed items and conversion warnings. Never contains upstream access tokens. |
| `notion_history` | List Notion import history | Read | Lists recent Notion import jobs owned by your Max account, including completed, interrupted and failed imports. |
| `notion_cancel` | Cancel a Notion import | Write | Stops an owned background import at its next checkpoint. Already imported Max copies remain and the original Notion content is never changed. |
| `notion_retry` | Resume an incomplete Notion import | Write | Resumes an owned interrupted import from persisted checkpoints without duplicating previously created copies. Reconnect in Max if source access expired. |
<!-- tools:end -->
