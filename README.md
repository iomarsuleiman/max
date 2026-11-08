<p align="center"><img src="assets/max-icon.svg" width="72" alt="Max logo"></p>

# Max

**Your notes, pages and databases. Private by default.**

Max is a calm, personal workspace: nested pages, a block editor, personal databases and templates, with a built-in [Model Context Protocol](https://modelcontextprotocol.io) server so ChatGPT, Claude or any MCP client can work with your notes when you allow it.

Live at **[max.chaos.fail](https://max.chaos.fail)** once deployed (see [docs/SETUP.md](docs/SETUP.md)).

## What's inside

- **Pages inside pages.** A sidebar tree with drag handles to reorder and nest, keyboard moves (⌥⇧ + arrows), favorites, recents, a trash you can restore from, and a "Move to…" picker.
- **The Chaos block editor.** Headings, to-dos, toggles, toggle headings, callouts, quotes, tables, code with highlighting, math (KaTeX), Mermaid diagrams, images with alt text, YouTube with watch ranges, web bookmarks, table of contents, page links and `@` mentions. Gutter handles to drag blocks, `/` command menu, Markdown shortcuts, safe paste from Word, Google Docs and Notion.
- **Reliable saving.** Truthful status (Saving, Saved, Offline, Not saved, Changed elsewhere), drafts kept on the device until the server confirms, recovery after refresh or crash, retries with backoff, and revision checks so nothing silently overwrites newer edits.
- **Personal databases.** Table, board, list, gallery and calendar views; text, number, select, multi-select, status, checkbox, date, URL, email, phone, relation, formula, rollup, created and edited time; filters, sorts, search, hidden and reordered columns, resizable columns, drag to reorder rows, drag cards between board columns and calendar days, row templates.
- **Templates.** A gallery (video projects, tasks, meeting notes, reading list, content calendar, journal, weekly planner, wiki) plus your own page and row templates with `{{today}}` placeholders.
- **Import and export.** Notion "Markdown & CSV" exports (pages, nesting, databases with inferred column types, rows, row content, links and images), Markdown files and Max backups. Export everything as Markdown (.zip) or JSON.
- **Assistants (MCP).** 70 tools that mirror every UI action, sharing one service layer and permission checks with the app. OAuth for ChatGPT and Claude, personal access tokens for other clients, confirmations for destructive actions and an activity log.
- **Made to be used every day.** Light and dark themes (OKLCH tokens tuned separately), emoji and Lucide icons in ten colors, covers, fonts, density, full-width pages, RTL and mixed English/Arabic text, keyboard shortcuts, mobile drawer, and a settings window for account, preferences, editor, sidebar, connections and data.

## Quick start (local mode, no accounts needed)

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. Without Clerk and Convex keys, Max runs as a single private workspace stored in `.max-data/` on your machine. Local mode is for development and self-hosting; production deployments need the cloud setup.

## Cloud setup

Max uses [Clerk](https://clerk.com) for accounts and [Convex](https://convex.dev) for data, deployed on [Vercel](https://vercel.com). The full checklist is in [docs/SETUP.md](docs/SETUP.md).

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Run the app (local mode unless cloud keys are set) |
| `pnpm convex:dev` | Run the Convex backend against your dev deployment |
| `pnpm build` / `pnpm start` | Production build and server |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` | Checks (ESLint, TypeScript for app and Convex, Vitest) |
| `pnpm e2e` | Playwright journeys (desktop and mobile) against a production build |
| `pnpm mcp:docs` | Regenerate the MCP tool table in docs/MCP.md |
| `pnpm covers:fetch` | Download public-domain cover images (The Met, NASA, James Webb) |

## Project layout

```
app/                 Routes: workspace (home, p/[pageId], templates, trash), auth, public pages, /mcp, local API
components/editor    The Chaos block editor adapted for Max (blocks, side menu, slash menu, drag feedback, paste policy)
components/…         Workspace shell and sidebar, page view, databases, settings, import, dashboard, UI kit
convex/              Schema, database adapter and the authenticated dispatcher
lib/domain/          Every operation (pages, documents, blocks, databases, templates, import/export, settings, tokens)
lib/server/          Local store, MCP server and server-side runner
lib/import/          Notion export parser
tests/unit · e2e     Vitest domain tests and Playwright journeys
```

## Documentation

[Setup](docs/SETUP.md) · [Architecture](docs/ARCHITECTURE.md) · [MCP](docs/MCP.md) · [Design](docs/DESIGN.md) · [Performance](docs/PERFORMANCE.md) · [Roadmap](docs/ROADMAP.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## License

[AGPL-3.0-or-later](LICENSE). The editor is adapted from the Chaos project (same license). Third-party libraries keep their own licenses. The Max logo is not covered by the code license; see [assets/README.md](assets/README.md).

Max is independent and not affiliated with or endorsed by Notion.
