# Max 2.0 — PR 24/44: Ephemeral room presence and awareness

Draft, experimental only. Stacked on PR23/#52. Main and the max-2.0 integration branch remain untouched. No production editor, personal notes, root Convex schema, existing Yjs update log, migration or MCP behavior changes. Separate baseline integration remains issue #42.

## Implemented
- A new labPresence table in the disposable PR17 Convex schema, separated from durable Yjs text and checkpoint history.
- Server-authenticated publishPresence, listPresence and stopPresence functions within the isolated provider. Every call requires the current Clerk/Convex session and live page authorization. Editing status additionally requires live edit permission.
- Server-controlled 20-second TTL, privacy/invisible deletion, explicit removal, room cap 64 and pruning on future writes. A closed, expired, revoked or cross-room lease never yields visible presence. Live permission checks prevent exposing a revoked participant to others.
- Minimal payload: authenticated account ID, viewing/editing mode, validated stable block ID and numeric selection range, expiry. No note text, emails, names, avatar images, document content or user-provided role/grants.
- Unit regressions using distinct simulated identities, impersonated session, guest editing, malformed selection, privacy deletion, TTL expiry/pruning, revocation, downgrade and close/disabled flag.

## Limitations, release gates and rollback
This is a server-side foundation ONLY. It does not yet mount real collaborative avatars, cursor overlays or awareness subscriptions in MaxEditor. Clients must hide stale entries at expiresAt themselves because wall clock passage alone does not trigger reactive query re-execution. Availability is best effort, not a guarantee of active physical user presence.

Required before merging to any production target: exact-head lint, root/Convex typecheck, unit, backup, Next build and browser jobs; real three-user Clerk/Convex tenant and revocation/expiry tests; native Arabic selection and devices; performance/cost and leak testing; independent security review and native cloud backup/restore evidence. Audit CI currently uses continue-on-error.

Do not enable the sandbox flag in production or conflate a server-granted lease with read/write authorization. Do not deploy or merge this draft. No production migrations are included. Rollback is reverting this branch; preserve all offline journals. PR21/22 packed updates are still opaque records, not semantic Yjs snapshots. Issue #42 baseline reconciliation stays separate.

Next scope: a gated client awareness adapter and calm avatar stack/cursor UX, followed later by anchored comments, mentions and suggestions.
