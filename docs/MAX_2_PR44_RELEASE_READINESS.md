# Max 2.0 — PR44/44: release-readiness lock and evidence handoff

**Implementation milestone only. NOT permission to merge the outstanding stack, enable any feature flags, migrate customer data, or deploy.** This PR is stacked directly on PR43 (#73) and deliberately leaves main and max-2.0 unchanged.

## What this PR actually does

- Adds a dependency-free, offline release-evidence evaluator and a **locked** versioned evidence manifest. A release cannot be classified as ready without 44 created milestones, an exact commit SHA, 16 explicitly reviewed gates and a separate recorded approval.
- Adds automated regression tests for incomplete inventories, missing/extra gates, malformed evidence, stale commit SHA, self-review, false approval, and the default blocked state.
- Adds a dedicated GitHub Actions job that fails if the tracked manifest unexpectedly becomes approved or any gate is changed from pending. **A green job means the lock was preserved, NOT that Max 2.0 is release-ready.**
- Adds a conservative operator checklist and a separate command for evaluating proposed evidence. There is no credential handling, network request, deployment or feature activation.

## Running locally

- node --test tests/release/max-v2-release-readiness.test.mjs
- node scripts/max-v2-release-readiness.mjs --verify-locked
- node scripts/max-v2-release-readiness.mjs
- node scripts/max-v2-release-readiness.mjs --require-ready  (EXPECTED to exit nonzero for the current manifest)

Release decision script **does not query GitHub, Convex, Clerk, cloud storage, scanners, devices, or users**. All proof URLs and reviewer fields are asserted human inputs, not independently verified. Never confuse an eligible manifest with actual clearance. This PR does not install a production enforcement hook or branch protection.

## Independent release gates (all pending)

1. stack_integrity — Review all canonical PR diffs, dependency bases and branch integration order; check exact-commit CI and outstanding drafts.
2. baseline_issue_42 — Resolve https://github.com/iomarsuleiman/max/issues/42 with a per-file migration map. Do not wholesale-merge feat/max-v2-baseline.
3. independent_security_review — External code/threat-model review of tenant isolation, record permissions, uploads, shared access, privacy, and auth boundaries.
4. live_multi_account_auth — Exercise multiple distinct real Clerk principals with manager/member/guest/cross-tenant cases; no synthetic-only claims.
5. revocation_and_races — Concurrent revoke/read/write/invite/restore/meeting/report/permission checks in real Convex; deny stale sessions.
6. isolated_cloud_restore — Restore a fresh isolated Convex snapshot, map subjects safely and prove no live data overwritten.
7. asset_digest_integrity — Cross-check original versus restored asset hashes, dangling/denied URLs and orphan cleanup.
8. retention_export_and_deletion — Validate archival, retention, export and account/workspace deletion paths against agreed policies.
9. dependency_review — Review vulnerability advisories and lockfile; audit job currently uses continue-on-error, so a green CI audit is insufficient.
10. performance_and_cost_budgets — Measure query scans/index usage, payloads, realtime tab/offline behavior and limits on representative data.
11. rtl_accessibility_and_mobile — Keyboard/screen-reader and Arabic RTL tests on real supported desktop and mobile devices.
12. browser_and_offline_qa — Exact-head Chromium/WebKit browser/recovery test results, real provider and offline reconnection behavior.
13. mcp_and_ai_boundary — Verify legacy personal-owner MCP cannot read shared workspace or reporting data; no automatic ChatGPT transfer.
14. automation_execution_boundary — Prove rules/journal have no enabled worker, network side-effect, schedule or task mutation without reviewed authorization.
15. rollout_and_rollback — Phased release, explicitly owned flag inventory, kill switch, canary stop conditions, rehearsed rollback and user support.
16. privacy_and_consent — Verify minimal metadata, audit policies, manual third-party disclosure, consent and controlled incident process.

## How to record approval without overstating it

Each gate requires status=verified, verifiedForSha equal to the immutable release candidate SHA, an HTTPS evidence URL, distinct operator and reviewer handles, and a UTC review time. Once all gates are independently checked, a *separate* release-approval record may be considered. At that point the permanent PR-only release lock would require an explicit separately reviewed change; do not silently change this PR's default-blocked manifest to bypass CI.

Evidence must NOT include private tokens, raw clinical/customer records, user identity screenshots, unredacted attachments or passwords. Prefer test environment IDs, redacted operator notes, workflow links, digest summaries and independent review artifacts.

## Immediate disposition

- PR44 is draft, not merge-ready without its parent stack and review.
- Do NOT flip MAX_V2_* gates, NEXT_PUBLIC_MAX_V2_* gates, shared storage, link sharing or automation execution in deployed environments.
- No database migration, external AI transmission, push, email, webhook, or data write is introduced.
- Existing personal editor, notes and owner-only MCP continue unchanged.
- If a gate is unverified, **keep release blocked**. Fix and rerun validation on a new exact candidate SHA.
- Rollback: revert the read-only CI job, script, manifest, tests and documentation. No data restore or schema rollback is required by this PR itself.

**Roadmap accounting:** 44/44 planned PR *milestones created* after this draft is opened. This is NOT 44/44 merged, independently verified, production-ready or deployed.
