# Max 2.0 — PR 04: gated workspace management writers

Status: **draft foundation only; shared content/MCP not enabled**. Stacked directly on PR #21.

## Entry points

All writers live in \`convex/workspaceManagement.ts\` and authenticate with
\`ctx.auth.getUserIdentity().subject\`. A browser cannot supply the actor's
identity or authority. Public mutations are compiled but **every write rejects**
unless the deployment operator explicitly sets
\`MAX_V2_WORKSPACE_WRITES_ENABLED=true\`. **Do not set this in production yet.**

- \`createWorkspace\`: slug validation, no duplicate/orphan shadow records, one
  active owner and membership in one transaction, security audit event.
- \`setMembership\`: owner can add/manage admins/members/guests; admins can
  manage members/guests but not themselves, admins or the owner. Suspending or
  revoking a member takes effect on the next authorization read. Revocation is
  terminal until a future identity-verified invitation/rejoin flow.
- \`transferOwnership\`: only the current active owner can promote an existing
  active admin/member. The owner ID and both membership rows change atomically;
  the previous owner becomes admin. There is never a zero-owner intermediate
  state. No generic mutation can demote/delete the sole owner.
- \`setAffiliation\`: owner/admin control a member's shadow group/teamspace
  affiliation, with role limits and bounded duplicate checks.
- \`setPageGrant\`, \`removePageGrant\`: only on already registered workspace
  shadow page scopes. Duplicate grants fail closed. Owners/admins are protected
  from lower-role ACL changes. Deny and inherited grants are enforced by the
  existing PR #21 read-only gateway.
- \`workspaceSecurityEvents\`: append-only server-written change records.
  No public delete/overwrite or audit-read endpoint is introduced.

All mutation writes and their audit insert happen in a single Convex
transaction. There is **no invitation UI** or guarantee that an accountId
belongs to an accepted invite: this is a staged administrative foundation, not
an approved collaborative membership flow. Group/teamspace metadata and
shared-content source-of-truth management remain future work.

## Immediate revocation boundary

The PR #21 gateway re-reads the active membership and affiliation on every
authorization probe; a suspended/revoked member is denied. It does not
invalidate caches in existing owner-only personal endpoints because those
endpoints are not accessible to workspace members. Every future collaborative
read, subscription, search, export, media delivery, notification, comment and
MCP route must enforce the policy **inside its own server-side operation**.
A green \`canAccessPage\` response is not a bearer capability token.

## Verification and release restrictions

- Run lint, root + Convex typechecks, Vitest, backup tests, Next production
  build and Chromium/WebKit in GitHub CI on this PR's **exact head**.
- Run real 2-account Clerk/Convex tests against a disposable deployment:
  create, grant, demote, suspend, revoke, transfer; repeat direct API and MCP
  attacks; test concurrent owner changes and duplicate membership fixtures.
- Verify isolated cloud backup+restore with assets and hashes, review event
  retention, rate limiting, abuse monitoring, invitation acceptance and
  explicit production feature-flag governance before enabling writes.
- Do **not** merge or deploy PR #19–#22 without independent review of each
  stacked dependency. Do not enable shared documents, migration or realtime
  collaboration in this PR.
