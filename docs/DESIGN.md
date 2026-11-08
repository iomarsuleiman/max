# Design

Notion-like restraint: matte neutrals, one quiet accent, color only where it means something.

## Tokens (app/globals.css)

- **Four surfaces:** `--surface-1` (sidebar/frame), `--canvas` (page), `--surface-2` (inputs, subtle fills), `--overlay` (menus, dialogs, popovers). Dark mode lifts elevated surfaces instead of inverting.
- **Two strokes:** `--line`, `--line-strong`. **Three text tiers:** `--fg`, `--fg-2`, `--fg-3`.
- **Accent:** `--accent` with hover, pressed, soft and text variants. **Semantic:** success, warning, danger (each with a soft fill), always paired with text or an icon.
- **Tags and icons:** nine Notion-style colors (`--tag-*`, `--icon-*`), tuned per theme.
- All values are OKLCH, no pure black or white. Motion: 100/150/200 ms, disabled with *Reduce motion* or the OS setting.

## The twelve UX principles, applied

| # | Principle | Where it shows up in Max |
| --- | --- | --- |
| 1 | Trust copy | Sign-in footer, privacy page, Connections explains what assistants can and can't do, delete flows say exactly what goes. |
| 2 | Escape from empty states | Empty sidebar, favorites, recents, trash, search, database views and templates each explain and offer the next step. |
| 3 | Contextual help | Settings rows have helper text; formulas list functions; import explains how to export from Notion; property types describe themselves. |
| 4 | Confirmed success | Toasts after moves, restores, exports and imports (with Undo/Open where it works); "Saved" only after the server acknowledges. |
| 5 | Specific errors | Domain errors name the cause and fix (e.g. "A page can't be moved inside itself"); validation messages per field; conflict and offline states. |
| 6 | Explained waiting | Skeletons for content, "Saving…/Retrying…", import progress ("Uploading images (3 of 12)…"). |
| 7 | Remember known values | Preferences per account; sidebar width, order, collapsed sections and expanded pages; last database view; icon color; recent icons; unsent drafts. |
| 8 | Cohesive icons | Lucide throughout at one stroke weight; icon-only buttons have labels and tooltips. |
| 9 | Literal CTAs | "Move to trash", "Delete permanently", "Restore page", "Export Markdown", "Add to my pages", "Create token". |
| 10 | Permissions just in time | No permission prompts on load; clipboard is used only when you copy; uploads only when you choose a file. |
| 11 | Reset filters | Search dialog, trash search and database views all have clear/reset actions, distinct from destructive actions. |
| 12 | Never truncate critical info | Save status and errors stay visible; long titles have full-text tooltips; destructive dialogs show full names and counts. |

## Notion-style interactions

Sidebar tree with hover handles, inline "+" and "⋯"; sections reorderable by handle; resizable and collapsible sidebar (⌘\); page header with hover "Add icon"/"Add cover"; 40 px titles; Enter in the title moves into the content; block gutter handles with "+" and "⋮⋮"; `/` and `@` menus; settings as a two-pane window; database views as tabs with Filter, Sort, Search and a New ▾ split button for row templates.
