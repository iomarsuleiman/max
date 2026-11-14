# Max 2.0 — PR 15/44: Isolated provider runtimes and server-fenced collaboration preflight

## Stacking, status and non-negotiable boundaries

This draft stacks directly on PR #32 (14/44), the canonical transport evidence and offline-reconnect groundwork. It introduces **real upstream library execution in an isolated experiment** and a default-OFF authenticated server-side *policy preflight* — not live shared-document syncing. This is intentionally additive. None of the existing personal BlockNote editor, 650 ms autosave, local drafts, versions, imports/exports, MCP tools, workspace permissions or source documents are changed.

**What is genuinely exercised:** the installed Yjs CRDT update/merge API; the installed ProseMirror collab OT rebase API; importability of the real Convex ProseMirror Sync and BlockNote 0.55 collaboration entrypoints. **What is not exercised yet:** the actual Convex ProseMirror Sync component communicating with a deployed Convex backend, BlockNote with the full Max custom schema under a real provider, real-authenticated multi-user transport sessions, browser offline persistence, provider-level authorization on every update, IME/RTL UI, and production data migration.

## Package separation and CI

- `experiments/max-v2-pr15/package.json` is a private, disposable Node 22 package with pinned direct versions of `yjs`, `prosemirror-collab`, `prosemirror-model`, `prosemirror-state`, `@convex-dev/prosemirror-sync`, and Max's existing `@blocknote/core@0.55.0`.
- The `provider-probe` job in the existing GitHub Actions CI installs these **only in the experiment directory** with scripts disabled and no lockfile creation. It records `npm ls --depth=0` then executes `node --test` with real libraries. No production dependency, pnpm lockfile, Convex component or Next page is added.
- This exploratory uncommitted transitive graph is a **known reproducibility limit**. Before provider selection, generate and commit a reviewed pinned lockfile for the chosen isolated harness, review the package supply chain and record supported versions.
- The synthetic update tests prove only low-level CRDT/OT primitives converge under deterministic in-memory exchanges, not that Max's custom BlockNote blocks are compatible with either live provider.

## Experimental scenarios exercised

1. Real Yjs: two concurrently edited replicas converge with Arabic and Latin text and preserve synthetic custom block metadata and block ID.
2. Real Yjs: three disconnected replicas insert different content, exchange binary state updates and converge.
3. Real Yjs: a synthetic in-memory saved update can recreate a fresh Y.Doc after destruction and merge with remote edits. This is **not** durable IndexedDB, browser crash or force-close testing.
4. Real ProseMirror: two editor states with the built-in collab OT plugin rebase concurrently submitted steps and converge on equal document JSON. This is a **protocol primitive**, not a Convex ProseMirror Sync server.
5. The real Convex ProseMirror Sync package loads and exposes its server integration class without starting a backend or opening a room.
6. The Max-pinned BlockNote core package exports the official `withCollaboration` Yjs helper. This is an import-only smoke test, not a mounted Max editor.

All evidence remains in GitHub Actions logs and is labeled as isolated-lab / partial. PR14's 12-scenario provider matrix **must not be marked fully passed** from these primitives; real provider A/B traces are still required.

## Default-off authenticated Convex preflight

- `convex/collaborationLab.ts:preflight` is a **read-only query** guarded by private environment variable `MAX_V2_COLLAB_LAB_ENABLED === "true"`, which is absent/false in the existing production configuration. No public feature flag, session lease, schema table or transport connection is created.
- Each query derives the account from `ctx.auth.getUserIdentity()` and independently invokes the existing fail-closed `canAccessWorkspacePageFromServer` ACL engine over server-fetched membership, teamspace, page and grant rows. Requested account, role or grants cannot be passed through client arguments. View-like operations require `view`; prospective mutations require `edit_content`.
- Even on a policy pass the response always has `canReadSharedContent=false`, `canSubmitSteps=false`, and `canActivateProvider=false`. Client-observed positive preflight is **not a token** and cannot authorize any later operation.
- `lib/domain/collaborationLabSessionFence.ts` adds an isolated, pure server-owned session-policy contract (trusted account, exact scope/room/candidate, server generation, 5-minute max lease, live ACL check on **every** operation). It rejects expired/stale/mismatched/revoked/faulting cases, and always denies actual document reads and step submissions. It does **not** create/store/sign trusted sessions or prove that a browser cannot forge a client-side object. No active transport consumes it yet.
- Production integration needs real server-owned session storage/nonces, atomic revocation fences, and authorization before each provider snapshot, step, subscription, replay, history and room read; no client-supplied account identity or cached permission is sufficient.

## Required next live tests and release gates

- Test **both** actual BlockNote transport adapters with Max's exact `maxSchema` including custom media, equation, diagrams, tables, columns, page mentions and database views in disposable environments. Preserve document IDs, hierarchy, properties and preexisting history, without normalization that silently changes data.
- Attach 2/3 real authenticated Clerk-client traces, offline 10-minute divergent edits and revocation mid-session, browser close/crash and failed unmount flush (particularly with ProseMirror Sync), and reconnect across different devices.
- Compare 100/1,000/5,000 block performance, CPU/memory and data transfer, cursor behavior, undo/redo, Arabic composition, RTL and mobile/Chromium/WebKit accessibility.
- Require isolated Convex cloud backup **and restore** including attachment hashes, independent security review, registered shared page scopes, operation-level ACL, rollback proofs and explicit production flag/rollout approval.
- Do not select either provider or accept a self-declared PR14 evidence result as authorization. Reconnect preflight still has `canReplay=false` and `canWrite=false`; legacy personal drafts remain untouched.

## Rollback

Revert the experimental Node package and script, new read-only query, pure session guard + tests, runbook and CI `provider-probe` job. No data, session, provider, production dependency or migration exists to roll back. Existing Max stays on owner-only persistence.

**Next PR 16/44:** full Max-schema BlockNote integration mounted in isolated real browsers and separate actual Convex component sandbox, with live authenticated multiparty evidence **before** any shared-content release.
