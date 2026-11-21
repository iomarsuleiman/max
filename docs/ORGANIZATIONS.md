# Organizations

Shared workspaces for a company or team, next to everyone's private personal workspaces. This implements phases 0–4 of the *Max Business & Organization Roadmap* (Collaboration 2.0, page 17) and the parts of phase 8 that apply to them.

## Design decision: an organization is a namespace

Every row in Max carries an `ownerId`, and every operation is scoped to it. Personal workspaces are `<account>` and `<account>~<id>`. An organization is **`org_<10 chars>`**. Its pages, databases, files, history, comments, live rooms and published sites carry that ownerId.

As a result, the editor, databases, search, graph, files, version history, import/export and MCP need no changes and **cannot** reach across organizations, because the same ownership checks that keep personal data apart also keep organizations apart. There's no second permission system to drift.

Who may act inside the namespace is decided in one place, on the server, from verified identity:

| Where | What it decides |
| --- | --- |
| `lib/domain/workspaces.ts` `resolveScope` | `ws=org_…` resolves only for an **active, non-guest member** of an existing organization. Anyone else gets the same "missing workspace" answer as a deleted org, so its existence doesn't leak. |
| `lib/domain/ops/orgGate.ts` | Runs before **every** operation, and before every item in a `batch`, for the UI, local mode and MCP alike: role checks, organization policies, and re-scoping account-level operations (tokens, profile card, personal workspaces) to the caller's own account. `account.deleteAllData` is refused inside an organization. |
| `lib/domain/sharing.ts` `resolveAccess` | The single access function for shared pages and live co-editing. Members reach the org's pages like owners (live editing, presence, comments). Guests reach only pages explicitly shared with them. |
| `lib/domain/organizations.ts` | Membership, invitations, teams, ownership, audit. |

Membership is read again on every request, so removing or suspending someone takes effect on their next call: editor saves, live-room pushes, file links, search and MCP included.

The earlier `workspace*` shadow tables (PR03–PR44) were authorization prototypes whose writers are switched off in every deployment (`MAX_V2_WORKSPACE_WRITES_ENABLED`), so they hold no production data. They stay untouched. The organization tables (`orgs`, `orgMembers`, `orgInvites`, `orgTeams`, `orgEvents`) follow Max's `ownerId` contract instead, so the same domain code runs on Convex, in local mode and in tests. The shadow model's rule `retainsWorkspaceOwner` is reused for the last-owner check.

## Roles

| | Owner | Admin | Member | Guest |
| --- | :-: | :-: | :-: | :-: |
| Open the organization, read and edit its pages and databases | ✓ | ✓ | ✓ | — |
| Pages shared with them by people in the organization | ✓ | ✓ | ✓ | ✓ |
| Invite members | ✓ | ✓ | if *Members can invite* | — |
| Invite admins, make someone an admin | ✓ | — | — | — |
| Change roles, suspend or remove members and guests | ✓ | ✓ (not admins) | — | — |
| Teams, policies, name, audit log | ✓ | ✓ | read teams | — |
| Empty trash, delete permanently, export everything, publish sites, pin favorites for everyone | ✓ | ✓ | — | — |
| Transfer ownership, delete the organization | ✓ | — | — | — |

There's exactly one owner. Ownership changes only through a transfer (the owner types the organization's name, and the old owner becomes an admin) or a platform admin's recorded recovery.

## Invitations

Invitations are bound to an email address and expire after 14 days. Only someone signed in with that **verified** email sees and can accept one (Clerk's `email_verified`). Nothing in a link grants access. Pending, accepted, declined, revoked and expired invitations stay in the history. Admins can resend (renew) or revoke them. Whoever sent one can also revoke it.

## Policies (per organization)

- **Members can invite members** (off by default)
- **Share pages outside the organization** (on): page shares with non-members and "anyone in Max with the link"
- **Publish pages to the web** (off): public `/s/…` links
- **Publish websites** (off; admins only)

They're enforced in `orgGate` for members and for page guests with full access.

## Platform admin (`/admin`)

Extends the existing dashboard; there's no second admin.

- **Overview**: people, active, new, organizations, active organizations, members, pending invitations, sites, standing, open reports, failed operations this week, and 8-week signup and organization trends.
- **Users**: server-side search and pagination (usage is computed only for the visible page instead of for everyone). Open a person to see their organizations and roles, invitations and history.
- **Organizations**: directory with owner, members, admins, guests, invitations, limit and standing. The detail view shows members with teams, invitation history, teamspaces and teams, usage counts and storage, and the audit trail. Actions: **make read-only**, **lock**, **restore**, **recover ownership**, **member limit**, **remove member**, **delete** (typed name and a reason). Every action is recorded in the platform audit trail and, where it applies, in the organization's own log.
- **Audit**: everything across Max, filterable by scope, action and actor.

Platform roles are separate from organization roles: `MAX_ADMIN_EMAILS` may act and `MAX_SUPPORT_EMAILS` may only look. **Page contents are never shown.** Teamspace names (the organization's structure) and counts are shown.

## Rollout and rollback

- On once deployed. `MAX_ORGANIZATIONS=off` (Convex env) hides organizations everywhere: requests to `org_…` fail closed and the UI disappears. No data is changed, and turning it back on restores everything.
- Schema changes are additive (new tables, one optional settings field). Existing personal data, IDs and URLs are unchanged.
- Local mode works too (`/api/local/organizations`). With `MAX_LOCAL_MULTIUSER=true`, each pretend account has the verified email `<id>@local.max`.

## Not in this release (roadmap phases 5–7)

Still open: per-page restrictions *inside* an organization (private teamspaces), person-typed task assignment, the notification inbox beyond invitations, email delivery of invitations, approvals and automations, and Clerk step-up ("fresh") authentication for ownership transfer. Today a transfer requires typing the organization's name. Org favorites and "recently opened" are shared by the organization's members.
