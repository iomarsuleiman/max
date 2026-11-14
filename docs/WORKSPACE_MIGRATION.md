# Personal workspace migration rehearsal

The rehearsal builds and validates an additive copy of a verified local backup.
It cannot migrate a running app or enable sharing. Live adapters still accept
the v1 single-owner schema. Finish phase 00 and isolated cloud recovery before
schema expansion or shared storage rollout.

```powershell
pnpm backup:local create --source C:/Max/data --destination D:/Backups/max-before-v2 --stopped
pnpm exec tsx scripts/workspace-rehearsal.mjs plan --backup D:/Backups/max-before-v2 --destination D:/Backups/max-v2-rehearsal
pnpm exec tsx scripts/workspace-rehearsal.mjs verify --artifact D:/Backups/max-v2-rehearsal/artifact.json
```

The destination must be new, outside the backup, with an existing parent.
An interrupted run may leave partial files. Keep the backup and retry into a new
destination. The source backup is verified before and after the rehearsal.

`expanded.json` contains unchanged v1 tables plus proposed personal workspaces
and owner memberships. Pages, documents, assets, versions and comments receive
workspace IDs. Account settings, credential hashes, account activity and retry
receipts retain their account scope. Existing credentials do not gain any
organization access. Workspace IDs are deterministic rehearsal identifiers,
not Convex document IDs; cloud migration must persist the actual ID mapping.

`artifact.json` records the exact original snapshot, both checksums, per-table
counts and owner-to-workspace/membership mapping. Verification recomputes the
whole transformation, including mappings, rather than trusting stored checksums.
This detects accidental corruption; it is not an authenticated signature.
The artifact and rollback snapshot contain private data and credential hashes.
Keep them under the same access controls as the backup. POSIX permissions are
restricted when supported; Windows access follows the parent directory's ACL.

`rollback.json` is byte-for-byte identical to the backed-up database. It is not
a complete backup by itself. Attachment bytes and MIME sidecars remain in the
verified full backup. Never point the current app at `expanded.json`.

The planner rejects unknown or missing tables, duplicate IDs, broken or
cross-owner parent/page references, hierarchy cycles, invalid document content
or revisions, and already scoped rows. Custom block JSON and storage references
remain unchanged. An empty personal workspace is derived for every account
found in any table, including accounts with only settings or credentials.

The pure apply/rollback helpers accept only the exact original or expanded
snapshot. Retries converge to the same result. A changed snapshot causes an
error instead of discarding work. Production rollback after new edits requires
a separately tested reconciliation process and retained original application.

Run `pnpm exec vitest run tests/unit/workspaceMigration.test.ts tests/unit/workspaceRehearsalCli.test.ts`
to repeat the corpus, ownership, corruption, idempotency, CLI and rollback checks.
Cloud Notion tables, Convex `_storage`, live subscriptions and production
cutover are outside this local snapshot format. Their migration needs its own
schema expansion, checkpointed backfill, shadow-read validation and recovery
drill. No rollout flag currently enables unfinished sharing.
