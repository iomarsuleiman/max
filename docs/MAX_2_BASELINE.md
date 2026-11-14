# Max 2.0 implementation baseline

Started 2026-11-10 from `0508fb4`, on `feat/max-v2-baseline`.
Source scope: the saved Max Collaboration 2.0 plan and its phase 00 checklist.
The user's request to start implementation authorizes this work. The saved
document's earlier planning-only status is historical.

## Current gate

Phase 00 is in progress. Shared storage and migrations must wait for its exit
criteria. Keep the existing editor, personal mode, local drafts, Arabic/English
support and UI/MCP parity. The runtime remains AI-free.

## Existing boundaries

| Concern | Current authority | Migration implication |
| --- | --- | --- |
| Rows and indexes | `lib/domain/types.ts`, `lib/domain/db.ts`, `convex/schema.ts` | Domain rows use `ownerId`; Notion `workspaceId` is an external provider ID, not a Max workspace. |
| UI and MCP operations | `lib/domain/ops/index.ts`, `define.ts`, `convex/ops.ts`, `lib/server/executor.ts` | Derive identity server-side and keep a single operation registry. |
| Content access | `lib/domain/ops/helpers.ts`, `requirePage`, `allPages` | Replace owner assumptions through one policy boundary before permitting shared content. |
| Assets | `lib/domain/ops/account.ts`, local and cloud file routes | Asset URLs and file bytes need the same workspace policy as their pages. |
| Discovery | Search operations, graph operations, sidebar tree | Filter at the server boundary, including backlinks and counts. |
| Local persistence | `lib/server/local.ts`, `lib/domain/memoryDb.ts` | JSON snapshot, serialized writes and atomic rename; attachments live separately in `files/`. |
| Editor schema | `components/editor/blocks.tsx` | BlockNote defaults plus custom heading/code/image, callout, equation, YouTube, diagram, page link, bookmark, TOC, embed and database view; page/date mentions and multi-column support. |
| Paste and links | `components/editor/policy.ts`, editor paste handling | Preserve sanitation and upload bounds when adding a sync adapter. |
| Save and recovery | `components/page/useDocumentSync.ts` | Preserve 650 ms debounce, local draft, acknowledged save, retries, revision conflict and explicit recovery choices. |
| History and comments | Domain versions/comments modules | Owner scoping must become policy-aware; stable block IDs remain essential. |

## Backup and rollback

A source-history bundle was created outside the repository at
`../max-v1-before-v2.bundle`. Verify it with
`git bundle verify ../max-v1-before-v2.bundle`. It contains committed source,
not ignored files, secrets, local data or cloud data.

`tests/unit/migrationBaseline.test.ts` exercises a representative nested,
bilingual workspace through exact snapshot restore and JSON export/import.
The exact snapshot retains row IDs, document revisions and content; JSON
import creates new page IDs and leaves originals intact. The tests also check
owner separation. This is a synthetic recovery drill, not a production backup.

`pnpm backup:local` now provides full local backups with checksums and attachment
bytes. See [Local backup and restore](LOCAL_BACKUP.md). A stopped synthetic
instance was backed up and restored into a new directory, verifying 57 files.
The restarted recovery app returned all 22 original documents with unchanged
revisions and all 28 attachment downloads with identical bytes and MIME types.
The independent filesystem suite covers corruption, missing/extra files,
traversal, links, overlapping paths and refusal to overwrite existing data.

JSON export is a content copy, not a complete disaster-recovery image. Import
does not restore settings, history, comments, credentials or attachment bytes,
and skips archived pages. Preserve a stopped local instance's entire
`MAX_DATA_DIR`, including `files/`, before any migration. Restore into a separate
directory and start with `MAX_LOCAL_MODE=true` and `MAX_DATA_DIR` pointing to
that directory. Never overwrite the sole original. Cloud data and file backup
must be validated separately before a cloud migration can run.

## Decisions for the next phase

- A workspace owns content; an account is a member. Personal and organization
  workspaces coexist. Teamspaces, groups and databases remain separate concepts.
- Keep BlockNote JSON canonical until the transport proof of concept establishes
  a lossless alternative, including custom blocks, IDs and offline recovery.
- Compare transport candidates during phase 04. No transport is selected here.
- Shared features stay disabled until server policy, revocation and tenant abuse
  tests pass. Hiding controls is insufficient authorization.
- Migration must be repeatable, retain originals and provide a reverse mapping.

## Remaining phase 00 work

- Cloud recovery evidence is now recorded in [CLOUD_RECOVERY.md](CLOUD_RECOVERY.md).
  Live Clerk/browser and Next.js attachment-proxy checks remain separate.
- Platform visual baselines now cover narrow/wide desktop, mobile, both themes
  and RTL with 48 viewport tiles. A fresh repeat had zero changed pixels.
  Automated focus, reduced-motion and CSS reflow checks
  pass; screen-reader and native browser zoom checks still need human evidence.
- Local navigation, editor latency, memory and bundle samples are recorded in
  [V2_MEASUREMENTS.md](V2_MEASUREMENTS.md). A bounded cloud subscription sample
  is in the recovery report. Deployed Web Vitals and real-device budgets remain
  unverified.
- Grant precedence is defined and tested in
  [COLLABORATION_POLICY.md](COLLABORATION_POLICY.md). Finalize post-revocation
  draft behavior from
  [the collaboration ADR](adr/0001-collaboration-boundaries.md); specify rollout
  flags, staging data and cloud operator commands.
- Internal usability pass and manual assistive-technology verification.

## Recovery and editor regression coverage

- `tests/fixtures/editor-document.json` covers all default BlockNote block types,
  Max's custom blocks, nested columns/lists, both table-cell representations,
  text styles, links, page/date mentions and attachment references. The unit
  check compares the corpus against the installed default block registry so an
  added upstream block requires a fixture update.
- Unit checks cover save/export/restore, stable IDs, oversized-write rollback,
  incomplete blocks, duplicate IDs and non-destructive reads of damaged JSON.
- Restore now remaps actual references rather than arbitrary matching strings.
  Regression cases preserve prose, code, block IDs and external URLs, while
  remapping page mentions, slugged links, database relations, values and filters.
- The real-editor journey edits and reloads the corpus, verifies its properties
  and IDs, exercises toggle keyboard controls, audits accessibility, and captures
  narrow/wide, light/dark and RTL reference images in `test-results/`. These are
  diagnostic captures, not committed cross-platform visual comparison baselines.
- BlockNote upgrades legacy table inline arrays to explicit table cells. Browser
  comparisons apply equivalent defaults while checking content, styles, spans,
  widths and nesting. The persisted schema stays BlockNote JSON.

The corpus revealed unnamed toggle/language controls, an invalid diagram loading
label, muted checklist text and insufficient table-link spacing. Fixes are
covered by the corpus keyboard and axe checks. Named highlight colors use Max's
light/dark palette. Inline database toolbar buttons retain accessible names when
their labels are hidden on phones. Media bytes are synthetic; iframe content is
stubbed, so this does not certify media playback or third-party embeds.

No production migration, preview deployment or shared storage change is included
in this starting slice.

## Verification, 2026-11-11

- 94 unit/integration cases pass, including UI/MCP parity and recovery fixtures.
- Eight filesystem backup checks pass. The separate restarted-app recovery drill
  verified the document revisions and attachment downloads described above.
- All 33 browser cases pass against a fresh local workspace: desktop Chromium,
  mobile Chromium and mobile WebKit. The corpus checks WCAG 2.2 AA rules and
  keyboard toggles in all four layout/theme/direction combinations.
- Production build and both TypeScript projects pass. ESLint reports no errors;
  38 existing warnings remain in the application.
- Offline installation from the frozen lockfile succeeds. Package patch files
  use LF endings so their recorded checksums stay stable across platforms.
- CI now runs backup checks and retains browser artifacts on successful runs as
  well as failures. The initial baseline did not modify cloud deployments or
  production data. The continuation below uses separate disposable cloud data.

## Continuation evidence, 2026-11-11

- A real cloud backup/restore drill used two new, expiring, nondefault development
  deployments. Archive comparison retained 15 tables, 32 rows including metadata,
  and two files byte-for-byte. Independent read-only rechecking of the deployed
  operations confirmed corpus/IDs/revisions, anchored comments, database rows,
  archive state, attachment bytes/MIME and seven cross-account denials. The
  existing Max development and production deployments were unchanged. See
  [the exact scope and authentication limits](CLOUD_RECOVERY.md).
- The pure permission evaluator has 117 adversarial capability cases. It is not
  connected to the operation dispatcher and does not authorize shared reads.
- The [workspace migration rehearsal](WORKSPACE_MIGRATION.md) derives stable
  personal-workspace mappings, preserves original rows and document bytes,
  rejects invalid/cross-owner ancestry, verifies artifact integrity, and proves
  exact rollback. Its expanded format is not accepted by live storage adapters.
- Search dismissal now restores keyboard focus to the editor without taking it
  from a newly opened Settings dialog. All 36 browser cases passed across
  desktop/mobile Chromium and mobile WebKit. The browser runner now uses a new
  synthetic workspace per run and works without shell-specific recursive deletes.
- Local measurements and full-corpus visual references have reproducible tools
  and explicit environment limits. They do not certify a collaborative release.

The application remains on its existing single-owner storage and save protocol.
No production migration or shared-access rollout has occurred. Phase 00 is not
declared complete while the remaining checks above lack evidence, and later
phase groundwork must not be mistaken for a shipped Max 2.0.
