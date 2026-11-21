/**
 * Max's public guides (/docs). Plain data, rendered by app/docs: each guide is a list of sections
 * with paragraphs, numbered steps, bullet lists or code. Keep them true to what Max does today.
 */
export type Block = { p: string } | { steps: string[] } | { list: string[] } | { code: string };
export interface Guide {
  slug: string;
  title: string;
  summary: string;
  group: "Start" | "Work together" | "Organizations" | "Publish and connect" | "Admin and security";
  sections: { h: string; body: Block[] }[];
}

export const GUIDES: Guide[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    summary: "Pages, sub-pages, the editor, databases and finding anything again.",
    group: "Start",
    sections: [
      { h: "Pages and the editor", body: [{ p: "Everything in Max is a page. Pages nest inside pages, and each one has a rich editor: type / for blocks (headings, to-dos, tables, callouts, code, math, diagrams and more), @ to link another page, and drag the ⋮⋮ handle to move blocks." }, { list: ["Your changes save as you type and are kept on this device if you go offline.", "Every page keeps a version history you can restore from (page menu → Page history).", "Trashed pages can be restored until the trash is emptied."] }] },
      { h: "Databases", body: [{ p: "A database is a page of rows with properties: text, numbers, selects, status, dates, checkboxes, people, relations, formulas and rollups. Show it as a table, board, list, gallery or calendar, with filters, sorts and saved views. Each row is a page of its own." }] },
      { h: "Find anything", body: [{ steps: ["Press ⌘K (Ctrl+K) to search titles and content.", "Type an action instead, like “New page”, “Open graph view” or “Go to Acme”, to run it.", "Open the graph view from the sidebar to see how pages link to each other."] }] },
      { h: "Workspaces", body: [{ p: "Keep separate areas of your life apart with personal workspaces, and work with others in organizations. Switch from the workspace menu at the top of the sidebar, the icons at its foot, ⌃1–9 (Alt+1–9 on Windows), or Shift + scroll over the sidebar." }] },
    ],
  },
  {
    slug: "organizations",
    title: "Organizations",
    summary: "Shared workspaces for a company or team, with members, roles, teams and invitations.",
    group: "Organizations",
    sections: [
      { h: "Create an organization", body: [{ steps: ["Open the workspace menu at the top of the sidebar and choose New organization.", "Name it. You become its owner, and it starts with an open General teamspace.", "Invite people from Organization → Members."] }, { p: "Your personal workspaces stay private. Nothing moves into an organization unless you put it there, and you can belong to several organizations at once." }] },
      { h: "Roles", body: [{ list: ["Owner: everything, including transferring ownership and deleting the organization. There's exactly one.", "Admin: manages members, invitations, teams, teamspaces and policies; sees the audit log and insights.", "Member: reads and edits the organization's pages and databases (except private pages they aren't on).", "Guest: doesn't see the organization at all, only the pages someone shares with them."] }] },
      { h: "Invitations", body: [{ p: "Invite by email from Members → Invite people. An invitation is tied to that address: only someone signed in to Max with that verified email sees it (in their sidebar) and can accept, within 14 days. Admins can resend or revoke invitations and see their history." }, { p: "Owners can also let everyone with a verified email at the company's own domain join without an invitation (Organization → Policies → Join with a work email)." }] },
      { h: "Teams", body: [{ p: "Group people into teams or departments (Design, Operations…) in Organization → Teams. Teams can be given access to private pages and teamspaces together." }] },
      { h: "Leaving, removal and ownership", body: [{ list: ["Removing or suspending someone takes effect on their very next action, including pages they have open. When you remove someone, choose who takes over the tasks assigned to them.", "Members can leave any time; the owner transfers ownership first.", "Transferring ownership or deleting the organization asks for the owner's security phrase (see Security)."] }] },
    ],
  },
  {
    slug: "teamspaces",
    title: "Teamspaces and private pages",
    summary: "Areas of an organization for each team, open, closed or private, and who can see each page.",
    group: "Organizations",
    sections: [
      { h: "Teamspaces", body: [{ p: "A teamspace is an area of the organization, such as Engineering, Marketing or Handbook, with its own pages and members. Create one with the + next to Teamspaces in the sidebar, or from Organization → Teamspaces." }, { list: ["Open: everyone in the organization can open it.", "Closed: everyone sees it exists and can ask to join; only its members open it.", "Private: only its members know it exists."] }] },
      { h: "Limit who sees a page", body: [{ steps: ["Open the page's Share menu. The top section shows who in the organization can see it.", "Choose Change, then Open, Closed or Private, and pick the people and teams who can open it.", "For a private page, optionally let everyone else view or comment instead of hiding it."] }, { p: "The limit covers everything inside the page. Owners and admins always keep access. Hidden pages don't appear anywhere for others: not in the sidebar, search, graph, links, files or connected apps." }] },
      { h: "Asking to join", body: [{ p: "Closed teamspaces are listed in the sidebar with Ask to join. The people on the list and the organization's admins get the request in their inbox." }] },
    ],
  },
  {
    slug: "collaboration",
    title: "Editing together",
    summary: "Live co-editing, presence, comments, threads, mentions and reactions.",
    group: "Work together",
    sections: [
      { h: "Live editing", body: [{ p: "Organization pages and shared pages are edited live: everyone types in the same document, sees each other's named cursors, and sees who has the page open at the top. Nothing is lost when two people type at once." }] },
      { h: "Comments", body: [{ list: ["Comment on a page, or on one block from its ⋮⋮ menu.", "Reply to start a thread; resolve it when it's done (it stays in history).", "Type @ to mention someone. They're notified in their inbox.", "React with an emoji to acknowledge without a reply."] }] },
      { h: "Synced pages", body: [{ p: "Type /synced page to show another page's content inside this one. It's always up to date: edit it once at the source and every place it's synced shows the change. Only people who can open the source see its content." }] },
      { h: "Announcements", body: [{ p: "Organization admins can announce a page (Review → Announce to the organization) to everyone or to chosen teams. It lands in their inbox; people who can't open the page aren't told." }] },
      { h: "Activity", body: [{ p: "Organization → Insights shows recent changes: who created or edited which page, and new comments." }] },
    ],
  },
  {
    slug: "reviews",
    title: "Reviews and suggested edits",
    summary: "Ask for approval, or propose changes that someone accepts.",
    group: "Work together",
    sections: [
      { h: "Request a review", body: [{ steps: ["Open Review in the page's top bar and choose Request a review.", "Pick the reviewers and add a message. They're notified.", "Every reviewer must approve. The page shows the request until it's decided."] }, { p: "You can't approve your own request. Every decision, approval or requested change, is kept in the review's history and never rewritten." }] },
      { h: "Suggest edits", body: [{ steps: ["Choose Review → Suggest edits. You edit a copy of the page in the full editor; the page itself doesn't change.", "Send it with a note. The person who last edited the page reviews it, unless you choose reviewers.", "The reviewer compares the changes line by line and accepts or declines. Accepting saves it as a new version, so it can be undone from history."] }] },
    ],
  },
  {
    slug: "inbox",
    title: "Inbox and notifications",
    summary: "Mentions, replies, assignments, reviews, access requests and due dates in one place.",
    group: "Work together",
    sections: [
      { h: "What arrives", body: [{ list: ["Mentions and replies to comments you're part of.", "Tasks assigned to you through a Person property.", "Review requests, decisions and suggested edits.", "Requests to join private pages you manage.", "Changes to your role in an organization.", "Messages from database automations.", "Due soon: tasks assigned to you that are overdue or due within two days."] }] },
      { h: "Managing it", body: [{ p: "Open Inbox at the top of the sidebar. Mark one or all as read, filter to unread, and turn kinds of notifications off with the settings button. Notifications from an organization you've left disappear." }] },
    ],
  },
  {
    slug: "tasks-and-automations",
    title: "Tasks and automations",
    summary: "Assign work to people and let databases update themselves, without AI.",
    group: "Work together",
    sections: [
      { h: "Assign people", body: [{ p: "Add a Person property to a database to assign rows to members of the organization (or yourself in a personal workspace). Assigned people are notified. Filter a view by person to get a “My tasks” view." }] },
      { h: "Forms", body: [{ p: "Open the clipboard button in a database's toolbar to get its form: one field per property, and each submission adds a row. Share the link with your organization so anyone can file requests, bugs or ideas into the database." }] },
      { h: "Recurring tasks", body: [{ p: "An automation with a schedule creates a row every day, week or month (for example “Weekly review”), then runs its actions, such as assigning someone or setting a due date." }] },
      { h: "Automations", body: [{ steps: ["Open the ⚡ button in a database's toolbar and choose New automation.", "Pick when: a row is created, a property changes (optionally to a value), a button is pressed, or a schedule.", "Pick what: set a property, stamp a date with now, assign the person acting, or notify assignees or the row's creator."] }, { p: "Automations run instantly with the change that triggers them, and never trigger each other, so they can't loop. Each shows how often it ran. Button automations appear on each row's page." }] },
    ],
  },
  {
    slug: "wiki",
    title: "Wiki verification and insights",
    summary: "Keep company knowledge trustworthy and see how the organization uses Max.",
    group: "Organizations",
    sections: [
      { h: "Verify pages", body: [{ p: "From a page's ⋯ menu, choose Verify page. It shows who vouches for it and until when (90 days). Once verification expires, the page says so, and it appears in Organization → Insights → Wiki pages to review." }] },
      { h: "Insights", body: [{ p: "Admins see eight weeks of activity (pages created and edited, comments, active people), open tasks per person, reviews waiting for a decision, and the most active contributors. Counts only: never page contents." }] },
    ],
  },
  {
    slug: "sharing",
    title: "Sharing and guests",
    summary: "Share pages with anyone by email or link, at the level you choose.",
    group: "Publish and connect",
    sections: [
      { h: "Share with people", body: [{ steps: ["Open Share on any page.", "Invite people by email with Full access, Can edit, Can comment or Can view. Sub-pages are shared too.", "Change or remove anyone's access from the same list."] }, { p: "People you share with find the page under Shared in their sidebar. In an organization, the organization's policy decides whether pages may be shared outside it." }] },
      { h: "Links", body: [{ list: ["“Anyone in Max with the link” lets signed-in people open it at the level you choose.", "Links can expire after a day, a week or a month.", "Turning a link off stops it working immediately."] }] },
    ],
  },
  {
    slug: "publishing",
    title: "Publishing",
    summary: "Put a page on the web, or publish a whole website from your pages.",
    group: "Publish and connect",
    sections: [
      { h: "Publish a page", body: [{ steps: ["Open Share → Publish.", "Publish to the web: anyone with the link can read it, no account needed.", "Unpublish any time; the link stops working."] }] },
      { h: "Publish a website", body: [{ p: "Publish a page and everything inside it as a website at its own address, with navigation, search and an optional custom name. Visitors can report problems; nothing private is shown." }] },
      { h: "In organizations", body: [{ p: "Admins decide whether pages may be published to the web and whether websites are allowed (Organization → Policies). Both are off by default." }] },
    ],
  },
  {
    slug: "connectors",
    title: "Connectors and the marketplace",
    summary: "Connect apps to Max with exactly the permissions you approve.",
    group: "Publish and connect",
    sections: [
      { h: "Connect an app", body: [{ steps: ["Open Settings → Connections → Marketplace.", "Choose an app. Max shows exactly what it may do (read or edit pages, read or write comments, see people) and where.", "Pick the workspace or organization, untick anything you don't want, and choose Connect."] }, { p: "Apps never see an organization's private pages they aren't added to, and can never share or publish, manage accounts, or delete anything permanently. Disconnect an app from Settings → Connections at any time; it loses access immediately." }] },
      { h: "Built in", body: [{ list: ["Notion: import pages, databases, colors and images (Settings → Connections).", "AI assistants: Claude, ChatGPT and other MCP clients (see Connect an assistant).", "Your own app: build one with the API below."] }] },
      { h: "Reviewed listings", body: [{ p: "Every app in the marketplace is reviewed by Max's team before it's listed. A listed app that asks for more permissions goes back into review, and an app that misbehaves can be suspended everywhere at once." }] },
    ],
  },
  {
    slug: "api",
    title: "Build an app (API, OAuth, webhooks)",
    summary: "Max's REST API, sign-in with OAuth, and signed webhooks for developers.",
    group: "Publish and connect",
    sections: [
      { h: "1. Register your app", body: [{ p: "In Settings → Connections → Build an app, choose New app: its name, what it does, the permissions it needs, OAuth redirect addresses and, optionally, a webhook address and events. Save the client secret and webhook signing secret: they're shown once." }] },
      { h: "2. Get a token", body: [{ p: "Private apps: open Connect on your app and copy the token. Public apps use the OAuth code flow:" }, { steps: ["Send people to https://max.chaos.fail/apps/<client_id>?redirect_uri=<registered address>&state=<random>.", "After they approve, Max redirects to your address with ?code=…&state=….", "Your server exchanges the code (valid 10 minutes, once) for the token."] }, { code: "curl -X POST https://max.chaos.fail/api/v1/oauth/token \\\n  -d grant_type=authorization_code -d client_id=… -d client_secret=… -d code=… -d redirect_uri=…\n# → { \"access_token\": \"maxi_…\", \"token_type\": \"bearer\", \"workspace\": …, \"scopes\": [...] }" }] },
      { h: "3. Call the API", body: [{ p: "One endpoint runs every operation Max's own interface and assistants use, limited to the permissions granted:" }, { code: "curl https://max.chaos.fail/api/v1/ops \\\n  -H \"Authorization: Bearer maxi_…\" -H \"Content-Type: application/json\" \\\n  -d '{\"op\":\"pages.create\",\"args\":{\"title\":\"Hello from my app\"}}'" }, { p: "GET /api/v1/ops lists every operation with its description and the permission it needs. Errors come back as { error: { code, message } } with a matching HTTP status. Up to 300 requests a minute per token." }] },
      { h: "4. Webhooks", body: [{ p: "Max POSTs JSON for the events you chose (page.created, page.updated, page.content_updated, page.deleted, record.created, record.updated, comment.created). Payloads carry ids and the event name, never content: fetch what you need with the API. Failed deliveries are retried after 1, 5 and 30 minutes and 2 hours." }, { p: "Verify each delivery: the Max-Signature header is t=<unix time>,v1=<hex>, an HMAC-SHA256 of \"<t>.<raw body>\" with your signing secret. Reject old timestamps." }] },
      { h: "Publish to the marketplace", body: [{ p: "Choose Submit on your app. Max's team reviews it; you'll see the decision and any notes in Build an app." }] },
    ],
  },
  {
    slug: "security",
    title: "Security and administration",
    summary: "Owner security phrase, policies, retention, audit logs and how Max protects your data.",
    group: "Admin and security",
    sections: [
      { h: "The owner's security phrase", body: [{ p: "Max accounts sign in with Google and other providers, so there's no password to ask for again. Instead, an organization's owner sets a security phrase (Organization → General → Security phrase). It's asked before ownership is transferred or the organization is deleted. Only a scrambled copy is stored, and five wrong tries lock it for 15 minutes." }] },
      { h: "Policies", body: [{ list: ["Who may invite members, and whether pages may be shared outside, published to the web, or published as websites.", "Trash retention: trashed pages are deleted for good after 7 to 365 days, checked daily.", "History retention: older versions are removed after a set time, always keeping each page's latest.", "Join with a work email: people with a verified email at your company's domain can join as members.", "Single sign-on (SAML/OIDC, e.g. Okta, Microsoft Entra, Google Workspace) is set up in Max's sign-in provider."] }] },
      { h: "Audit log", body: [{ p: "Admins see every change to membership, roles, invitations, teams, policies, private pages, apps and ownership in Organization → Activity." }] },
      { h: "How your data is protected", body: [{ list: ["Every request is checked on the server against your membership and role; nothing trusts the browser.", "Organizations, personal workspaces and accounts are separated by the same ownership checks on every read and write.", "Max's own administrators see accounts, organizations and counts, never the contents of your pages.", "Max has no built-in AI. Assistants and apps only get what you connect them to."] }] },
    ],
  },
  {
    slug: "workspaces-and-shortcuts",
    title: "Workspaces and shortcuts",
    summary: "Move between spaces quickly: keyboard, gestures, split view and peeks.",
    group: "Start",
    sections: [
      { h: "Switching", body: [{ list: ["⌃1–⌃9 on a Mac (Alt+1–9 elsewhere) opens your first nine workspaces and organizations.", "Shift + scroll over the sidebar moves one workspace at a time.", "Swipe sideways over the sidebar on a trackpad or phone.", "⌘K → “Go to …” jumps to any workspace."] }, { p: "Max remembers where you were in each workspace and takes you back there." }] },
      { h: "Peek and split view", body: [{ p: "Open a database row or linked page in a side peek or center peek. From a peek, choose Open in split view to keep it beside the page you're working on; the page makes room for it." }] },
    ],
  },
];

export const GROUPS: Guide["group"][] = ["Start", "Work together", "Organizations", "Publish and connect", "Admin and security"];
