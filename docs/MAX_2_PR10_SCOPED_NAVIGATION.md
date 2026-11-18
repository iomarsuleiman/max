# Max 2.0 — PR 10/44: Workspace-Scoped Navigation State & Safe Context Switching

## Scope
This draft builds on PR 09/44. No production feature flag is enabled, no shared content or collaboration is added, and no personal-note storage schema or server write route is changed.

- Each authenticated account's workspace preview has independent, bounded, tab-session-local navigation state (collapsed workspace list and scroll position). Keys include the authenticated Clerk account ID and validated workspace ID.
- Metadata states contain **no page IDs, page titles, content, drafts, search terms, asset references, permission grants or authorization tokens**. Any malformed state or inaccessible storage resets to defaults without preventing navigation.
- The personal editor's navigation is still separate; links from personal contexts to preview open with target=_blank and noopener. Preview-to-preview switches can happen in the same tab because preview never has an editor.
- A distinct WorkspacePreviewFrame mounts neither WorkspaceProvider (which queries the private page tree and settings) nor personal search, editor, dialogs or shortcuts. This prevents private-tree data queries while viewing preview routes.
- Workspace membership summaries are fail-closed validated on the client as defense-in-depth; **the server remains the sole authorization authority**, and summary snapshots cannot authorize page reads or writes.
- Preview navigation has keyboard-reachable, labeled controls, a collapsed/expanded workspace list, mobile dialog and deterministic fallbacks for revoked, loading or unavailable workspace memberships.

## Release/rollback
The existing frontend and private Convex navigation-preview flags both default to false. Disabling either returns to the PR09-disabled landing behavior. Personal routes, data and MCP remain unchanged. Rolling back the PR discards only ephemeral sessionStorage preview-list preferences.

## Verification
- Run exact-commit GitHub Actions lint, root/Convex typechecks, unit/backup tests, build, Chromium and WebKit. CI audit uses continue-on-error: a passing audit job is not proof of zero vulnerabilities.
- Independently test with two actual Clerk accounts: membership revocation and account switch, browser-tab editor preservation, cross-workspace isolation, keyboard and touch interactions, RTL, mobile screens, failed/offline storage, and reduced motion.
- Require an isolated Convex cloud restore with attachment hashes before enabling shared content. PR10 intentionally does not attempt this.
- Pending future PRs: real shared navigation state once pages are authorized, safe same-tab editor flushing, favorites/search/draft tabs, shortcuts, spatial gestures, drag/drop, cross-workspace MCP and shared search.
