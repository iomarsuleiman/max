# Collaboration transport experiments

Date: 2026-11-11. Status: spike completed; production transport not selected.

## Decision

Keep BlockNote JSON canonical and retain the current personal save/recovery
path. All tested candidate engines preserve Max's actual custom schema and merge
the tested simultaneous edits. None is ready to enable shared editing. The
experiment found a concrete lost-edit case during concurrent block moves, and
browser lifecycle, authenticated transport and revocation remain unproven.

Continue with an isolated native Yjs provider adapter prototype because the
tested schema already has working binary-update replay, relative anchors and
local undo. Keep Convex ProseMirror Sync as the comparison candidate. This is a
proposed next experiment, not approval to change the editor or stored format.
The phase-00 and permission gates in [ADR 0001](0001-collaboration-boundaries.md)
still apply.

## Exact-schema proof

`scripts/sync-spike.mjs` bundles the real `maxSchema` from
`components/editor/blocks.tsx`, the installed BlockNote 0.55.0 and the existing
editor corpus. It substitutes neither a generic schema nor a plain Y.Text.
CSS is omitted for the isolated Node process; a Happy DOM supplies the DOM API.
The script never starts a server or opens an application data directory.

The run checks 26 top-level blocks, 33 blocks including children. It verifies
authored properties, IDs, order, child IDs, text, styles, links, page/date
mentions, both table-cell formats, columns, custom blocks and attachment
references against the original corpus. Only absent JSON values and the
editor's existing table-cell defaults are normalized. Successful equality
between two encodings alone would not prove that authored fields survived.

### Observed results

- The production schema converts the corpus to ProseMirror and Yjs and back
  without losing those authored fields.
- Three mounted ProseMirror views use that schema with the actual y-prosemirror
  sync/undo plugins. Disconnected clients insert Arabic/English text at the same
  position while also editing table text and a custom image attribute.
- The script persists the initial binary state and local incremental updates
  to a JSON journal on disk, destroys every original client document/view,
  reads the journal and reconstructs new documents. Replaying updates in
  reverse order and twice produces the same merged content on all clients.
- A persisted Yjs relative anchor still resolves to the original text after
  replay and concurrent insertion. A new local undo removes its own text while
  retaining another client's simultaneous text and the previously merged edits.
- The same schema and edits converge using prosemirror-collab's versioned
  acknowledgement/rebase primitives, the OT engine used by Convex's component.
  Five steps are accepted and every client has no remaining unconfirmed steps.
  This does not execute the component's backend or React hook.
- The third candidate, BlockNote's native `@blocknote/core/y` path, also passes
  the corpus roundtrip and three-client bilingual/table/custom-attribute merge.
  It uses the installed `blockMatchNodes` policy, not an invented comparator.
  The tested packages are prereleases, `@y/y` 14.0.0-rc.29 and
  `@y/prosemirror` 2.0.0-11 with `@y/protocols` 1.0.6-rc.1.

The successful replay reconstructs disposed documents in one Node process.
It does not certify browser IndexedDB, crash-consistent writes, tab closure,
permission checks, network transport or a full process restart.

## Reproducing the proof

Install experimental dependencies in a disposable directory outside this
repository. No package or lockfile change is required. For PowerShell:

```powershell
$spikeDependencies = Join-Path $env:TEMP 'max-sync-spike-20261111'
npm install --prefix $spikeDependencies --save-exact --no-audit --no-fund --ignore-scripts --legacy-peer-deps yjs@13.6.27 y-prosemirror@1.3.7 y-protocols@1.0.6 prosemirror-collab@1.3.1 happy-dom@20.0.10 @convex-dev/prosemirror-sync@0.2.7 @y/y@14.0.0-rc.29 @y/prosemirror@2.0.0-11 @y/protocols@1.0.6-rc.1
node scripts/sync-spike.mjs --deps $spikeDependencies
```

The driver uses the workspace's existing esbuild through tsx, resolves the
installed production ProseMirror modules once to avoid duplicate class
instances, and supplies only missing collaboration peers from the external
directory. It writes the bundle, journal and report to a new OS temporary
directory. The report records package versions and SHA-256 hashes of the schema
source, fixture and application lockfile. A failed assertion exits nonzero.
Report flags explicitly leave transport selection and production readiness
false.

## Reproduced release blocker: move versus edit

The diagnostic applies a regular ProseMirror delete-and-insert move to the
fixture quote in one client while a disconnected client inserts text inside
that quote. After merging, all three engines converge, but the inserted text is
absent. In the OT case, rebasing discards the writer's step. Convergence alone
does not prove that every user's intention survived.

The report therefore includes these observed values:

```json
{
  "yjsConverged": true,
  "yjsPreservedConcurrentEdit": false,
  "otConverged": true,
  "otPreservedConcurrentEdit": false,
  "otDiscardedClientEdits": 1
}
```

Do not enable shared block drag/move using ordinary delete-and-insert steps.
The next proof must implement a block-move contract that retains concurrent
content, or recover the conflicting edit with an explicit user-visible choice.
It must preserve IDs and comment anchors without introducing duplicate blocks.
Run the same test through Max's actual drag handler and BlockNote views before
calling this resolved.

The v14 report separately records `moveConverged: true` and
`movePreservedConcurrentEdit: false`. Its node-pairing policy compares content
type, nesting and table dimensions. It does not turn a delete-and-insert move
into a stable-ID move operation. The installed native move implementation has
the same removal/insertion shape at
`node_modules/@blocknote/core/src/api/blockManipulation/commands/moveBlocks/moveBlocks.ts:153`.
This is a model-level reproduction, not a completed Max UI drag-gesture test.

A possible recovery path keeps each unsent operation and its base content in a
durable outbox before rebasing. If a remote structural change maps an authored
local step away, retain the original branch and show a conflict with an explicit
recovery/copy choice. Do not mistake an empty sendable-step queue for successful
acknowledgement when rebasing discarded the change. This is a proposal, not a
tested fix. A stricter move protocol could require an acknowledged version,
apply against the latest server content and rotate the document generation,
rejecting older pending updates into recovery. A server-only version check on
the move is insufficient if stale offline updates can still be accepted later.

The subsequent [generation and local outbox experiments](../COLLABORATION_RECOVERY.md)
now test that reference protocol. Both move/edit orderings retain content or an
explicit recovery branch with the actual schema. IndexedDB recovery survives
graceful browser restart in Chromium and WebKit. These primitives remain
unconnected to the live provider; raw structural-update detection, atomic server
enforcement and abrupt crash behavior are still unproven.

## Candidate comparison

| Concern                 | Native BlockNote Yjs                                                                        | Convex ProseMirror Sync                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Exact custom schema     | Corpus roundtrip and three-client binding experiment pass                                   | Corpus roundtrip and three-client underlying OT experiment pass                                  |
| Application integration | Installed `@blocknote/core/yjs` has a collaboration helper, relative positions and Yjs undo | Component exposes BlockNote editor options for the custom schema and Convex endpoint integration |
| Durable storage         | Requires a provider, authenticated update log, compaction and recovery                      | Component stores steps/snapshots; Max still needs durable unsent-step recovery                   |
| Presence                | Requires an authorized awareness provider                                                   | Requires a separate authorized presence implementation                                           |
| Permissions             | Must gate update read/write, awareness and snapshots with the page policy                   | Read/write callbacks exist; wrappers must apply Max's policy to every endpoint                   |
| Restore                 | New document generation and reconnect protocol required                                     | Snapshot/step generation and reconnect protocol must be established                              |
| Local mode              | Can preserve the current personal path; shared guarantees need a provider                   | Requires Convex for cloud sync; preserve current local personal adapter                          |
| Concurrent block move   | Tested lost-edit case remains unresolved                                                    | Same lost-edit case remains unresolved in underlying OT engine                                   |

The v14 native path is a third experimental variant. Although its corpus and
ordinary concurrency tests pass, it retains the move-versus-edit failure and
introduces prerelease compatibility risk. The exact lower advertised peer
`@y/prosemirror` 2.0.0-6 lacks four exports required by installed BlockNote's
`core/y` entry point. Version 2.0.0-15 lacks two required exports. Both fail the
isolated build. Versions 2.0.0-9 through 2.0.0-11 expose those symbols; this run
uses 2.0.0-11, whose dependency requires `@y/y >=14.0.0-rc.26` within that
prerelease range. Do not install the latest prerelease without a compatibility
check or treat the existing peer range as proof of compatibility.

BlockNote's native collaboration helper configures its Yjs plugins and replaces
ordinary history with collaboration-aware undo. Its conversion functions warn
against rebuilding an established Y.Doc from block JSON, which would discard
collaboration history. The installed v13 versioning adapter deliberately throws
on restore; merging an old snapshot into the current CRDT cannot revert it.
These findings come from the installed 0.55.0 source, especially
`src/yjs/extensions/index.ts`, `src/yjs/utils.ts` and
`src/yjs/extensions/Versioning.ts`. The public
[BlockNote collaboration documentation](https://www.blocknotejs.org/docs/features/collaboration)
also separates editing from the provider that transports and persists updates.

Convex's component uses versioned OT and offers per-document read/write hooks
plus snapshots. Its BlockNote wrapper accepts custom editor options rather
than requiring Max to replace its schema. Its documentation explicitly
describes unsent-step loss when best-effort unmount flushing fails offline.
Max's current local draft guarantee therefore requires an additional durable
outbox before this hook could replace `useDocumentSync`. See the
[component README](https://github.com/convex/prosemirror-sync#readme),
[BlockNote wrapper source](https://github.com/convex/prosemirror-sync/blob/main/src/blocknote/index.ts)
and [authorized endpoint source](https://github.com/convex/prosemirror-sync/blob/main/src/client/index.ts).
The package inspected in the isolated directory is 0.2.7; upstream links may
change, so compare against that package's included `src/` when reproducing.

Yjs updates can be applied more than once and in different orders, which is why
the experiment deliberately duplicates and reverses deliveries. This property
does not provide authorization, acknowledgement or durable local persistence.
See the [Yjs update API](https://docs.yjs.dev/api/document-updates).

## Required adapter behavior

Keep editor rendering independent from acknowledgement and persistence.
The adapter must expose loading, syncing, acknowledged, offline, recoverable
error, conflict and revoked states. Mark a change saved only after the server
acknowledges it. Persist an unsent operation before it can be lost on unmount.
Namespace local recovery by account, workspace, page and document generation.

Authenticate every server read, write, snapshot and presence path with the same
page capability evaluator. Recheck access before replaying a durable outbox.
Reject old document generations and revoked membership; stop subscriptions and
redact cached remote results. A revoked local draft must remain quarantined and
cannot be uploaded to another workspace automatically.

Keep comments and approvals as authenticated domain operations rather than
trusting client-provided author IDs or opaque comment updates. The installed
Yjs thread store itself warns that clients able to write the shared document
can bypass UI-only comment restrictions. A comment-only user must never gain
document-write permission as a side effect of the chosen transport.

For either candidate, validate step/update sizes and the resulting schema on
the server. Derive canonical BlockNote JSON, search text and history from the
accepted state. Do not let the old full-document autosave and a new transport
write the same shared document concurrently. Use a generation-based cutover
with retained original content, staged validation and a tested rollback.

The next acceptance run must include the real BlockNote UI in Chromium and
WebKit, composition/IME, block moves/deletes, local undo, comments/anchors,
refresh and tab switches while offline, restore with an old client reconnecting,
role changes and revocation during pending writes, reconnect deduplication,
document bounds and measured latency/traffic. This spike proves a viable schema
and update-replay foundation. It does not complete phase 04 or authorize shared
editing rollout.
