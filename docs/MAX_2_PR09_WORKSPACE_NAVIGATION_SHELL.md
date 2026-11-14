# Max 2.0 — PR 09/44: Workspace Navigation & Arc-Inspired Shell Foundation

## Boundaries
- Draft stacked on PR #26; no merge, deployment, live migration, or shared documents.
- Workspace preview requires **both** `NEXT_PUBLIC_MAX_V2_NAVIGATION_PREVIEW_ENABLED=true` (web) and `MAX_V2_NAVIGATION_PREVIEW_ENABLED=true` (Convex plus web). Both are OFF by default.
- No user-supplied subject/role/workspace list can authorize a navigation query. The Convex query uses the authenticated Clerk subject and bounded membership rows, validates owner and workspace provenance, and returns only { workspaceId, role }.
- The membership list **is not a page-access grant**. No pages, teamspaces, document bodies, asset paths, comments, search, export, mutations, invitation flows, or MCP resources are surfaced.
- Legacy personal sidebar and data queries are untouched. The separate preview route does not mount the personal sidebar, search, or editor, and returns the same unavailable state for unknown/unauthorized/disabled workspaces.
- From a personal editor, workspace preview links open in a **new browser tab** so an unfinished editor isn't unmounted. Workspaces never receive private drafts by navigation.

## PR 09 scope
1. Add a server-only authenticated membership-list projection, using indexed account reads and 50-workspace hard bound. Corrupt/duplicate/mismatched rows fail closed.
2. Add opt-in slim workspace rail, mobile picker, and metadata-only read-only preview route.
3. Keep sidebar navigation visually isolated: the original private tree appears only in personal mode, and workspace previews contain no shared trees.
4. Add nine policy tests and a browser test for the default-OFF route.

## Deliberately deferred to PRs 10–11 and later
- Per-workspace persisted sidebar/tree state, favorites, draft tabs and contextual search.
- Shift-wheel cycling, editable shortcuts, full mobile polish, hover peek, split view, animations, cross-workspace drag/drop.
- Shared page navigation / ACL-safe prefetch, loading personalized membership names, collaborative editing, cross-workspace MCP.
- Unsaved-document synchronization for **same-tab** workspace switches. The new-tab isolation in this PR is a conservative temporary boundary.

## Verification & release checklist
- [ ] GitHub exact-head CI: ESLint, TypeScript (Next+Convex), Vitest, local backup tests, production build, Chromium and WebKit.
- [ ] Dependency audit status read with `continue-on-error` caveat.
- [ ] Authenticated two-account membership/revocation/invite tests against real Clerk+Convex, including stale cache and duplicate membership corruption.
- [ ] Offline, mobile, RTL, keyboard, reduced-motion, private-editor unsaved-draft and privacy cross-account tests.
- [ ] Isolated cloud recovery + attachment hashes, permission volume/performance, independent security review.
- [ ] No shared-content/MCP/production workspace flags enabled without distinct operation-level authorization and sign-off.

Rollback: leave both navigation preview flags unset; no content migration or edits are required. The schema adds one read index to the existing shadow membership table.
