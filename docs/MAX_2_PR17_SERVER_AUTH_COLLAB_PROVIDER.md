# Max 2.0 — PR 17/44: Authenticated durable collaboration provider sandbox

## Strict isolation and release status

Stacked on PR #35 (16/44), not main. This is an **experimental standalone Convex project** under experiments/max-v2-pr17/convex. Root convex/schema.ts, deployed Max endpoints, personal documents, MaxEditor, autosave, local drafts, imports, search, MCP, permission writers and shared production navigation remain unchanged.

This PR is **not** a production multiplayer provider and does **not** activate sharing. The sandbox uses the backend-verified identity and the existing default-deny workspace/page authorization gateway. Its lab table names and schema deliberately live outside the real Max Convex functions directory. It will not accept production Max page data; synthetic workspace scope rows must be created in a dedicated isolated deployment.

## Implemented protocol boundary

- **Auth + session issuance:** join is a Convex mutation. It derives identity from ctx.auth.getUserIdentity().subject, verifies live workspace+page read access, and issues a server-stored five-minute session row. Only an editor can initialize an empty room. The session ID never acts as a bearer secret.
- **Every operation:** readUpdates and appendUpdate reload the session and room, verify matching authenticated subject/scope/lease, and re-read current workspace membership, groups, registered group/teamspace IDs, page ancestry, explicit denies and capability. Reads require view, appends require edit_content. Invalid, duplicated, missing, revoked or cross-workspace ACL rows fail closed.
- **Durability:** immutable base64-encoded opaque Yjs update records are appended to Convex tables with a monotonically increasing per-room sequence, per-actor operation-id idempotency and atomic room counters. Same operation ID plus different bytes is rejected. A cursor-based bounded read stream enables an authenticated consumer to catch up after reconnect. Convex reactive queries can be subscribed to by the isolated experimental client.
- **Bounded resources:** max 16 KiB encoded updates, 256 updates and 1 MiB of records per room, up to 32 sessions per account per workspace, and 64 records per read call. When these caps are reached the operation fails instead of overwriting or truncating data. Compaction, lease cleanup and quota-aware production budgets remain future work.
- **Revocation:** a sandbox-only workspace owner mutation atomically marks a member revoked, terminates that member's stored leases and appends a security event. Every subsequent read/write and reconnect is denied, while previously committed updates remain available to authorized participants. The admin mutation never modifies actual Max memberships.
- **Opt-in:** MAX_V2_PR17_PROVIDER_SANDBOX must equal true in the *separate* experiment deployment. There is no NEXT_PUBLIC activation, current app route, shared-document migration or production release toggle.

## Explicit prototype limitations — do not exaggerate test coverage

1. These are real Convex query/mutation handlers with server-owned session and persistent table contracts, **not a deployed production transport**. CI uses convex-test emulator, with distinct synthetic authenticated identities, not independently verified real Clerk accounts.
2. Payload bytes are bounded and stored exactly, but **opaque**. The server does not parse or prove the update is valid Yjs, bind bytes to the full maxSchema, enforce per-block ACL, or test rich document fidelity. PR16's actual mounted BlockNote lab remains in-process and is **not yet attached** to these endpoints.
3. Convex reactive queries provide a potential subscription feed but this PR does not ship a Yjs network provider adapter, presence, awareness, real WebSocket transport, CRDT compaction, offline IndexedDB persistence, interrupted-upload handling, binary hashing, or a checkpoint restore.
4. The sandbox's revoke mutation fences leases at the same transaction as its own membership change. All future membership/grant writers must preserve that invariant; direct database repair/other writers may not. Read/write checks still reevaluate current ACL on every operation.
5. The durable log preserves bytes, not proof of merged document integrity. Sequence is an append order, **not** a ProseMirror OT step sequence. Do not feed ProseMirror steps into this Yjs-only lab.
6. Existing PR16 Chromium/WebKit test results, provider runtime comparison, 2/3 **real** accounts, Arabic IME, 10-minute partition/reconnect, 100/1000/5000-block performance, rollback/backups and external security verification remain incomplete until independently run.

## Reproduction, tests and deployment boundary

- Unit integration: tests/unit/collaborationProviderSandbox.test.ts runs the sandbox functions through convex-test against real schema definitions. It covers 3 independent emulated identities, owner/member/guest permissions, anonymous/cross-account denial, immediate mid-session permission downgrade and revocation, append retry collision, payload validation, cursor pagination, leave/rejoin and private-flag lockdown.
- CI should run root pnpm lint, typecheck (root + production Convex), Vitest, backup tests and build, **plus** the outstanding PR16 Chromium/WebKit browser lab and existing E2E. Unit tests are not a substitute for a real Convex deployment.
- An independent deployment must use experiments/max-v2-pr17 as a separate Convex project with its own Clerk JWT verification and wholly synthetic fixtures; set the private flag there only. Never point it at Max production's CONVEX_DEPLOYMENT or import production user notes. This repo does not automatically deploy that sandbox.
- On rollback, remove experiments/max-v2-pr17/ and the PR17 test/documentation. No root migration, real table, editor mutation or production session needs reversal.

## Blocking next steps

Attach the **real** Max-schema BlockNote Yjs provider to these authenticated endpoints only in a separate browser sandbox, verify authenticated 2/3 real Clerk accounts plus server-revocation re-subscription, and prove lossless custom-block + media round-trips, crash-durable offline recovery and backup/restore. Compare with a genuinely deployed Convex ProseMirror Sync component rather than choosing a provider from synthetic tests. Only reviewed security, operation-level authorization, actual provider traces, performance and migration gates can support a future production activation PR.

**Status:** draft; code/CI evidence must be checked against the final PR head. No merge or deployment is authorized.
