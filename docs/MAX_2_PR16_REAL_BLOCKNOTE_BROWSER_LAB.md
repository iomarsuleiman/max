# Max 2.0 — PR 16/44: Isolated real Max-schema BlockNote browser collaboration lab

## Scope and stack

Draft stacked directly on PR #34 (15/44), which exercises Yjs and ProseMirror OT library primitives. This PR introduces a separate disposable Vite browser lab that imports the **actual Max editor maxSchema** from components/editor/blocks.tsx. Two actual BlockNote React editors are mounted with withCollaboration from the BlockNote 0.55 Yjs entrypoint. **No production editor, page, database schema, workspace mutation or MCP handler is modified.**

This PR does **not** run a real Convex ProseMirror Sync network backend, deliver a shared-document API, authenticate two real Clerk accounts or select the production sync engine. Treat an in-process Yjs relay as a deliberately inadequate network/authorization simulation.

## Lab implementation and reproducibility

- experiments/max-v2-pr16/: private Vite app at localhost:3236 for throwaway fixture editors. Imports Max's real custom schema, not a replacement minimal paragraph schema. Separate npm installation uses no root pnpm dependency additions or lockfile modifications.
- Two distinct Y.Doc instances with y-protocols/awareness and @blocknote/core/yjs share updates through a **local in-memory relay**. Each user has a separate BlockNote editor; clients can disconnect, insert divergent edits and explicitly exchange Yjs update buffers.
- No WebSocket, network provider, persistent server snapshot, IndexedDB or browser restore is implemented. No real user/page content is loaded. A synthetic full-state byte buffer is reconstructed into a new Y.Doc and compared for XML fragment parity; this is **not a durable crash recovery test**.
- The seed includes real Max custom callout, pageLink and bookmark blocks with stable IDs and Arabic content. Browser tests verify cross-editor preservation of these IDs, no duplicate IDs, merging separated edits, and Yjs snapshot reconstruction.
- Browser CI blocknote-browser-lab uses Chromium and WebKit. Results from this job, not the PR15 primitive-only job, determine whether the **mounted editor experiment** passes.

## Security and deployment boundaries

- No new Next route, Convex component/connection, remote provider, bearer access capability, shared writes, production feature flag, persistent artifact or migration. Lab lives in a separate Vite application and is never included in Max's published route tree.
- A client-side Y.Doc update relay is **not** a secure collaboration provider. Do not use it in production or rely on it for access control. PR15's default-OFF Convex permission preflight is still non-authorizing and does not protect lab browser data.
- Existing Max editor (MaxEditor.tsx), 650ms autosave, local recovery, history, real attachments and MCP owner-only access remain untouched.

## Missing release evidence

1. Full golden fixture (including tables, columns, diagrams, equations, embedded media, inline dates/page mentions and database-view) **lossless** import/round-trip in actual mounted editor; this PR's browser seed covers an initial custom-block subset only.
2. Isolated *real* Convex ProseMirror Sync deployment and BlockNote adapter, Yjs network provider with server-owned ACL enforced on snapshot, stream and each update, and authenticated two/three-Clerk-account revocation scenarios. No one provider is selected.
3. Durable offline journal and provider-specific merge; background tab unmount/failed submission, browser force-close/reopen, persistent assets and version history, old-client compatibility.
4. Real Arabic IME/cursor selection/undo-redo, RTL/mobile, latency, memory/payloads, 100/1000/5000-block budgets and independently reviewed security and accessibility.
5. Isolated Convex cloud backup/restore including byte-verified files, migration rollback and formal authorization for shared data and MCP.

## Validation and rollback

CI: root lint + root/Convex TypeScript, Vitest and backup tests, production build, standard E2E, PR15 provider-probe, and new Chromium/WebKit blocknote-browser-lab job. The existing audit has continue-on-error; this is not a guarantee of zero dependency issues.

If the lab fails to load Max's real schema or Yjs editor, **keep this PR draft and fix the failing evidence**. Do not mark the experiment green from a PR15 underlying-library test, or remove the test to make CI green. The standalone experiment package currently uses pinned direct deps without a committed transitive lockfile; this is an explicit reproducibility limitation.

Rollback simply removes the disposable experiments/max-v2-pr16 folder, CI test job and these notes. There is no data migration, server deployment or production behavior to reverse.

**Next PR 17/44**: real server-authenticated provider/room prototype in an isolated Convex sandbox, with operation-level ACL, durable update persistence and independently verified 2/3-client revocation/reconnect; still no production rollout without security and recovery gates.
