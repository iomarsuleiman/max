# Collaboration recovery protocol experiments

The current editor still uses its existing personal autosave and local drafts.
The modules below are tested prerequisites for a future adapter. They do not
enable shared editing or select a production transport.

## Structural changes and document generations

`lib/domain/collaboration/generations.ts` separates ordinary merged content
updates from structural changes. A server-owned document head has a workspace,
page, generation, revision and snapshot. Content updates must match the current
generation. Their adapter callback merges the engine update into fresh server
state and validates it; accepting a stale full-document replacement is forbidden.

A structural handler requires the exact acknowledged generation and revision.
It applies semantic intent, such as moving an identified block, to fresh server
content and advances both counters. Restore also advances them. Older clients
receive a conflict before their engine update is applied. Their complete local
branch remains available for recovery rather than being treated as saved.

This handles both observed move/edit orderings. If the writer commits first,
the stale move is rejected. A reviewed retry moves the current block with the
writer's text intact. If the move commits first, the old-generation writer is
rejected and retains its authored branch. The experiment in
`scripts/sync-spike-experiment.mjs` exercises both orders against the actual
production schema and real ProseMirror operations. Eight unit cases additionally
cover receipt identity, restore, stale generations, foreign references, immutable
failure handling and exhausted counters.

This is a reference protocol, not enforcement in the live provider. In
particular, raw CRDT structural updates must not bypass the structural handler.
Checking only the final JSON block order is insufficient: deleting and
recreating a container at the same position can also discard concurrent edits.
The provider must identify structural changes at the engine level, authenticate
the actor, validate the schema and size, and commit the head and receipt in one
transaction. Store idempotency receipts by actor, workspace, page and operation,
and recheck access before returning a replay. The current dispatcher does not
perform these new steps yet.

## Durable local outbox

`lib/client/collaborationOutbox.ts` stores immutable local branch snapshots and
binary engine updates in IndexedDB. Its append promise resolves only after the
transaction completes. Repeating the same operation and bytes is idempotent;
reusing an operation ID for different content fails. Separate tabs serialize
their writes through IndexedDB transactions and receive distinct sequence values.

Records are keyed by account, workspace, page and operation. These keys prevent
accidental mixing by the adapter; they are not a substitute for server
authorization or protection against code already running on the same origin.
Acknowledgement validates the actor/resource/operation identity, generation and
revision. Only a matching applied receipt deletes the branch. Stale receipts
retain it as a conflict. Rejected or failed writes never clear older commits.

Quarantine marks a revoked document's records as revoked. Normal recovery reads
then return no content, and metadata headers omit snapshots and binary updates.
New appends and receipt cleanup cannot bypass that quarantine. Explicit discard
is available; there is no automatic upload to another workspace, expiry or trim.
An authenticated UI for reviewing previously revoked drafts is not implemented.
Local storage is not encrypted, and remote revocation cannot retract bytes that
were already delivered to a device.

The journal allows 200 entries and 16 MiB of snapshot/update payload per document.
Each snapshot and update is limited to 900,000 bytes. Reaching a bound rejects
the new write and preserves existing records. The future UI must surface storage
failure and keep the pending branch; it must not claim a rejected append is
durable. Snapshot compaction, browser storage eviction and prolonged offline
editing still need an adapter-level design and tests.

## Repeatable browser proof

```powershell
pnpm exec playwright install chromium webkit
pnpm proof:outbox
```

The harness bundles the actual outbox module and opens a temporary loopback
origin with fresh browser profiles. It uses the complete editor corpus and
binary bytes, closes the browser, reopens the same isolated profile and checks
exact recovery. It also checks concurrent tabs, scoped lookups, conflicting
operation IDs, stale receipts, quarantine, explicit discard and bounded writes.
A synthetic quota exception tests transaction failure without filling the disk.
The profiles and report remain in a new `max-outbox-proof-*` OS temporary directory.
No personal workspace or cloud service is opened. CI runs both browser engines.

The proof uses graceful browser restart. It does not certify abrupt process
termination, power loss, storage eviction, real-device browsers or an
authenticated collaborative connection. Those checks, browser composition/IME,
move and restore gestures, role changes and live revocation remain required
before replacing the current editor save hook.
