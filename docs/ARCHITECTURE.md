# Max architecture (planned)

Max is a single-user-per-account notes application. No organizations, teams, shared pages, presence or collaborative editing.

## Stack

- Next.js App Router, React and TypeScript for the web app
- Tailwind CSS, shadcn/ui and accessible primitives for the UI
- Clerk for sign-in and session identity
- Convex for owner-scoped data, live queries and mutations
- BlockNote for rich document editing
- Remote MCP endpoint for external assistants

## Boundaries

1. **UI:** routes, editor, sidebar, settings and personal databases.
2. **Domain:** page and block commands, hierarchy, database schema/records, assets, search and settings.
3. **Persistence:** Convex functions with server-side identity and ownership checks.
4. **MCP:** typed tools invoking the same authorized domain operations as the UI.

Every supported UI operation must have an equivalent MCP operation. MCP grants may restrict an operation, but must never elevate privileges.

## Reliability

Version documents and validate writes; distinguish unsent, pending, saved and failed states. Recover drafts without silently overwriting newer content. Prefetch selectively, not entire note bodies.

## Open source

Never require production credentials to run local development. Provide documented setup, environment examples, migrations, test fixtures, CI and self-hosting guidance as implementation progresses.

See the project [roadmap](ROADMAP.md) for scope and acceptance gates.
