# Max 2.0 — PR 08/44: authorization snapshot integrity

## Scope

This draft completes the first workspace-roles/teamspaces/permissions security foundation in the stacked 44-PR Max 2.0 roadmap. It does **not** enable shared documents, collaborative editing, workspace-aware MCP, access to legacy owner-only documents, or production workspace writes.

## Threat model and implementation

- The Convex authorization adapter preserves the original workspace and account fields of membership and affiliation rows, and original workspace/page fields of grants. The domain gateway no longer has to trust that the database index or a future adapter scoped the query correctly.
- Read-side authorization rejects records whose trusted workspace, account, page, role or owner identity does not match the requested context.
- The complete ACL for **each** page in an ancestor chain is verified with the same central `validPageGrantRows` policy used for mutations. Invalid subject IDs/types, invalid effects/levels, duplicate account/group/role grants, cross-workspace records, wrong-page records or more than 100 entries deny the entire request.
- Malformed page parent/teamspace IDs and corrupt group/teamspace provenance deny access before policy evaluation. The read path continues to enforce group/teamspace registration, membership revocation and inherited explicit denials.
- Tests include clean owner/member access and adversarial corruption of unrelated grants, provenance, affiliation, role, scope and bounded ACL sets. These are **synthetic** tests, not a live multi-account security audit.
- All authorization checks remain server-owned; `canAccessPage` is a boolean probe, never an authorization token. Each future shared-content operation must verify identity and permissions *inside its own trusted handler*.

## Guardrails

- `MAX_V2_WORKSPACE_WRITES_ENABLED` remains **off by default**.
- No schema migration or changes to legacy owner-scoped `pages`, `documents`, `assets`, `comments`, `versions` or MCP auth paths.
- This change narrows permissions for corrupt persisted data. Operators should diagnose and repair such records instead of bypassing guards.
- This PR is stacked on PR 07/#25, which is itself unmerged. Do not independently deploy an intermediate branch.

## Required gates before approval and rollout

1. Exact-head GitHub Actions: lint, root/Convex TypeScript checks, Vitest (including this suite), local backup tests, production build, Chromium/WebKit, and configured dependency audit. Audit currently has `continue-on-error` and is not a vulnerability-free attestation.
2. Real authenticated Clerk account isolation: owner, admin, member, guest and outsider with different sessions; revocation, group/teamspace changes, inherited deny, expired/replayed invitation, and cross-tenant access.
3. Concurrency and volume testing: invitation/race scenarios, ownership transfer, 100/101 ACL boundaries, unusual ancestry and soft-revocation ordering. Confirm every query and index uses appropriate limits and response sizes.
4. Isolated cloud backup+restore, complete attachment hash validation, visual/keyboard/RTL checks, independent security review and release approval.
5. Before any new shared document/search/asset/export/history/comment or MCP endpoint is enabled, add internal per-operation authorization, proper capabilities, revision checks, integration/e2e coverage and rollback procedures.

## Verification notes

Local full-suite execution and real multi-Clerk-account sessions are not established by this document. Review the newest GitHub Actions run on the exact PR head, not earlier green runs from parent branches.
