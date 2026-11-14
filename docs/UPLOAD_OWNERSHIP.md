# Upload ownership work in progress

The cloud UI and MCP upload flow now mints an owner-bound, expiring capability
through an authenticated action. The HTTP receiver measures actual bytes and
uses the native storage digest. Only its internal mutations can establish a
receipt. Caller-selected storage IDs cannot establish ownership.

Cloud `assets.register` consumes the receipt in the same native transaction as
the attachment insert, checks actual size/type, and rechecks destination scope.
Retries with identical attachment details return the existing asset only after
fresh authorization. Different destinations or metadata cannot reuse a receipt.
Direct and batched calls cannot obtain legacy raw cloud upload URLs.

The receipt state machine separates issued capabilities, receiving leases,
stored bytes, registered assets and claimed cleanup. Cleanup eligibility ends
before external deletion begins. Registered bytes cannot be claimed for cleanup.
The local adapter also persists owner-bound capabilities and receipts. Trusted
Notion transfers now create receipts from the actual stored bytes, and the item
commit consumes them while rechecking the current job lease and destination.

The internal cloud sweeper runs every fifteen minutes, with at most twenty-five
candidates from each indexed expiry category. It rechecks expiry, global asset
references and actual storage metadata in the deletion mutation. Registered
uploads are excluded. Stale or inconsistent candidates remain for operator
review without blocking independent candidates. Expired receiving tickets have
an additional twenty-four-hour grace period. No untracked file is swept.

Account deletion preflights up to 1,000 receipts and checks global attachment
references and actual native metadata before any file removal. It invalidates
outstanding tickets and removes owned receipt data inside the account mutation,
including a deletion invoked through a batch. Mixed/shared or inconsistent
references refuse deletion rather than removing another workspace's bytes.

On a failed completion, the HTTP receiver attempts trusted orphan adoption.
It preserves an already-completed receipt and records otherwise unreferenced
bytes in a cleanup-claimed receipt. It never deletes bytes after an uncertain
acknowledgement. Total process death immediately after storage, or account
deletion racing an already-leased receiver, can still require storage inventory
reconciliation. No automated inventory reconciler is enabled yet.

## Evidence from 2026-11-14

- Twelve transactional service cases and five native adapter cases cover owner
  isolation, concurrency, expiry, stale leases, registration rollback, authorized
  replay, contradictory indexes and cleanup exclusion.
- Registered cloud action/HTTP/operation tests exercise actual byte storage,
  foreign claims, forged metadata, repeat upload and registration requests,
  unauthenticated starts and direct/batched legacy URL denial.
- `pnpm proof:uploads-local` compiles and pushes to the explicitly selected
  anonymous local backend. Its loopback-only internal probe streams 1 KiB and
  exactly 50 MiB through the deployed HTTP receiver. Native size and independent
  digests match, retries retain the storage ID, foreign registration is denied,
  and both acknowledged synthetic files are cleaned up.
- The first 50 MiB experiment exhausted the runtime's 64 MiB memory budget.
  Replacing copied chunk accumulation with a bounded stream consumed directly
  into a Blob made the exact-limit proof pass. This proves the local runtime
  path, not concurrent cloud load, deployed latency or billing.

The raw HTTP approach follows the [Convex upload procedure](https://docs.convex.dev/file-storage/upload-files).
The documented [HTTP action limits](https://docs.convex.dev/functions/http-actions)
explain why avoiding multiple full body copies matters.

Existing personal attachment reads remain supported. Historical ownership is
not invented from old metadata. Local UI and MCP uploads now share the same
receipt flow, including restart before registration and rollback after a failed
disk save. Local deletion commits cleanup claims before removing physical files;
the next serialized operation resumes interrupted cleanup after restart. A
registered receipt can be retired only by the trusted deletion path after fresh
global reference and byte checks. Remaining references preserve their bytes.

Version-two local backups include receipt rows and validate their actual files.
Version-one nine-table backups remain unchanged. Rehearsal version two preserves
receipt fields exactly and verifies exact rollback; it does not enable migration.
Native authorized attachment deletion now removes obsolete receipts and bytes
in the same transaction, retaining files with valid remaining references. Failed
batches preserve both. Previously delivered public
storage URLs cannot provide immediate revocation; shared delivery needs fresh
authorization and cache isolation. Shared content remains disabled.
