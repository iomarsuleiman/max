# Max 2.0 — PR25/44: Gated client awareness and collaborator preview

Draft and **experimental only**, stacked on PR24/#53. The feature is confined to the separately deployed PR17 Convex provider and PR18 remote BlockNote lab. The production Max editor, personal notes, root Convex schema and main/max-2.0 branches are unchanged.

## Contract and privacy
- A client adapter uses only the server-issued, current Clerk/Convex collaboration session. It subscribes to the PR24 listPresence query and publishes short-lived statuses every eight seconds (server TTL: 20 seconds).
- Local one-second expiry filtering hides stale participants even when Convex queries have not rerun. A disconnect, lease timeout, auth error, account change or room switch immediately clears visible peers and stops the subscription.
- Server access control is authoritative; UI presence grants **no** edit rights. A live downgrade changes the next heartbeat to viewing with the focused block removed. Queued writes are serialized so invisible-mode deletion cannot be undone by a previous queued update.
- No user name, email, photo, note text, document, Yjs bytes or durable records in presence. Remote participants receive temporary numbered pseudonyms; focus identifies a block only, **not** a character-accurate selection/caret.
- The experimental preview is opt-in via `VITE_PR25_ENABLE_AWARENESS_LAB=true`, in addition to the server-side `MAX_V2_PR17_PROVIDER_SANDBOX=true` gate on a dedicated synthetic deployment. Without the flag the UI never subscribes or publishes presence.

## Review checklist
1. Run `pnpm exec node --test experiments/max-v2-pr18/presence.test.mjs` and `pnpm --filter @max-experiments/pr18-remote-blocknote-provider test`.
2. Exact-head lint, root/Convex typecheck, production build, unit/backup and Chromium/WebKit E2E; dependency audit is continue-on-error and is not clearance.
3. Independent **real** three-Clerk-account/cloud test: scoped visible and invisible status, guest viewing, ACL downgrade, revocation, blocked token/session replay, tab handoff, lease expiry, offline journaling and Arabic native IME.
4. Verify keyboard accessibility, reduced motion, small screen and RTL, and measure presence traffic/cost, room cap and TTL behavior. Native cursor overlays and precise text offsets are deliberately deferred until safely mapped to the BlockNote/Yjs editor schema.
5. Independent security review and real cloud backup/restore with attachment hashes; baseline issue #42 remains separate. Do not deploy or merge to main.

## Rollback
Disable the Vite opt-in flag to remove all client awareness behavior. The sandbox server rows expire within 20 seconds; do not touch durable CRDT updates or IndexedDB journals. PR24's server presence foundation remains independently reversible.
