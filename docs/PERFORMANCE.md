# Performance budgets

Targets from the plan. They are launch gates once measured on the deployed app; measure on real devices before claiming them.

| Metric | Target | How it's measured |
| --- | --- | --- |
| LCP | p75 ≤ 2.5 s | Web Vitals sent to `/api/vitals` (structured logs) |
| INP | p75 ≤ 200 ms | Web Vitals |
| CLS | p75 ≤ 0.1 | Web Vitals |
| Route to editor usable | p95 ≤ 1.0 s warm | Playwright trace |
| Sidebar expand/collapse | p95 ≤ 100 ms | Interaction trace |
| Editor input latency | p95 ≤ 50 ms | Typing trace on a mid-range laptop |
| Search | p95 ≤ 500 ms after the 180 ms debounce | Staging load test |
| Autosave | 650 ms debounce; "Saved" only on acknowledgement | `tests/e2e/journeys.spec.ts` |

## What's already in place

- The sidebar subscribes to lightweight page metadata only; page bodies load per page.
- Sidebar links prefetch route code and page metadata on hover and focus.
- The editor (BlockNote, KaTeX, Mermaid, Shiki) is code-split and loaded when a page opens; Mermaid loads only for diagrams near the viewport, and rendered diagrams are cached on the device.
- Emoji data and Lucide icons load only when the icon picker opens.
- Database rows are paginated (100 at a time, "Load more").
- Fonts use `display: swap`; images lazy-load.

## Known costs to watch

- Search scans the account's documents in one query. That's fine for thousands of pages; beyond that, move to a Convex search index.
- `databases.query` evaluates formulas and rollups on read; very large databases with many rollups should be profiled.
