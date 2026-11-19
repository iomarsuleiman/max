# Max 2.0: turning on shared features

Max 2.0 ships with every shared-workspace capability switched off. This runbook turns them on in production, in order. Run the commands from your laptop in the Max repository, signed in to Convex (`npx convex login`) and Vercel (`npx vercel login`).

## What you get today

Turning the flags on enables the **shared-workspace backend** (workspaces, members, invitations, page sharing, shared databases, tasks, wiki, links, automations, meeting notes) and the **workspace switcher** in the sidebar with a preview page per workspace. The app does not yet have screens for creating workspaces, inviting people, sharing pages or co-editing: you create and manage workspaces with the `npx convex run` commands below until those screens are built. Personal pages, the editor and the MCP server keep working as before.

## 1. Deploy the backend

```bash
pnpm install
```

```bash
npx convex deploy
```

The schema changes only add tables; existing data is untouched.

## 2. Turn the server flags on (Convex production)

Enable an area's reads before its writes. Each line is one command.

```bash
npx convex env set MAX_V2_NAVIGATION_PREVIEW_ENABLED true --prod
npx convex env set MAX_V2_WORKSPACE_WRITES_ENABLED true --prod
npx convex env set MAX_V2_SHARED_DATABASE_READS_ENABLED true --prod
npx convex env set MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED true --prod
npx convex env set MAX_V2_WORKSPACE_RECORD_SEMANTICS_READS_ENABLED true --prod
npx convex env set MAX_V2_WORKSPACE_RECORD_SEMANTICS_WRITES_ENABLED true --prod
npx convex env set MAX_V2_TASK_RELATIONS_READS_ENABLED true --prod
npx convex env set MAX_V2_TASK_RELATIONS_WRITES_ENABLED true --prod
npx convex env set MAX_V2_TASK_VIEWS_READS_ENABLED true --prod
npx convex env set MAX_V2_WIKI_GOVERNANCE_READS_ENABLED true --prod
npx convex env set MAX_V2_WIKI_GOVERNANCE_WRITES_ENABLED true --prod
npx convex env set MAX_V2_EXTERNAL_SHARES_READS_ENABLED true --prod
npx convex env set MAX_V2_EXTERNAL_SHARES_WRITES_ENABLED true --prod
npx convex env set MAX_V2_LINK_POLICIES_READS_ENABLED true --prod
npx convex env set MAX_V2_LINK_POLICIES_WRITES_ENABLED true --prod
npx convex env set MAX_V2_SHARE_ACCESS_PREFLIGHT_READS_ENABLED true --prod
npx convex env set MAX_V2_MEETING_NOTES_READS_ENABLED true --prod
npx convex env set MAX_V2_MEETING_NOTES_WRITES_ENABLED true --prod
npx convex env set MAX_V2_MEETING_REPORT_PACK_READS_ENABLED true --prod
npx convex env set MAX_V2_AUTOMATION_RULES_READS_ENABLED true --prod
npx convex env set MAX_V2_AUTOMATION_RULES_WRITES_ENABLED true --prod
npx convex env set MAX_V2_AUTOMATION_RUN_INTENTS_READS_ENABLED true --prod
npx convex env set MAX_V2_AUTOMATION_RUN_INTENTS_WRITES_ENABLED true --prod
```

Dependencies the code enforces: shared-database writes also need `MAX_V2_WORKSPACE_WRITES_ENABLED`; record semantics, tasks, wiki, meeting notes and automations also need `MAX_V2_SHARED_DATABASE_READS_ENABLED`. Automation rules only dry-run; nothing runs on a schedule or calls out.

Leave `MAX_V2_COLLAB_LAB_ENABLED` and `MAX_V2_PR17_PROVIDER_SANDBOX` off: they belong to test labs, not the product.

## 3. Show the workspace switcher (Vercel production)

Both variables are needed; the `NEXT_PUBLIC_` one is read at build time, so redeploy after setting it.

```bash
npx vercel env add MAX_V2_NAVIGATION_PREVIEW_ENABLED production
```

```bash
npx vercel env add NEXT_PUBLIC_MAX_V2_NAVIGATION_PREVIEW_ENABLED production
```

Enter `true` for each when prompted, then redeploy:

```bash
npx vercel --prod
```

## 4. Create a workspace and add people

Find your Clerk user id (Clerk dashboard → Users, it starts with `user_`). Workspace ids are 6–64 lowercase letters, digits and hyphens.

```bash
npx convex run workspaceManagement:createWorkspace '{"workspaceId":"my-team"}' --prod --identity '{"subject":"user_YOUR_ID"}'
```

Invite someone by their Clerk user id (roles: admin, member, guest):

```bash
npx convex run workspaceLifecycle:issueInvitation '{"workspaceId":"my-team","targetAccountId":"user_THEIR_ID","role":"member","ttlHours":72}' --prod --identity '{"subject":"user_YOUR_ID"}'
```

They accept with the invitation id that command prints:

```bash
npx convex run workspaceLifecycle:acceptInvitation '{"invitationId":"INVITATION_ID"}' --prod --identity '{"subject":"user_THEIR_ID"}'
```

The workspace then appears in both accounts' sidebar switcher.

## Turning it back off

Set any flag to `false` (or remove it) with the same commands; reads and writes stop immediately and no data is deleted. Remove the two Vercel variables and redeploy to hide the switcher.

```bash
npx convex env set MAX_V2_WORKSPACE_WRITES_ENABLED false --prod
```

## Still open before inviting real users

These release gates in [MAX_2_PR44_RELEASE_READINESS.md](MAX_2_PR44_RELEASE_READINESS.md) need real accounts, devices or people and were not verified: multi-account permission and revocation tests, an isolated cloud restore, an external security review, and phone/screen-reader checks.
