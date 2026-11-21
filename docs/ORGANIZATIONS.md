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

- **Off for every account by default.** A platform admin switches organizations on per person in Admin → Users (the Organizations switch, also `admin.setOrganizations`). Once on, that person can create organizations, invite people and use everything. People who were invited can join and work in an organization without the switch; only creating one needs it. Turning it off stops new organizations; existing ones keep working.
- `MAX_ORGANIZATIONS=off` (Convex env) hides organizations everywhere: requests to `org_…` fail closed and the UI disappears. No data is changed, and turning it back on restores everything.
- Schema changes are additive (new tables, one optional settings field). Existing personal data, IDs and URLs are unchanged.
- Local mode works too (`/api/local/organizations`). With `MAX_LOCAL_MULTIUSER=true`, each pretend account has the verified email `<id>@local.max`.

## Also in this release

| Area | Where it lives |
| --- | --- |
| Private pages, closed and private teamspaces, view/comment-only for others | `lib/domain/orgPageAccess.ts` (`restrictedDb` wraps the request's database so every operation is filtered) |
| Owner security phrase (PBKDF2, lockout), instead of a password re-prompt | `lib/domain/organizations.ts` |
| Inbox: mentions, replies, assignments, reviews, access requests, membership, automations, announcements, due-date reminders, per-kind preferences | `lib/domain/notifications.ts`, `lib/domain/reminders.ts`, `ops/inbox.ts` |
| Comment threads, reactions, @mentions | `ops/comments.ts` |
| Reviews (every reviewer approves; no self-approval) and suggested edits (accepted as a new version) | `ops/approvals.ts` |
| Person property, assignment notifications, offboarding reassignment | `ops/databases.ts`, `ops/recordHooks.ts`, `organizations.ts` |
| Automations (created / changed / button / schedule), bounded, non-cascading, run counts | `ops/recordHooks.ts`, `ops/automations.ts`, `convex/crons.ts` |
| Forms that create rows | `components/database/FormView.tsx` |
| Synced pages (live, read-only, edited at the source) | `SyncedBlock` in `components/editor/blocks.tsx` |
| Wiki verification, activity, analytics (workload, pending reviews) | `ops/insights.ts` |
| Expiring share links | `ops/shares.ts`, `sharing.ts` |
| Retention (trash, history) and verified-domain auto-join | `retention.ts`, `organizations.ts` |
| Connectors: scoped app tokens, OAuth code flow, REST API `/api/v1/ops`, signed webhooks (SSRF-safe, retried), marketplace with admin review | `lib/domain/integrations.ts`, `convex/integrations.ts`, `app/api/v1` |
| Public guides | `/docs` (`lib/docs.ts`) |

## Still outside Max

- **Email.** Invitations and notifications appear in Max (sidebar card, inbox). Max has no email provider yet, so nothing is emailed.
- **Enterprise SSO/SCIM.** SAML/OIDC is configured in Clerk (Enterprise connections). Verified-domain auto-join covers automatic enrollment.
- **Gmail, Google Calendar and other third-party connectors** need their providers' OAuth credentials. The connector platform (API, OAuth, webhooks, marketplace) is ready for them to be built as apps.
