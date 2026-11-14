# Roadmap

The full plan lives in Notion ("Max — Complete MVP Architecture, Build Stages & Implementation Plan").

## Status

| Stage | State |
| --- | --- |
| 0 · Bootstrap (Next.js, Clerk, Convex, CI) | Built. Accounts and deployment need the owner steps in [SETUP.md](SETUP.md). |
| 1 · Notes data (owned pages, nesting, ordering, isolation) | Built and unit-tested. |
| 2 · Workspace UI (sidebar, routing, search, favorites, recents, trash) | Built and covered by end-to-end tests. |
| 3 · Editor (Chaos block editor, media, page links) | Built. |
| 4 · Reliability (autosave, drafts, conflicts, retries) | Built and tested. |
| 5 · Polish (themes, RTL, accessibility, settings, export, templates, databases, Notion import) | Built. |
| 6 · Release (security review, performance measurement, production deploy) | Waiting on owner setup; then measure the budgets in [PERFORMANCE.md](PERFORMANCE.md). |

## Next

- Run `pnpm covers:fetch` to add public-domain cover collections.
- Measure performance budgets on the deployed app and tune.
- Real-device keyboard and screen-reader passes (iOS Safari, Android Chrome, VoiceOver, TalkBack).

## Max 2.0 work in progress

The saved Max Collaboration 2.0 plan now defines the next release: personal and
organization workspaces, teamspaces, permissions, collaborative editing,
comments, notifications, shared projects, guests, workflows and administration.
The current app is still a private, single-owner workspace. Pure policy tests,
migration rehearsals and transport experiments do not enable sharing.

See [the current baseline and remaining gates](MAX_2_BASELINE.md) and `TASKS.md`
for verified progress. Preserve the current editor, local drafts, Arabic/English
support and UI/MCP parity throughout implementation. AI runtime features remain
out of scope.
