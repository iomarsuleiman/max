# Max 2.0 — PR37/44: Guest & Cross-Workspace Sharing Foundations

**Experimental / draft. Stacked on PR36 (#66).** No merge into `max-2.0` or `main`; no deployment.

## Explicit architecture boundary
This PR creates **identity-bound share proposals**, not cross-workspace read capabilities. Acceptance is consent to a future sharing flow; it does **not** grant access to the original page, wiki article, task, document, attachments, editor, MCP or realtime room. The registry points only at existing *shadow* workspace page scopes. A subsequent PR must build a content gateway with separate current per-resource authorization, data residency, export and revocation controls before actual sharing can work.

## What ships
- A new `workspaceExternalShares` Convex table: source workspace + shadow scope, a specific authenticated target account, optional **different** destination workspace, issuer, pending/accepted/declined/revoked lifecycle, 30-day maximum expiry and monotonic conflict revision.
- `guest` means an account-specific proposal **without** enrolling that account in a workspace. `cross_workspace` additionally requires an active, correctly owner-bound membership in the target workspace at issue, acceptance **and read** time.
- Source scope must be globally unique, registered to the origin workspace and currently **manageable** by the issuer. Access is revalidated on each recipient read and response. Role downgrade, revocation, source scope removal, disabled workspaces, target suspension and expiry fail closed.
- Creation capped to 64 proposals per registered scope; duplicate recipient + destination pairs are denied even when a previous proposal was revoked or declined. This avoids silent reactivation.
- Acceptance/decline allowed only for the verified target in pending status; revocation allowed for a current source manager. All mutations are transactional, revision-checked and emit security audit events.
- Target reads reveal only mode/status/expiry and own proposal ID. A shadow source scope reference is included **only** for accepted, unexpired proposals. There is no third-party identity, content, title, source scope ID for pending, public URL or token in responses.
- Feature gates are default **OFF**: `MAX_V2_WORKSPACE_WRITES_ENABLED` plus `MAX_V2_EXTERNAL_SHARES_WRITES_ENABLED` for mutations; `MAX_V2_EXTERNAL_SHARES_READS_ENABLED` for recipient inspection. Prior workspace access rules remain unchanged.

## Backend operations
- `workspaceExternalShares.issueExternalShare`: manager creates bounded, one-account proposal
- `workspaceExternalShares.readExternalShare`: owner-of-invitation status only
- `workspaceExternalShares.respondExternalShare`: account-bound accept/decline, CAS
- `workspaceExternalShares.revokeExternalShare`: source-manager revocation, CAS

## Testing / limits
`tests/unit/workspaceExternalSharePolicy.test.ts` covers identity boundaries, wrong tenant, role changes, target-workspace revocation, duplicate scopes and proposals, lifecycle/expiry, CAS, malformed records and offline stores. CI must independently confirm lint, both TypeScript checks, unit/backup tests, Next production build, provider probes and Chromium/WebKit E2E; no test is claimed passed until the corresponding job reports success.

**Required before enabling:** independent security review; real three-account Clerk/Convex issue/accept/revoke and racing tests; hardening share enumeration and audit retention; cloud backup and restore; privacy/security review of account-bound invitation metadata; Arabic/RTL and accessibility; actual content-read gating and explicit consent UI; and baseline branch reconciliation in issue #42.

**Rollback:** keep both flags OFF, close the unmerged draft. The new table is isolated and requires no changes to production content, existing personal databases, or currently deployed API behavior.
