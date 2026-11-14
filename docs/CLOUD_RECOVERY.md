# Isolated Convex recovery drill

This drill is a prerequisite for a cloud collaboration migration. A local
anonymous Convex instance does not prove cloud recovery. Neither does a mocked
Convex test or Max's JSON content export.

The snapshot layout and retained IDs follow Convex's
[backup documentation](https://docs.convex.dev/database/backup-restore) and
[import documentation](https://docs.convex.dev/database/import-export/import).

## Required setup

Use two disposable **cloud development deployments** with synthetic data only.
Record their full deployment references and verify both in the dashboard before
running any import. Neither may be production, a production alias, or the only
copy of real data. Deploy the same application commit and schema to both.
Deployment keys belong in the operator's environment, never this document,
command arguments copied into reports, or Git.

Seed the source through Max with nested bilingual pages, database rows and
relations, comments, history, archived pages and at least two binary attachments.
Include a second synthetic account to exercise tenant separation after restore.
Stop synthetic clients and workers during the drill so row changes do not make
the source and restored exports incomparable. Preserve a source archive outside
the repository and do not import into the source.

## Commands

Replace `team:project:source-development-reference` and
`team:project:empty-target-development-reference` below with the verified
disposable references. The target must be empty. The default import mode refuses
nonempty imported tables; do not add `--replace`, `--replace-all`, or `--yes`.

```powershell
pnpm exec convex export --deployment team:project:source-development-reference --include-file-storage --path C:/MaxRecovery/source.zip
pnpm exec convex import --deployment team:project:empty-target-development-reference C:/MaxRecovery/source.zip
pnpm exec convex export --deployment team:project:empty-target-development-reference --include-file-storage --path C:/MaxRecovery/restored.zip
node scripts/cloud-recovery-verify.mjs C:/MaxRecovery/source.zip C:/MaxRecovery/restored.zip
```

The read-only verifier compares every exported table's rows, including IDs,
revision values, document JSON and private metadata. Row ordering and JSON key
ordering do not affect the result. Attachment bytes must match exactly. Missing
storage metadata or file bytes fail verification. No archives are extracted and
no credentials or document contents are printed. It handles archives up to
512 MiB compressed and 1 GiB expanded, with at most 100,000 entries; larger
workspaces need a streaming verifier before the drill can be certified.

After archive comparison, start Max against the target deployment only. Sign in
as each synthetic account. Read all documents, compare stable block IDs and
revisions, and download every attachment through the authenticated application
route, comparing SHA-256 and MIME type. Confirm each account cannot read the
other's pages, history or attachments. Test one edit, refresh and history restore
on the target. An archive comparison alone does not prove these application
behaviors, schema deployment, Clerk configuration, scheduled jobs, provider
secrets, or OAuth connections.

Keep a sanitized report with source commit, deployment types, timestamp, export
hashes, verifier counts, application checks and rollback outcome. Store archives
and credentials privately. Do not commit exports. A cloud migration gate passes
only after both archive and application checks succeed.

## Evidence, 2026-11-11

An actual isolated cloud drill passed using two newly created, nondefault cloud
development deployments under `omar-suliman:max`, with one-day expiration:

- Source `dev/max-recovery-source-20261111`, deployment `rare-gnat-409`.
- Target `dev/max-recovery-target-20261111`, deployment `rare-hound-549`.

Both received the checkout's Max schema/functions. The source was seeded only
with synthetic data. Existing development `patient-hyena-219` and production
deployments were not modified. A supplied name ending in `212` was not accessible;
authenticated project metadata identified the development name ending in `219`.
The deployed schema/functions match source commit
`e58c5159c7227c072b23f6f726376c9f02ee78e2`; no `convex/` source changes were made
for this drill.

Export/import preserved 15 exported tables, 32 rows including `_tables` metadata,
and two binary files totaling 37 bytes. The verifier compares storage bytes,
table-number mappings, generated Convex type metadata and all document fields.
The cloud archive contains `README.md` and `_tables/documents.jsonl`, covered by
the verifier's fixtures. Export order and archive timestamps may differ, so the
two ZIP hashes need not match even when all data does.

Source ZIP SHA-256:
`d082e1739a403a4eef85e78db1aa078a22364318732fca6e82faa4f8a1a3e0bd`

Restored ZIP SHA-256:
`4e09542065161b698644a5a1f0d773b668a968434705f893f4dca96e682aad4d`

Deployed Max operations verified the full editor corpus, exact document/block
IDs and revisions, nested bilingual pages, database record membership, archived
content, anchored comments and saved history. Two files downloaded with their
original bytes and MIME type. Seven cross-account reads were rejected. A
target-only edit, re-read and history restore succeeded, and a final source read
confirmed it was unchanged.

These application checks used Convex administrator identity impersonation with
two synthetic subjects. They exercised the deployed `ops:query`/`ops:mutation`
authorization and storage paths, not live Clerk login, browser rendering or the
Next.js attachment proxy. The document corpus includes synthetic media references;
this drill does not certify playback or external embeds. Cloud workspace migration
and collaborative transport are still separate gates.

The bounded harness is `scripts/cloud-recovery-drill.mjs`. It only accepts the
two disposable deployments above, verifies their project, type, nondefault status
and reference before obtaining credentials, and never prints keys. Its `seed`,
`restore` and `verify` modes retain archives, a private manifest and sanitized
reports in the supplied directory. `seed` refuses previously seeded synthetic
accounts; `restore` uses the default empty-table import and refuses to replace
existing tables. `inspect` repeats remote reads and downloads without changing
the deployment after the edit/restore verification. For an independent check:

```powershell
node scripts/cloud-recovery-verify.mjs "$env:TEMP/max-cloud-recovery-20261111/source.zip" "$env:TEMP/max-cloud-recovery-20261111/restored.zip"
node scripts/cloud-recovery-drill.mjs inspect "$env:TEMP/max-cloud-recovery-20261111"
```

After expiration, provision another isolated pair and update
the explicit harness deployment allowlist before another drill.

The private artifacts were retained outside Git in
`%TEMP%/max-cloud-recovery-20261111`. The CLI generated `.env.local` for each
disposable deployment during schema push. These files were moved into the private
artifact directory afterward, restoring the checkout's original lack of
`.env.local`; `.env.convex-verification.local` still selects anonymous local mode.

The verifier's four synthetic ZIP tests additionally cover ordering, changed
IDs/revisions/type metadata, missing tables, extra rows, altered/missing file
bytes, malformed JSON, duplicate row IDs and unsafe paths.

Run its independent test suite with:

```powershell
node --test tests/cloud-recovery/snapshot.test.mjs
```

## Cloud traffic sample

The `traffic` harness mode measured two real reactive subscriptions against the
synthetic cloud source, page tree and full corpus document. Initial delivery
took 431 ms and sent three WebSocket frames totaling 728 bytes, including auth
and query registration. It received two frames totaling 7,971 bytes. Both query
callbacks fired once. During the subsequent ten-second idle window, zero frames,
bytes or query callbacks were observed in either direction. Both disposable
deployments reported empty Convex health insights.

This is one synthetic sample of WebSocket payloads, excluding TLS and HTTP
overhead. Authentication uses administrator identity impersonation. It is not a
browser, production-load, billing or live-Clerk baseline. No document writes run
in `traffic` mode. The connection and subscriptions are closed after measurement.
The sanitized receipt is `%TEMP%/max-cloud-recovery-20261111/traffic-report.json`.
