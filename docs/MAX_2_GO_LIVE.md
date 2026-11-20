# Max 2.0: turning on shared features

Max 2.0 ships with every shared-workspace capability switched off. This runbook turns them on in production, in order. Run the commands from your laptop in the Max repository, signed in to Convex (`npx convex login`) and Vercel (`npx vercel login`).

## Sharing pages: no flags needed

Notion-style page sharing works in Max itself once the backend is deployed (step 1 below). Open any page, choose **Share** in the top bar, and:

- invite people by email with **Full access**, **Can edit**, **Can comment** or **Can view** (they need a Max account; sub-pages are shared too);
- change or remove someone's access from the same list;
- set **General access** to "Anyone in Max with the link" (view, comment or edit), or "Anyone on the web with the link" to publish it read-only at `/s/…` for people without an account, and copy the link.

People you share with find the page under **Shared** in their sidebar, see who else has it open, and comment with their name. Shared pages are edited live: everyone types in the same page at once and sees each other's named cursors, and Max saves the merged page every second or so. If an assistant or a history restore changes the page meanwhile, everyone's editor reloads with the new content. Anyone a page is shared with (or who has a published link) can **Duplicate** it into their own workspace. Only you (or people with full access) can change sharing. Assistants connected over MCP can too, with `shares_list`, `shares_inviteByEmail`, `shares_update`, `shares_remove` and `shares_setLink`. For names and pictures to appear, the Convex JWT template in Clerk should include `name` and `picture` (Clerk's Convex template does by default).

## Admin dashboard

Max's admins get an **Admin** link in the sidebar (`/admin`): everyone's accounts with how they use Max, suspending (read-only) or banning (no access, published sites go offline) with a reason the person sees, and the inbox of problems reported from the app ("Report a problem") and from published pages and sites ("Report this page"). Admins are listed by sign-in email in Convex:

```bash
npx convex env set MAX_ADMIN_EMAILS you@example.com --prod
```

Separate several with commas. In local mode, whoever runs the server is the admin.

## Websites from pages

Share → Publish on any page publishes it with everything inside it at `max.chaos.fail/site/<address>`. Nothing to set up.

(Optional, later: for `<address>.max.chaos.fail`, add the wildcard domain `*.max.chaos.fail` in Vercel and set `SITES_DOMAIN=max.chaos.fail`.)

## Personal workspaces

The workspace menu (top of the sidebar) creates extra private workspaces, each with its own pages, databases, files, sidebar and colors. They're stored on the account's settings row and in their own data namespace, so `npx convex deploy` is all they need. Suspending or banning an account covers all of its workspaces.

## Images on Cloudflare R2 (optional)

Uploads go straight from the browser to R2 with short-lived signed links (files never pass through Max's servers) and are read through signed links, so private pages stay private. Without these settings, files stay in Convex storage.

1. Cloudflare dashboard → R2 → enable R2, then create a bucket (for example `max-files`).
2. R2 → Manage API tokens → create a token with Object Read & Write on that bucket. Note the Access Key ID, Secret Access Key and your Account ID.
3. Bucket → Settings → CORS policy:

```json
[{ "AllowedOrigins": ["https://max.chaos.fail"], "AllowedMethods": ["GET", "PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
```

4. In Convex (production):

```bash
npx convex env set R2_ACCOUNT_ID <account id> --prod
npx convex env set R2_ACCESS_KEY_ID <access key id> --prod
npx convex env set R2_SECRET_ACCESS_KEY <secret access key> --prod
npx convex env set R2_BUCKET max-files --prod
```

Existing files stay where they are and keep working.

## Usernames and invite links

Everyone gets a username from their name at sign-in (omar, then omar2…), changeable in Settings → My account. `max.chaos.fail/<username>` is their invitation: their card, "Omar invited you", and a preview image naming them. Shared page links preview as the page (title and who shared it). Nothing to configure; `npx convex deploy` adds the `usernames` table.

## Assistants (MCP and WebMCP)

One token reaches all of a person's workspaces: tools take an optional `workspace` (id or name), and `workspaces_list` lists them. In browsers that support WebMCP (`navigator.modelContext`), Max also offers its tools to the browser's agent while the app is open: search, open, read, create pages, switch workspaces, and run any operation, as the signed-in person.

## The note on the back of membership cards

New members who weren't invited get a handwritten note from Max's maker. Write it in your own words, and sign it, in `lib/welcomeNote.ts`.

The rest of this runbook is about the separate Max 2.0 *workspace* features (teams, members, shared databases, automations), which stay behind flags.

## What you get today

Turning the flags on enables the **shared-workspace backend** (workspaces, members, invitations, page sharing, shared databases, tasks, wiki, links, automations, meeting notes) and the **workspace switcher** in the sidebar with a preview page per workspace. The app does not yet have screens for creating workspaces or managing members: you create and manage workspaces with the `npx convex run` commands below. Page sharing (above) does not need any of this. Personal pages, the editor and the MCP server keep working as before.

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
