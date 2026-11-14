# Workspace lifecycle and storage

The workspace service implements personal and organization workspaces,
membership changes, invitation acceptance, groups and teamspaces. The app and
MCP still use the existing personal content dispatcher. No public collaboration
endpoint or production migration is enabled by this implementation.

The existing UI/MCP personal dispatcher and Notion import worker now use a
personal-only database facade. A creator's `ownerId` cannot expose an
organization-tagged page, its untagged descendants, documents, comments,
versions or attachment records. The native adapter resolves the canonical
personal workspace inside the same transaction. Local mode accepts legacy
unscoped personal content only. Neither path grants shared access.

Legacy cached responses are refused when the account contains shared or
unresolved content, because those receipts have no workspace authorization
provenance. Account deletion also refuses that mixed state before removing
rows or files. Orphan rows remain available to raw backup/recovery tooling.
Personal deletion removes attachment records before pages and pages before
their ancestors. These checks cannot prove exclusive blob ownership across
accounts or revoke a previously delivered public storage URL.

## Service boundary

`WorkspaceService` receives an adapter-resolved account and optional verified
email. Resource IDs come from requests; roles, membership and authority come
from fresh storage reads inside each transaction. An email in a request cannot
establish identity. Personal ownership is immutable, and repeated initialization
reuses the same persisted personal workspace.

Organization creation commits its owner membership and audit event together.
Member changes protect the last owner and prevent admins from modifying owners
or granting ownership. Revocation removes active group and direct teamspace
admission. Losing invitation authority atomically revokes outstanding unexpired
invitations, so old tokens cannot become valid after the issuer is promoted again.

Invitations contain a 256-bit random token returned once to the creating caller.
Only its SHA-256 hash is persisted in the invitation. Acceptance requires the
recipient's provider-verified email, a pending unexpired token and an issuer who
still has membership-management authority. Acceptance is single-use and never
upgrades an already-active member's role. No email or other message is sent.

Teamspace stewardship is explicit. A workspace admin outside a private teamspace
cannot manage it merely through workspace role, or add people to a group that
would cross that boundary. Membership activation checks every closed/private
teamspace referring to the group. Removing admission remains possible.
An orphaned teamspace can be recovered only by a workspace owner, only when no
active non-guest manager remains, and with a separate audit event. This deliberate
recovery changes admission; it is not an implicit read bypass.

Private page grants now have a canonical native ACL adapter. It resolves legacy
personal ownership or explicit workspace scope and composes fresh membership,
group, teamspace and ancestor policy reads in the same transaction. A versioned
header and canonical indexed grant rows supply both policy reads and reverse
lookups. Group changes and archival require sharing authority on every affected
page. Rejoining and Guest downgrades also check denies that would otherwise be
removed. Teamspace admission through groups requires its manager, including an
open teamspace when the target is a Guest. No public governance gateway is enabled.

## Convex adapter

The schema uses nine `collab*` tables and explicit indexes. Portable
logical IDs remain separate from Convex's native `_id`. Workspace/group/teamspace
IDs, personal owners, membership composites and invitation hashes are checked
for uniqueness through indexed reads in the same native transaction as writes.
Contradictory duplicates fail closed rather than selecting a role arbitrarily.

List methods read at most the supported limit plus one and throw on overflow.
They never truncate membership lists used to protect owners. Active user/group
membership uses a state index, so archived-group history cannot prevent member
revocation. Each active entry's composite key is also checked for a contradictory
revoked duplicate. No unbounded collection or table scan is used in this adapter.

The `CollaborationStore.transaction` callback must execute inside one outer
Convex mutation or query. Convex supplies rollback and optimistic concurrency.
Do not catch a service failure and commit its partial outer transaction, or split
one callback across separate mutations. Read-only contexts reject writes.
The storage adapter is internal infrastructure, not an authorization gateway.

The default WebCrypto runtime is suitable for Node/local use. A native Convex
gateway must obtain token entropy and logical IDs in a trusted action, inject a
deterministic runtime into its internal mutation, and recheck identity and
membership there. Client bodies must never choose the runtime or identity.
Idempotency, current verified email, public result validators and UI/MCP parity
must be supplied by that gateway before public tools are registered.

## Repeatable checks

```powershell
pnpm exec vitest run tests/unit/workspaces.test.ts tests/unit/convexCollaborationStore.test.ts tests/unit/operationRequirements.test.ts
pnpm proof:convex-local
```

The first command exercises the real service, native Convex schema/adapter,
rollback, invitations, owner protection, private-group admission, duplicate
metadata, bounded reads and accumulated group history. The operation manifest
also requires classification of every existing UI/MCP action and denies unknown
names. A classification itself never grants access.

The local proof requires the ignored `.env.convex-verification.local` selecting
an anonymous local backend and refuses an existing `.env.local`. It strips
inherited deployment-key/self-hosted overrides, enables TypeScript checks,
pushes only to that anonymous local deployment, and runs the internal read-only
`collaborationChecks:probeStorage` query against twenty-three index paths. The CLI's
generated verification env is preserved in a new private OS temporary directory,
then removed from the app workspace so it cannot silently switch the next build.
The probe returns no member, invitation or content data and is not public.

These checks do not certify a live Clerk gateway, content backfill, public shared
page operations, immediate subscription revocation, collaborative editing or
production rollout. Existing personal pages and canonical document storage
remain unchanged.
