# Max 2.0 — Cloud recovery drill and permission preflight

Status: **operator runbook; not an executed recovery**. PR 02 is a gated
engineering rehearsal. No production migration, shared-storage toggle or new
public authorization route is enabled by the policy/migration code.

## Preconditions and isolation

1. Use a disposable Convex deployment on an isolated project/team, with
   explicitly authorized operators and two **test Clerk accounts**. Never use
   actual personal customer data in a shared staging environment. If taking a
   production export, handle it as regulated confidential data; use an
   access-controlled recovery environment and document approvals first.
2. Record source deployment, UTC time, exact Git SHA, package lockfile,
   schema version, attachment count and a recovery owner. Store environment
   variables separately in a secure vault; Convex backups do not include them.
3. Confirm destination is disposable and **empty**. A restore/import can be
   destructive. Do not use `--prod` or `--replace` on the original deployment.
4. Freeze writes or arrange a consistent snapshot window if testing an app-level
   migration that spans external storage beyond Convex.

## Capture and verify

With the intended **source deployment** selected explicitly:

```sh
pnpm exec convex export --deployment <SOURCE_DEPLOYMENT> --include-file-storage --path max-cloud-source.zip
sha256sum max-cloud-source.zip
unzip -l max-cloud-source.zip
```

Record the ZIP checksum and verify `_storage/documents.jsonl` and the referenced
`_storage/<id>` file entries are present. Inspect `pages`, `documents`,
`assets`, `comments`, `versions`, `settings` and `tokens` in the archive as
applicable. Compare each file's actual length and SHA-256 with the `_storage`
metadata; reject missing bytes, mismatches and unanticipated extra file entries.
Verify IDs and references are consistent before and after restore, including
BlockNote block IDs and document revisions. The export contains sensitive
content, potentially including token hashes: encrypt it and restrict access.

## Restore to a disposable destination

Use a freshly provisioned, **empty, confirmed non-production** destination.
Record the destination name twice before entering the command:

```sh
pnpm exec convex import --deployment <EMPTY_DESTINATION_DEPLOYMENT> max-cloud-source.zip
```

No `--replace` is needed for an empty target. Run the current matching Max
backend only against the restored destination; never point production Clerk
credentials or production callbacks at the recovery instance.

Acceptance tests (record actual counts and evidence, not just green checkboxes):

- Count pages, databases, notes, comments, history versions and assets by owner.
  Compare source snapshot counts and stored IDs without redistributing owners.
- Download representative restored bytes using the normal **authorized Max
  asset route**, compare SHA-256 and declared MIME type, then deny the same
  request from another Clerk account and a revoked account.
- Verify owner A cannot read owner B's pages through UI, Convex operations,
  direct link, MCP, asset access, search, graph, export or history.
- Check bilingual documents and BlockNote custom blocks, stable block IDs,
  document revision numbers and no duplicate account workspace mapping.
- Exercise rollback on this disposable copy. Verify original source deployment
  and saved original export remain unchanged throughout.

## Permission contract, rollout and evidence

`lib/domain/workspacePolicy.ts` is a **pure policy contract**, not a replacement
for server-side enforcement. It defaults to deny; membership suspension or
revocation denies access; teamspaces require membership; hierarchy cycles,
missing parents and cross-tenant ancestry deny access; explicit inherited deny
wins over allow. The implementation is intentionally not wired to Convex/UI/MCP
until the follow-on authorization rollout is reviewed.

`lib/domain/migrationRehearsal.ts` validates a consistent supplied snapshot and
returns a deterministic **dry-run** with the original IDs and a reversible
owner-to-personal-workspace mapping. It does not modify any storage. The real
migration must implement backfill, checkpointing, idempotent resume, rollback,
old-tab compatibility and verified writes in separate PRs.

Keep shared storage disabled by default. Grant precedence changes must undergo
multi-account adversarial review before any shared feature is enabled. Never
report a cloud recovery as verified until the isolated restore and authenticated
checks above have actually been run with recorded checksums and screenshots.

## Performance and visual checkpoint

Before rollout, capture timestamp, host/OS, browser build, theme, direction,
viewport size, data volume and cold/warm status. Measure at least 20 runs each
for warm route-to-editor usable, sidebar interaction, editor input latency,
search and autosave acknowledgment. Record p50, p95, failures, heap and Convex
request counts. Follow `docs/PERFORMANCE.md` budgets; targets are not results.

Capture Chromium/WebKit screenshots in wide desktop (1440 × 900), narrow
(1024 × 768) and mobile (390 × 844) for light/dark and RTL/LTR. Keep raw traces,
screenshots and a regression comparison in CI. Perform manual focus-return,
200% zoom, reduced-motion and screen reader checks. No scores are claimed here.

## Operator release record

- Source deployment + commit:
- Restore destination + approval:
- Captured ZIP SHA-256 + document/file counts:
- Cloud recovery and attachment integrity result:
- Authenticated cross-account isolation and revocation result:
- Migration dry-run plan/rollback evidence:
- Visual and performance baselines + links:
- Remaining blockers and sign-off:
