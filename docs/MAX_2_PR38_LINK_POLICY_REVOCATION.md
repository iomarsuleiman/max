# Max 2.0 — PR38/44: Expiring Link Policies & Revocation

**Status:** experimental, draft, not merged, not deployed. This feature is a
**management-only policy registry**, not live link sharing. Stack on PR37 (#67).
Neither `main` nor `max-2.0` is changed by creating this PR.

## Scope and intended behavior

- Isolated `workspaceLinkPolicies` shadow table for **registered** workspace page scopes.
- A currently authenticated Clerk identity with **current manage permission**
  can create, inspect, update, revoke or revoke all policies for that scope.
- Two future audience intents: `workspace_members` and `anyone_with_link`.
  The latter is a policy label only; it is **not public publishing**.
- Each policy expires no later than 30 days after **original creation**.
  An update cannot extend that absolute lifetime. Revocation is terminal.
- Server-side source ACL and unique global scope are checked for every read
  or mutation. If the original issuer loses manage access, the policy is
  marked `issuer_revoked` to current managers (and may be revoked).
- Manager responses contain only policy ID, audience, state, expiry and
  revision. No issuer identity, document title/body, assets, recipient
  directory, workspace metadata or secret.
- Maximum 32 lifetime policy rows per scope. Listing and revoke-all fail
  closed rather than partially operating when the cap is exceeded.
- Mutations append `workspaceSecurityEvents`. Updates and individual
  revokes enforce timestamp compare-and-set. Revoke-all applies atomically
  within one Convex transaction, without a public-facing race window.

## Deliberate omissions

**No bearer token is generated or stored.** The returned Convex ID is NOT a
share URL or capability; do not put it into public-facing UI. There is no
anonymous query, share dialog, passcode storage, search indexing, published
article, download, asset gateway, document/Yjs read, MCP scope expansion,
or privilege grant. No legacy personal note is made public.

The future PR39 resource/public-link gateway must be independently reviewed
and verify tokens server-side, apply rate limits and non-indexing headers,
authenticate or passcode-gate audiences as appropriate, recheck current ACLs
and expiration on **every** access (including media), ensure no leakage
through search/embeds/backlinks, and handle revocation of live sessions.

## Operator gates and rollback

All three must explicitly be `true` before mutations can run:

- `MAX_V2_WORKSPACE_WRITES_ENABLED`
- `MAX_V2_LINK_POLICIES_WRITES_ENABLED`
- Reader uses separate `MAX_V2_LINK_POLICIES_READS_ENABLED`

New flags are **OFF by default**, and nothing here switches them on.
Disable flags to stop policy management; rollback by abandoning this draft
without touching production pages. Do not drop the shadow table until
retention/backup obligations have been reviewed.

## Security and QA checklist

- [x] Pure domain regression tests for scope owner and reader authorization,
  wrong tenant, duplicate scopes, expiry boundary, issuer revocation,
  malformed row/status, duplicate ID, row ceiling, backend errors,
  output allowlists and monotonic revisions.
- [ ] GitHub exact-head lint, root + Convex TypeScript, Vitest, backup
  recovery, production build, Chromium + WebKit and browser-lab CI.
- [ ] Independent security review of mutation handlers and audit privacy.
- [ ] Authenticated multi-account Clerk/Convex testing with actual tenant
  revocation, simultaneous edits and revoke-all.
- [ ] Isolated cloud backup/restore proof with attachment checksum coverage.
- [ ] Arabic/RTL accessibility and keyboard/touch/screen reader review.
- [ ] Query-volume budget and targeted load/abuse tests.
- [ ] Baseline issue #42 reconciliation and predecessor draft approvals.
- [ ] External gateway and anonymous access threat model before any exposure.

**No merge or production enablement is authorized by green CI alone.**
