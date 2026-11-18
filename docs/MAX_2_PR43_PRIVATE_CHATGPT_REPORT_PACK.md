# Max 2.0 — PR43/44: Private report pack and ChatGPT handoff boundary

**Status:** draft-only, stacked on PR42. AI-free runtime, no model or provider dependency, no rollout. Neither `main` nor `max-2.0` is changed.

## Included

- `buildMeetingReportPack`: a deterministic, bounded, validated aggregate over the PR42 private manual meeting-note registry for **one** authenticated workspace/database scope.
- Read-only `workspaceMeetingNotes.getMeetingReportPack` Convex query, reusing PR42's *current* workspace manager check and fail-closed row registry validation.
- UTC reporting window `[windowStart, windowEnd)`, at most 93 days. The query operates on at most 32 note rows with the existing over-cap denial guard.
- Counts: draft/archived inventory, upcoming/dated drafts, weekly/monthly passive recurrence labels, active-note open/done actions, overdue/due-in-window/undated open actions and archived historical action count.
- Deterministic, human-copyable Markdown output designed for **optional manual handoff to ChatGPT**, based exclusively on counts and server timestamps. No raw meeting, actor or workspace identifiers or free-form content appears in the output.
- Adversarial unit tests for time windows, inclusive/exclusive boundaries, corrupt/duplicate/overfull registries, cross-tenant scope and forbidden-content leakage.

## Security and AI-free boundary

This is **not a direct ChatGPT connector** and does not make any Max 2.0 workspace data available to the existing owner-only MCP server. The current MCP OAuth/token path is personal-workspace-only; reusing it for shared meeting notes without a delegated, current workspace-scoped identity would risk privilege escalation. The report query derives the actor from Convex auth and rechecks current manager ACL on every read.

The content of the report may be intentionally copied to a third-party assistant by an authorized manager. No automatic sending, fetch, model inference, transcript generation, external API call, cross-workspace aggregation, anonymous access, notifications, webhook, scheduler, task mutation, document edit, or calendar-provider integration is added.

All returned fields are deterministic numbers or fixed-format UTC timestamps; the Markdown is a fixed template with no user-controlled title, name, note, URL or arbitrary string interpolation. Archived action items are counted separately, **never** presented as active action work. This report makes no claim about attendance, unique viewers, actual meeting completion or company adoption.

## Flags (all default OFF)

- `MAX_V2_MEETING_REPORT_PACK_READS_ENABLED=true` plus `MAX_V2_MEETING_NOTES_READS_ENABLED=true` plus `MAX_V2_SHARED_DATABASE_READS_ENABLED=true`.
- Writes remain unchanged and disabled by default. Neither the report gate nor the meeting gate enables a shared-content or MCP gateway.

## Tests and release checks

Run exact-head `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:backup`, `pnpm build`, and Chromium/WebKit E2E with provider checks through CI. Unit tests cover domain behavior; **they do not certify a real Clerk + Convex two-account integration** or direct ChatGPT access.

Before enabling any report flag, perform isolated live tests with two independent Clerk identities: current manager, revoked manager, non-manager, guest, cross-tenant impersonation, malformed query, read-while-revoke race, and copying a sanitized report. Independently verify cloud backup/restore including attachment digests, retention/export policies, query costs, RTL/accessibility of any future UI, and audit and security review.

To add ChatGPT **direct** read-only access later, first ship a separately reviewed delegated OAuth/MCP integration that verifies current user and workspace scopes on every operation, supports revocation, records intentional external disclosure, enforces quotas and tests negative auth cases. Do not treat a successful legacy personal MCP token as a shared workspace permission grant.

## Rollback and blockers

Disable `MAX_V2_MEETING_REPORT_PACK_READS_ENABLED` first. The PR adds no table, migration, writes, jobs or retention tasks and preserves PR42 notes and existing personal/editor/MCP behavior. Rollback is removing the domain projection and read endpoint after turning the flag off.

PR43 is **not** release approval: parent stacked PR review, independent security review, live multi-account tests, cloud recovery, measured performance and retention, accessibility and baseline issue #42 reconciliation remain required. The configured CI dependency audit has `continue-on-error` and cannot establish vulnerability-free dependencies.
