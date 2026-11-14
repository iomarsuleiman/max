# Max 2.0 — PR 06: group registry and fail-closed authorization integrity

**Draft, stacked on PR #23. Shadow authorization only.** Production workspace writes remain disabled by default. No shared documents, collaborative UI, page migration, realtime editing, or expanded MCP access.

## Scope
- Owner-only audited `registerGroup` registers immutable workspace-scoped shadow groups. Registration does not create an affiliation or grant any page permission.
- Workspace provisioning rejects orphaned group records as well as existing orphaned memberships, invitations and teamspaces.
- Activating a group or teamspace affiliation requires exactly one registered group/teamspace in the **same workspace**. Unknown, duplicate or cross-tenant IDs fail closed.
- Creating group ACL grants requires registration. Owner remains the only role allowed to create group-wide ACL grants; admins may manage permitted direct-account grants only.
- Read-only server authorization validates active group and teamspace affiliations against registered scopes, rejecting duplicate IDs, malformed identifiers, oversized affiliation sets, forged ownership and suspended/revoked memberships.
- Added synthetic two-account test fixtures for privilege leakage, group and teamspace registry mismatches, ancestry, explicit denies and duplicate records. **These are not real authenticated multi-Clerk-account tests.**
- Prior identity-bound invitation issue/accept/decline/revoke behavior remains unchanged. A known exact Clerk subject is required. No email delivery or invite links.

## Release gates
- GitHub Actions at exact commit: lint, root+Convex TypeScript, unit, backup, build, Chromium/WebKit; audit job has a `continue-on-error` caveat.
- Test with two *real* Clerk/Convex accounts: targeted invites, expiry, revocation, impersonation, owner transfer, group registration and cross-workspace access.
- Concurrent invitation accept/revoke, parallel group registration and ACL updates, limits and anti-spam policies.
- Isolated Convex cloud backup/restore and asset integrity; security, PII retention and audit review.
- Every future shared document, asset, history, export, search and MCP operation must enforce authorization inside its own trusted handler, never by trusting a browser-side permission probe.

The `MAX_V2_WORKSPACE_WRITES_ENABLED` gate remains OFF by default. No merge or deploy from this draft.
