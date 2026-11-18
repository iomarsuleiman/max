# Max 2.0 — PR42/44: Manual meeting drafts and private reports

**Status: draft-only shadow foundation.** Directly stacked on PR41; neither main nor max-2.0 is changed. No production rollout or migration.

## Delivered

- A separate workspaceMeetingNotes shadow registry bound to an existing unique, live workspace database scope.
- Manual meeting title, scheduled date, optional HTTPS link, recurrence intention (none/weekly/monthly), participant display labels, agenda entries, decisions, and human-authored action items with due times and open/done status.
- Authenticated, manager-only list, read, create, replace and terminal archive operations. **The manager role is reauthorized against the live shared database on every operation**, including after revocation.
- Transactional scope-bound creation/edit/archive audits in workspaceSecurityEvents. Optimistic revisions reject stale edits and archive conflicts. An archived key is never reopened or recycled.
- A bounded manager-only meeting summary counts draft/upcoming/archived meetings and open/done action items, without user identities, free-text note bodies or tracking distinct viewers.
- Domain validators reject control characters, unsafe meeting links, invalid timestamps/statuses, malformed or cross-tenant records, duplicate keys and registry overflow.
- Unit coverage in tests/unit/workspaceMeetingNotes.test.ts for domain and reporting contracts.

## Non-execution and privacy boundary

**This is NOT a calendar system or automation runner.** Recurrence is a label, not a schedule. An action item is a manual text line, not a shared task, and updating its status never modifies workspace tasks. Meeting links are stored for manual use; no HTTP fetch, webhook, provider call, email or notification is made. There are no page-view counters, viewer fingerprints, meeting attendance inference, AI/LLM functions, actual document-body writes, auto-generated minutes, UI or MCP tools.

All participants are *unverified display labels*, not an identity grant or a verified meeting roster. Meeting content is only returned to a current **database manager**; guests and non-managers cannot view it, and other tenants' data must not be exposed. Never feed these labels into a permission engine.

workspaceMeetingNotes is not a generic shared-document table and cannot grant access to personal files or pages. The server accepts no actor IDs from clients and derives the actor from authenticated Convex identity. It uses a current, unique, active shared-database registration and current manager ACL, not a cached eligibility token.

## Default-OFF gates

- Read: MAX_V2_MEETING_NOTES_READS_ENABLED=true AND MAX_V2_SHARED_DATABASE_READS_ENABLED=true.
- Write: MAX_V2_MEETING_NOTES_WRITES_ENABLED=true AND MAX_V2_WORKSPACE_WRITES_ENABLED=true AND MAX_V2_SHARED_DATABASE_METADATA_WRITES_ENABLED=true.

These gates do not turn on rules, automation runs, scheduled work or shared editor routes.

## Resource and durability policy

- At most 32 meetings per workspace database in this initial foundation; all rows, including archived, count toward the cap.
- At most 12 each of participant labels, agenda entries, decisions and action items; individual strings are length-bounded, serialized meeting data at most 8,000 characters.
- No background retention/compaction, deletion, key recycling or pagination. Full registries are loaded with a one-row over-cap guard; corrupt data is denied entirely.
- No raw PII analytics, per-person metrics, or content in aggregate reports. Audit event metadata identifies a workspace/database and the currently authenticated operator, but never note bodies.
- A future retention plan must cover note text, display labels, links, audit events, exports, and guaranteed client-side cached-data invalidation on revocation.

## Verification plan

Run exact-head CI: lint, root and Convex typecheck, unit/backup tests, production build, standard Chromium/WebKit and available browser/provider checks. This implementation adds domain tests; it does not claim a real authenticated multi-user/Convex integration test.

Before any flag enablement, verify with **two real distinct Clerk accounts**, a cross-workspace impostor, revocation during a read and concurrent same-key writes, both stale and valid CAS updates, terminal archive, same-database scope spoofing, and corrupted duplicate registries. Repeat isolated cloud export/restore with attachment hashes. Measure 33rd-record rejection, query/cost budgets and RTL/a11y once UI exists.

Passing GitHub CI and a configured dependency-audit job is **not independent security approval**.

## Rollback and follow-up

Turn OFF the two meeting-notes flags first. Preserve shadow rows and associated security audits for review; do not destroy historical notes or reuse meeting keys. Rolling back the schema requires a reviewed data export and retention plan. Existing personal notes and production editor/MCP behavior are untouched.

Still required: authorized, explicitly designed conversion of a meeting action to a shared task; real recurrence/calendar flows; notifications; comprehensive page analytics and workspace reports; operator quotas; independently reviewed real automation execution; governance, MCP parity and full accessibility/performance/recovery gates. Baseline reconciliation is tracked separately in [issue #42](https://github.com/iomarsuleiman/max/issues/42) — **issue #42 is not roadmap PR42**.

This PR stays **draft, unmerged, undeployed** until its parent stack, security, identity, recovery, retention, performance and accessibility gates are satisfied.
