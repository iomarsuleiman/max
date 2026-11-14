# Max 2.0 — PR 05: verified invitations and shadow scope provisioning

**Draft, stacked on PR #22. No shared content, collaboration UI, email delivery, or MCP workspace access.**

## Identity-bound invite lifecycle
- Operators must explicitly set `MAX_V2_WORKSPACE_WRITES_ENABLED=true` in an isolated deployment; the flag remains OFF in production.
- `issueInvitation` accepts an **exact known Clerk/Convex subject**, not an email address. This is NOT proof of email ownership. It records a pending invitation, role, bounded 1–168-hour TTL, issuer and audit event.
- `myPendingInvitations` lists only pending invitations addressed to the authenticated subject, while the workspace flag is enabled. No invite ID acts as a bearer permission.
- `acceptInvitation` requires an authenticated subject **equal** to the target. It rechecks workspace status, inviter's current privileges, invite expiry and target membership status, and inserts or reactivates the membership in one transaction with the invitation resolution and audit event.
- `declineInvitation` and manager-only `revokeInvitation` transition a pending invitation to terminal state. Expired invites are rejected by acceptance and may be replaced only after expiry; duplicates fail closed.
- The old `setMembership` mutation can manage **existing** memberships but **cannot create** a new one. New accounts and revoked-account rejoin require accepted invitations. Suspended members cannot use invites to bypass suspension.
- No account discovery, invite URL/token, outbound invitation email, or verified-email matching exists. Those are later integration work; **never** describe this as a production-ready invite delivery flow.

## Teamspace and page registry
- Owner-only `registerTeamspace` adds immutable workspace-scoped metadata.
- Owner-only `registerPageScope` adds immutable **shadow** page scopes after validating the entire parent chain (same workspace, same teamspace, no cycles, bounded depth), a registered teamspace if set, and global page-ID uniqueness. There is no rename/move/delete path yet.
- Neither creates a personal page, shared document, collaborative data storage or grant. Page ACL mutations from PR #22 still require a registered scope. All writes have atomic audit events.
- Workspace creation checks invitation and teamspace registry orphans as well as pre-existing security tables.

## Hard release gates
- CI on this exact commit: lint, root+Convex TS, unit and backup tests, production build, Chromium/WebKit. An audit job passing with `continue-on-error` is not a security clearance.
- Two distinct live Clerk accounts must prove targeted acceptance, malicious ID replay, expiring invites, issuer revocation, repeat acceptance, membership suspension and owner protection.
- Concurrency testing for duplicate invitations, acceptance versus revoke, teamspace/page registration collisions and cross-tenant ancestry.
- Isolated cloud backup/restore with attachment hashes, security review of PII/audit retention, spam/rate-limit policy, and production feature gate review.
- Future shared documents/search/assets/comments/exports/MCP must independently revalidate authorization within their own server operations. No use of read-only authorization probes as a credential.
