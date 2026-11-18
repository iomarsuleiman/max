# Max 2.0 — PR 03: Authenticated workspace authorization boundary

Status: **foundation only, draft/unmerged, no production rollout**.

## What this PR actually does

- Adds a Convex **read-only** `workspaceAccess.canAccessPage` query whose only
  client arguments are `workspaceId`, `pageId` and a requested capability.
- Resolves the caller from `ctx.auth.getUserIdentity().subject` (Clerk-issued,
  Convex-verified), **not** caller-submitted account/role/group/grant attributes.
- Loads active workspace and exact membership, group membership, teamspace
  membership, bounded page ancestry and grants from indexed Convex tables.
- Uses the PR #20 policy contract, preserving default deny, explicit inherited
  denial, invalid ancestry denial, disabled workspaces and immediate revocation
  on subsequent reads. Duplicate workspace/membership/page-scope rows deny.
- Returns only a boolean. Unauthorized and nonexistent targets behave the same.
- Leaves legacy personal `pages`, `documents`, `assets`, `comments`,
  `versions`, `ops.query/mutation` and MCP owner-scoping **untouched**.

The six new tables are an **authorization shadow model**, not shared-content
storage, and this PR offers no public mutators, role-assignment API or migration
task to populate them. Until data is safely provisioned by reviewed follow-up
work, every new workspace authorization query denies by default.

## What this PR does not authorize

A successful probe is **not** a capability token. Never trust the browser to
call the probe and then fetch data through a different unguarded route. Any
future shared page read/write, search, media delivery, public share, export,
history or MCP tool must load fresh server-side authorization **inside the
actual data operation**. The current personal data paths are intentionally
owner-only, not made shared by this patch.

## Review gates / remaining work

- Verify actual two-Clerk-account isolation/revocation using a disposable
  Convex deployment with controlled fixture rows, including MCP and direct
  backend probes. Unit tests are synthetic and cannot substitute for this.
- Add transactional membership/grant writers, active-owner protection,
  deliberate workspace provisioning, audit logging and change notifications.
- Integrate checks into actual future shared data operations before enabling
  any shared-content flag or migration. Cover search, exports, attachments,
  links, comments, history, direct ID reads and MCP individually.
- Confirm cloud database+attachment recovery, browser CI, latency p95 and
  cross-browser RTL/keyboard/accessibility baseline from earlier PR gates.
- Do not merge/deploy stacked PRs without reviewing each parent and its checks.

No authentication or permissions for current owner-scoped Max 1.x pages changed.
