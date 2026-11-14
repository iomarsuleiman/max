# Max 2.0 — PR 07: invitation and mutation integrity

**Draft · stacked on PR #24 · shadow authorization only · no shared documents or workspace MCP.**

## Security changes

- Identity-bound invitation acceptance and recipient listing now reject malformed/expired/resolved records, future-created invitations, invalid workspace/issuer identity, and durations beyond seven days. The valid invitation must still be accepted by the exact Clerk/Convex subject; an active authorized issuer is rechecked at acceptance.
- Revoking an existing membership atomically marks its group and teamspace affiliations revoked and removes direct-account page grants, with an audit event. A later valid invitation still resets inherited account-specific permissions before rejoining.
- Group/teamspace affiliation writers now validate **all** returned rows for the target account, including duplicate unrelated affiliations, invalid status/IDs and cross-workspace/cross-account contamination.
- Page-grant writers validate the entire bounded ACL of each page: duplicate subject, corrupt scope/subject, invalid effect/level and overflow fail closed.
- New grants to revoked accounts are rejected. Existing owner-only personal notes and MCP handlers are unchanged.

## Review and release checklist

- Default-off `MAX_V2_WORKSPACE_WRITES_ENABLED` remains mandatory. No enablement, data migration or deployment in this PR.
- Synthetic unit tests verify invitation integrity and mutation policy; they are **not** authenticated live multi-account tests or a concurrency proof.
- Required: exact-head lint, root/Convex typechecks, unit tests, backups, production build and Playwright Chromium/WebKit; audit remains configured with a `continue-on-error` caveat.
- Required before shared-content rollout: 2+ real Clerk identities and workspace isolation, concurrent revoke/invite/ownership/group tests, cloud backup/restore with file hashes, rate limiting and information-disclosure assessment, independent security review.
- All future document/history/asset/search/export/MCP entrypoints must enforce verified server-side workspace authorization within each trusted operation. Do not treat a read-only permission probe as a grant token.
