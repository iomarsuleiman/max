# Max 2.0 — PR39/44: Default-Deny Sharing Access Preflight

**Status:** experimental draft, unmerged, not deployed. Stacked on PR38 (#68).
This is a **read-only, identity-bound eligibility preflight**, NOT a public
resource gateway. It deliberately serves neither private nor public content.

## Scope

- `lib/domain/workspaceShareAccessPreflight.ts` provides two narrowly scoped,
  fail-closed checks of existing PR37/PR38 shadow registry state.
- **Accepted external-share candidate:** requires the authenticated exact
  recipient, current accepted consent, valid time, active target workspace
  membership (for cross-workspace sharing), registered unique source scope
  and continuing source-issuer `manage` permission.
- **Workspace-member-link candidate:** requires an active, unexpired
  `workspace_members` policy, unique source scope, current issuer `manage`
  permission AND the caller's **current `view` permission** on that same
  source page, including inherited denies.
- `anyone_with_link` policies always return **false** in this preflight.
  A Convex document ID is not a bearer token or proof of possession.
- Two authenticated Convex queries return **only booleans**. Denied,
  unauthenticated, missing and invalid IDs do not reveal the page, owner,
  recipient, membership, title, content, asset or reason for denial.
- Read adapters reuse server-trusted Clerk/Convex membership and ACL
  snapshots from PR37 and PR38; caller-supplied identities, grants or
  workspace roles are never accepted. The checks run afresh on each query.
- No new schema, shared content, owner-only document writes, editor/Yjs,
  API resource route, MCP, search, export, notifications or migrations.

## Feature gates

All **OFF** unless independently enabled by an operator:

- `MAX_V2_SHARE_ACCESS_PREFLIGHT_READS_ENABLED=true` for both previews.
- `MAX_V2_EXTERNAL_SHARES_READS_ENABLED=true` additionally for external
  candidate preview.
- `MAX_V2_LINK_POLICIES_READS_ENABLED=true` additionally for member-link
  candidate preview.

**No production flags are changed by this PR.** Existing PR37/PR38 writes
continue to require their own separate flags. No public URL or token issuance.

## Critical security boundary

The boolean means **only** that a candidate proposal/policy satisfies the
shadow *eligibility* conditions at the instant checked. It must not be passed
as a capability, cached as authorization, or used to fetch even a title.
In particular, acceptance of a guest/cross-workspace proposal does **not**
give the recipient access to the source tenant's actual document. Member-link
preflight adds no permission beyond the caller's preexisting page ACL.

A future live gateway, if independently approved, must perform authorization
**inside the actual resource handler** on every content/media/search/export
operation, not by trusting the response from these queries. It must:
1. Define separate permissions for guest, cross-tenant and anonymous actors,
   no implicit tenant membership, and explicit document-to-scope binding.
2. Verify cryptographically random bearer credentials or authenticated
   possession proofs, with hash-only storage, collision checks, key rotation,
   safe revocation and fixed-time comparison where appropriate.
3. Revalidate the scope, resource owner, permission inheritance, token
   audience, revocation and expiry at use time; cover documents, embedded
   assets, comments, histories, downloads, search, backlinks, MCP and caches.
4. Resolve public passcode, anti-enumeration, rate-limit, abuse and CSRF
   policies; apply appropriate security/non-indexing/cache-control headers.
5. Define consistency and immediate revocation behavior for long-running
   sessions, realtime transports, and media URLs.
6. Undergo independent threat modeling and genuine multi-account testing
   **before** any content/public endpoint or feature-flag activation.

## Verification

- [x] Pure domain regression tests cover acceptance, exact identity,
  tenant isolation, revoked/suspended memberships, issuer revocation,
  no source membership, fresh page ACLs and inherited explicit denies,
  policy audience, terminal revocation, malformed/duplicate rows,
  scope collisions, expiry boundaries, invalid clocks, storage errors,
  and metadata-free booleans.
- [ ] Exact-head GitHub Actions lint, root + Convex TypeScript, Vitest,
  backups/recovery, production build, provider and browser tests.
- [ ] Independent security review, including the fact that these booleans
  are *not* permission grants.
- [ ] Genuine Clerk/Convex multi-account and revocation race drills.
- [ ] Isolated cloud restoration with asset hashes; privacy/retention review.
- [ ] Accessibility and Arabic/RTL keyboard/screen-reader verification,
  performance/load and abuse measurement.
- [ ] Predecessor drafts, issue #42 baseline reconciliation and release gate.

## Rollback

Leave `MAX_V2_SHARE_ACCESS_PREFLIGHT_READS_ENABLED` unset/false. There are
no schema migrations or user-facing resource operations to reverse. Draft
remains unmerged and not production-ready until the above gates are met.
