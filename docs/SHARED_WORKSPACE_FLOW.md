# Shared workspace flow

The first collaboration flow is implemented behind configured Clerk and Convex accounts. Open **Workspaces** in the personal sidebar, create a workspace, and create a page. New root pages are private to their creator. Joining a workspace alone does not expose them.

Workspace owners and admins can create an email-bound invitation link in **People**. Share that link manually with the intended recipient. Max does not send an email. Acceptance requires the invited email to be verified in the signed identity; links expire and cannot be reused.

Use **Page access** to give a member View, Comment, Edit content, Edit or Full access. Comment is a permission level; comments themselves are not implemented in this slice. Edit content allows document changes but not page renaming. An explicit grant can be removed, while inherited access may still apply. Removing a workspace member blocks subsequent page reads and writes even when an old page grant still names them.

The shared editor uses the existing Max block schema. Saves carry a base revision. A stale save preserves the local branch and asks the user to review the latest version; this is not simultaneous character merging. Drafts are scoped by actor, workspace and page. Access loss hides the document and quarantines its draft. Account changes also discard the rendered session and require matching actor identities on fresh query results.

**Page history** lists earlier revisions in small pages and previews their text. Users with Edit or Full access can restore a revision. Restore keeps the current title, retains the replaced content in history, and rejects a stale base revision. Content-only editors can preview history but cannot restore it. Locked pages cannot be restored. Up to 100 saved revisions are retained. The preview shows text; restoring preserves the saved blocks and formatting.

Shared attachments, databases, presence and comments remain outside this flow. Their editor actions explicitly report their availability. Personal Max remains independently usable in local mode.

## Verification

`tests/unit/sharedJourney.test.ts` runs the public registered backend functions through workspace creation, invitation, verified acceptance, private-page access, permission changes, both-account edits, stale revision conflict and membership revocation. It does not seed workspace membership. Additional native tests cover expiry, scope isolation and transaction rollback.

With shared history included, the production build and complete check suite pass 488 unit cases, 24 backup cases and four cloud archive cases. Before the history addition, all 38 desktop/mobile browser regressions passed and all 48 editor corpus tiles had zero changed pixels. The anonymous local verifier compiles and pushes the functions and verifies actual 50 MiB uploads. Browser tests cover personal navigation into the local setup screen and return to personal Max. The live signed-in shared history UI and real Clerk deployment remain unverified.

## Remaining live check

Use a disposable cloud development deployment with its matching Clerk JWT issuer configured. Sign in as two verified accounts in separate browser profiles. Create the workspace and private page as the owner, invite the second account, accept, grant editing, save from each profile, provoke a stale edit, and revoke the second account while its page is open. Confirm the document disappears and a further save is denied. Also switch accounts in the same browser and confirm no previous account's title or content appears.

This checkout currently has an anonymous local verification backend, not a configured cloud app and Clerk pair. The live two-account browser gate remains open. No production deployment or personal-to-shared migration is authorized by these test results.
