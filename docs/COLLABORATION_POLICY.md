# Collaboration permission contract

`lib/domain/collaboration/policy.ts` defines a pure policy evaluator and compound
checks for moves, copies and membership changes. It is groundwork for phase 03.
It does not change the existing single-owner dispatcher, persist memberships,
enable sharing, validate a cloud migration or satisfy the rollout gates in
[the collaboration ADR](adr/0001-collaboration-boundaries.md).

## Server contract

An adapter must resolve the authenticated account and load the workspace,
membership, group memberships, teamspaces and complete page ancestry from
authoritative storage. A workspace ID is a resource selector, never proof of
membership. Do not accept a policy snapshot, role, grant or group list from a
client. Validate external rows before constructing the typed snapshot.

Every evaluation requires active membership in an active workspace. Revoked,
missing, mismatched or foreign memberships fail closed, including when a page
still contains a matching full-access grant. Personal workspaces admit only
the account recorded in their immutable owner field, require its owner membership,
and cannot contain teamspaces. The evaluator retains no cache.

Missing pages, unauthorized pages and invalid ancestry all return the same
denial shape. Missing ancestors, cross-workspace ancestry, duplicate page IDs,
cycles, more than 100 ancestors and inconsistent teamspace IDs fail closed
before evaluating grants. The product's existing nesting limit remains 40.

Use a fresh snapshot in the same transaction as a write. A pure function cannot
detect a revocation that its caller omits. Read adapters must re-evaluate access
when permissions change, unsubscribe or redact old results, and recheck access
before returning asset URLs or delivering notifications. Existing UI/MCP and
Convex pathways have not yet been migrated to this contract.

## Page capability matrix

Each grant includes the capabilities of the grants above it.

| Grant        | Additional capabilities                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| View         | Read content and export the readable page                                                      |
| Comment      | Add comments                                                                                   |
| Edit content | Edit document content and database record values                                               |
| Edit         | Edit page metadata, create children, archive/restore, edit database schema and restore history |
| Full access  | Manage page sharing and move the page                                                          |

Moving changes inherited access, so its source requires full access. The
destination must permit creating children. A separate move check validates both
ancestries, rejects self/descendant cycles and refuses cross-teamspace moves.
Cross-workspace or cross-teamspace transfers need their own reviewed copy and
permission mapping contract. They are not authorized by a move capability.

The copy check requires source read and destination child-creation access.
For a recursive copy or export, operations must also filter or reject every
included descendant, relation target and attachment. Permission to read one
page never proves permission to read its entire subtree. This helper does not
authorize recursive reads by itself.

Assets, previews, search, counts, graph edges, backlinks, history, embeds and
exports must use their associated page's capability. Resolve both endpoints
before emitting links or graph edges. Restrict record edits to values when a
caller has edit-content access; schema changes require edit access. Additional
locks, archive state, validation and write limits remain operation invariants.

## Grant precedence

1. Require active workspace membership and valid complete ancestry.
2. Require teamspace admission where applicable.
3. Start a personal owner's access at full. Organization pages outside a
   teamspace start with no access, including for owners and admins. Admitted
   non-guest teamspace members start with the configured teamspace default.
4. Walk from the root to the requested page. An `inherit` policy retains the
   current grant. A `replace` policy clears it, creating a restricted subtree.
5. At each page, matching allow grants combine by greatest capability. A lower
   allow does not reduce an inherited grant. To reduce access, use `replace`.
6. A matching deny at any ancestor or the target blocks that entire subtree.
   A child allow or replace cannot override it. Remove or change the ancestor
   deny to restore access. Denies have no expiry in this initial contract.
7. Allow grants expire when `expiresAt <= now`. A null expiry means no expiry;
   nonfinite expiry and nonfinite clocks fail closed.

Direct user grants match the authenticated account. Group grants match only
active memberships for that account in the current workspace. A conflicting
revoked membership wins over an active group row. Workspace-member grants
exclude guests. Guests can receive direct or group page grants but remain
subject to workspace and teamspace membership.

For example, an inherited edit grant stays edit when a child adds a view grant.
A child with `replace` and a view grant becomes view-only. An explicit deny on
the ancestor still denies both versions of that child.

## Teamspaces and workspace roles

Open teamspaces admit active owners, admins and members. Closed and private
teamspaces require explicit user membership or membership through an active
workspace group. Neither owner nor admin bypasses those content boundaries.
All pages in an ancestry must have the same teamspace ID. Private and closed
teamspaces share the same content admission check; discovery rules must also
hide private teamspace metadata from nonmembers in the future adapter.

Guests require explicit teamspace admission even in an open teamspace and also
need a page grant. Teamspace membership alone gives them no default content
access. Missing, duplicate or foreign teamspace records deny access.

| Workspace role | Governance                                       |
| -------------- | ------------------------------------------------ |
| Owner          | Settings, members, groups and workspace deletion |
| Admin          | Settings, members and groups                     |
| Member         | No workspace governance                          |
| Guest          | No workspace governance                          |

Governance is separate from content. An admin cannot read a private page merely
because they can manage workspace settings. Admins cannot change an existing
owner or grant ownership. Owners may do so, but a removal/demotion must leave
another active, distinct owner in the same workspace. Revoked and foreign
owners do not count. Duplicate member rows or a stale actor membership deny the
change. The membership helper requires a complete, fresh member list and must
run inside the membership write transaction. Creating a new workspace and
invitations are separate operations that this helper does not implement.

Personal workspace ownership is fixed to its account. Its owner can manage
settings or delete the workspace, but cannot manage memberships or groups.

## Verification and remaining rollout work

`tests/unit/collaborationPolicy.test.ts` covers every grant/capability pair,
roles, inheritance, restricted subtrees, sticky denies, guests, groups,
expiration, revocation, malformed/cyclic/foreign ancestry, teamspace admission,
compound moves/copies and last-owner protection. These are real calls to the
pure evaluator, with no mocked policy implementation.

Before enabling shared storage, implement and test authenticated snapshot
construction, policy mutation authority, audit events, per-recipient discovery
and notification filtering, subscription invalidation, asset revocation,
cross-workspace transfer handling and the full UI/MCP parity matrix. Pure policy
tests alone do not certify immediate revocation, query safety or multi-client
collaboration.
