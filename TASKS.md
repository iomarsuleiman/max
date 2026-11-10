# Connections, migration and profile cards

- [x] Read saved Max MCP audit, Notion import plan and acceptance checklist.
- [x] Inspect source and create editable design before implementation: https://www.figma.com/design/6KtVd71Naz7oFt4fJO73HA.
- [x] Implement secure, owner-scoped Notion connection and resumable copy import.
- [x] Add source picker, destination, review, progress, history and report UI.
- [x] Expose safe Notion operations through MCP and regenerate inventory, 95 tools.
- [x] Add customizable private profile card onboarding and account editing.
- [x] Add connection outcome and app error/recovery pages.
- [x] Add explicit MCP card read/update/export parity, including PNG export.
- [x] Revise landing page with draggable, inertial Max logo using existing colors.
- [x] Add optional offline game and restrained tab/switch/navigation motion.
- [x] Verify the final Arc-style landing revision: monochrome logo, no topbar/toggle/helper text, system theme, static 1,160-byte texture, sticky interactive walkthrough and dark recovery surfaces.
- [x] Verify conversion, ownership, retries, cancellation, UI accessibility and regressions.
- [x] Review diff, publish PR and merge after checks pass, PR #6.

## Constraints and evidence

- Imports are copies. Notion originals are never changed; OAuth consent remains browser-owned.
- Figcraft was absent from available tools, plugin search and local skill inventory. Figma is the available design fallback.
- User subsequently asked to stop using Figma. Further design work uses supplied screenshots/videos and running app directly.
- Screenshot localhost callback pages are owned by the MCP client, not this repository. Max can supply its own branded outcomes/help, but cannot restyle another process's callback handler.
- Direct Notion imports require configured provider credentials and durable Convex backend; live authorization must be verified separately from fixture tests.
- Completion checks: lint, both TypeScript projects, unit suite, production build, targeted browser journeys, generated MCP inventory parity, clean reviewed diff and required PR checks.

## Verification

- 72 unit/integration tests pass, including real Convex schema/store/worker execution against mocked Notion responses, durable attachment ingestion and link repair.
- Both TypeScript projects and ESLint pass. Production build succeeds.
- All 21 browser tests pass from a fresh workspace, including accessibility, desktop/mobile regressions, card PNG export, Notion wizard/report, reduced motion, network-offline fallback/game, system-only landing colors, sticky walkthrough and texture budget. Public help themes persist across reload; the landing intentionally follows the system.
- Convex functions/schema deploy successfully to an isolated anonymous local backend; internal read smoke test succeeds. This does not validate live Clerk or Notion authorization.
- Existing first-sign-in redirect now preserves Settings query parameters, verified with the Notion journey from a fresh workspace.
- Production OAuth credentials remain an operator setup step, documented in docs/NOTION.md. Unsupported conversions and import bounds are disclosed in preview/reports and documentation.

## v1 polish and release
- [x] Merge dark grain and initial logo fix as PR #7.
- [x] Redesign compact membership cards, shuffle, QR foil and motion.
- [x] Improve mobile editor toolbar, keyboard viewport and touch flows.
- [x] Verify no horizontal page scrolling, local wide-content scrolling and touch block actions, Chromium and WebKit.
- [x] Add spinner inertia, distinctive sans hero and optional game audio.
- [x] Run release checks: production build, ESLint, both TypeScript projects, 72 unit tests and all 28 browser checks.
- [ ] Merge release PR and publish v1.0.0 after GitHub checks.
