# Connections, migration and profile cards

- [x] Read saved Max MCP audit, Notion import plan and acceptance checklist.
- [x] Inspect source and create editable design before implementation: https://www.figma.com/design/6KtVd71Naz7oFt4fJO73HA.
- [x] Implement secure, owner-scoped Notion connection and resumable copy import.
- [x] Add source picker, destination, review, progress, history and report UI.
- [x] Expose safe Notion operations through MCP and regenerate inventory, 95 tools.
- [x] Add customizable private profile card onboarding and account editing.
- [x] Add connection outcome and app error/recovery pages.
- [x] Add explicit MCP card read/update/export parity, including PNG export.
- [x] Revise landing page with draggable, inertial Max logo using existing colors.
- [x] Add optional offline game and restrained tab/switch/navigation motion.
- [x] Verify the final Arc-style landing revision: monochrome logo, no topbar/toggle/helper text, system theme, static 1,160-byte texture, sticky interactive walkthrough and dark recovery surfaces.
- [x] Verify conversion, ownership, retries, cancellation, UI accessibility and regressions.
- [x] Review diff, publish PR and merge after checks pass, PR #6.

## Constraints and evidence

- Imports are copies. Notion originals are never changed; OAuth consent remains browser-owned.
- Figcraft was absent from available tools, plugin search and local skill inventory. Figma is the available design fallback.
- User subsequently asked to stop using Figma. Further design work uses supplied screenshots/videos and running app directly.
- Screenshot localhost callback pages are owned by the MCP client, not this repository. Max can supply its own branded outcomes/help, but cannot restyle another process's callback handler.
- Direct Notion imports require configured provider credentials and durable Convex backend; live authorization must be verified separately from fixture tests.
- Completion checks: lint, both TypeScript projects, unit suite, production build, targeted browser journeys, generated MCP inventory parity, clean reviewed diff and required PR checks.

## Verification

- 72 unit/integration tests pass, including real Convex schema/store/worker execution against mocked Notion responses, durable attachment ingestion and link repair.
- Both TypeScript projects and ESLint pass. Production build succeeds.
- All 21 browser tests pass from a fresh workspace, including accessibility, desktop/mobile regressions, card PNG export, Notion wizard/report, reduced motion, network-offline fallback/game, system-only landing colors, sticky walkthrough and texture budget. Public help themes persist across reload; the landing intentionally follows the system.
- Convex functions/schema deploy successfully to an isolated anonymous local backend; internal read smoke test succeeds. This does not validate live Clerk or Notion authorization.
- Existing first-sign-in redirect now preserves Settings query parameters, verified with the Notion journey from a fresh workspace.
- Production OAuth credentials remain an operator setup step, documented in docs/NOTION.md. Unsupported conversions and import bounds are disclosed in preview/reports and documentation.

## v1 polish and release
- [x] Merge dark grain and initial logo fix as PR #7.
- [x] Redesign compact membership cards, shuffle, QR foil and motion.
- [x] Improve mobile editor toolbar, keyboard viewport and touch flows.
- [x] Verify no horizontal page scrolling, local wide-content scrolling and touch block actions, Chromium and WebKit.
- [x] Add spinner inertia, distinctive sans hero and optional game audio.
- [x] Run release checks: production build, ESLint, both TypeScript projects, 72 unit tests and all 28 browser checks.
- [ ] Merge release PR and publish v1.0.0 after GitHub checks.

## Final v1 presentation pass
- [x] Merge production-only deployment policy, PR #9.
- [x] Diagnose outline/cover overlap and clipped sidebar titles; add bounded regressions.
- [x] Inspect Arc's public interaction code and implement angular touch physics for Max.
- [x] Capture real editor, graph, card and sidebar screens from disposable sample notes, light and dark.
- [x] Verify the shorter serif hero, scalloped section edge and sticky clipped screenshots.
- [x] Unify workspace/card Name, remove About you, add 12 palettes, curved-band artwork, artwork-only grain, dated hatch stamp and QR-module foil.
- [x] Final verification: production build, both TypeScript projects, ESLint (existing warnings only), 81 unit/integration tests, and all 30 browser cases (29 full-suite passes plus corrected Arabic-name assertion rerun).
- [ ] Merge the final presentation PR after GitHub checks.
- [ ] Publish v1.0.0, then begin phase 00 of the saved Max Collaboration 2.0 plan.

## Max 2.0

- [x] Read the saved collaboration plan and phase 00 acceptance criteria.
- [x] Create a source-history backup before v2 changes.
- [x] Add snapshot and export/import recovery regression checks.
- [x] Record current boundaries and recovery limits in docs/MAX_2_BASELINE.md.
- [x] Add the full block corpus, damaged/oversized recovery and relation-copy checks.
- [x] Fix JSON restore reference mapping without rewriting authored text or block IDs.
- [x] Add full local backup/verify/restore commands and eight filesystem tests to CI.
- [x] Restore a stopped synthetic instance and verify 22 documents and 28 attachment downloads.
- [x] Reproduce and fix WebKit's RTL auto-margin overflow with a browser regression.
- [x] Finish corpus keyboard/accessibility checks and full browser regression after the audit fixes: 33 browser cases pass, including Chromium and WebKit.
- [ ] Complete remaining phase 00 gates listed in the baseline before shared storage.

## Max 2.0 continuation, 2026-11-11

Requested outcome: finish the saved collaboration plan, preserving the existing
editor and personal/local mode. Completion requires all phase gates, UI/MCP
parity, tenant/revocation abuse checks, two-client sync tests, release budgets,
and an actual staged pilot. This checklist records evidence, not implied release
readiness.

- [x] Retrieve the current saved plan and phase 00/01/04 requirements.
- [x] Exercise isolated Convex backup/restore, including attachment bytes. New expiring source/target only; deployed operations and storage verified with synthetic identities. Live Clerk login remains untested.
- [x] Record reproducible navigation/editor/bundle/memory baseline measurements. Synthetic local production build, not deployed Web Vitals or real-device certification.
- [x] Define and adversarially test the workspace/page permission matrix, 117 pure evaluator cases. Live adapters are not wired yet.
- [x] Implement a deterministic, non-destructive personal-workspace migration rehearsal with validation and reverse mapping.
- [x] Fix reproduced search focus loss; desktop/mobile Chromium and mobile WebKit regressions pass.
- [x] Replace destructive shell-specific browser setup with a portable runner and unique synthetic workspaces.
- [x] Save and repeat 48 platform-specific viewport tiles for the full editor corpus, zero changed pixels in a fresh repeat. Audit every viewport and fix bookmark-title and embed-caption target sizes.
- [x] Reproduce native Yjs v13/v14 and OT move-versus-edit loss with the production schema; retain the failing diagnostic.
- [x] Prove generation barriers preserve text or explicit conflict branches in both move/edit orders; do not enable an unenforced provider.
- [x] Add a committed-transaction IndexedDB outbox and real Chromium/WebKit restart, scope, receipt and quarantine proof.
- [ ] Run regression checks and review final artifacts.
- [ ] Close remaining external gates: live Clerk/browser recovery path, human assistive-technology/usability checks, deployed budgets and Wareed pilot.
- [ ] Implement and release phases 01–14 after their prerequisite gates pass.

## Workspace implementation, 2026-11-13

- [x] Implement transactional workspace/member/invitation/group/teamspace service, 37 adversarial cases.
- [x] Add indexed Convex metadata schema/adapter and native integration cases; keep public endpoints and existing content dispatch unchanged.
- [x] Reject contradictory duplicate membership keys and prevent archived-group history from blocking revocation.
- [x] Push schema/functions to the anonymous local verification backend and run a read-only sixteen-index probe, preserving the app's env configuration.
- [x] Classify every current UI/MCP/connector operation and default-deny unknown names, with exact registry-coverage tests.
- [x] Compose native page ACLs with fresh actor/group/teamspace/ancestor authorization; extend the local read-only probe to eighteen index paths.
- [x] Protect legacy UI/MCP and Notion content dispatch with personal-only scope, including creator-owned organization rows and untagged linked children. Refuse unsafe cached replay and mixed-scope account deletion.
- [x] Exercise authenticated Convex personal gateway denial and unchanged personal creation through actual registered functions.
- [ ] Add authenticated gateways, personal backfill and shared content authorization to all declared operations.
- [ ] Add the workspace shell and complete the collaboration feature inventory in the saved plan.

## Verification checkpoint, 2026-11-14

- [x] Verify the personal-only native gateway and nested deletion ordering, including account deletion inside a batch.
- [x] Exercise native teamspace revoke/rejoin, mixed-teamspace ancestry and database-record inheritance; malformed database parents deny access.
- [x] Repeat all 36 browser tests and compare all 48 corpus tiles, zero changed pixels.
- [x] Run the production build and complete check suite, with no new lint errors. Repeat anonymous local compile/deploy and eighteen-index probe.
- [x] Remove unsafe deletion of caller-selected storage bytes during registration validation and add a regression.
- [ ] Bind new uploads to authenticated ownership receipts before shared file access. Existing personal attachment reads remain supported; supplied storage IDs alone are not ownership proof.

## Upload ownership continuation, 2026-11-14

- [x] Add a transactional receipt state machine and native indexed adapter with authorized replay and cleanup exclusion.
- [x] Route cloud UI/MCP uploads through authenticated actions and a capability HTTP receiver; consume actual-byte receipts during registration.
- [x] Deny direct and batched legacy raw cloud URL creation and arbitrary storage claims.
- [x] Reproduce and fix 50 MiB receiver memory exhaustion; repeat the deployed loopback exact-limit/digest/retry/owner-denial proof.
- [x] Invalidate upload capabilities during account deletion, including batch calls; preflight global references before file removal.
- [x] Record trusted orphan cleanup claims after completion errors while preserving committed receipts.
- [ ] Complete local/Notion receipt persistence, automated bounded cleanup and crash/account-wipe inventory reconciliation.
- [ ] Implement fresh shared-file delivery authorization and cache isolation before enabling shared content.
- [x] Fix local disk-save failure rollback and persistence queue recovery; serialize token updates and reads with writes.
- [x] Defer local physical file deletion until database commit so failed batches preserve actual bytes. Write file metadata before making new binary files visible.
- [ ] Persist post-commit deletion cleanup work before physical deletion, including restart/crash recovery.
