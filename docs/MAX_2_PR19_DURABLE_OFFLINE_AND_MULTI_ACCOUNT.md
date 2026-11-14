# Max 2.0 — PR19/44: durable offline journal, broader schema parity & live multi-account evidence

**Draft, stacked on PR #37 (PR18/44). Unmerged, undeployed, no production collaboration activation.**

## Implementation and isolation

1. `experiments/max-v2-pr18/durable-journal.mjs` adds a transactional IndexedDB outbox named `max-pr19-sandbox-outbox`. A journal key binds the authenticated Clerk account ID, synthetic workspace ID and synthetic page ID. It stores immutable Yjs operation IDs, exact base64 update bytes and sizes. It never stores tokens, raw account credentials, server roles or a complete production document.
2. `AuthorizedYjsProvider` now supports an optional journal. The isolated PR19 browser mounts **the actual Max editor only after journal restoration**. Previously unacknowledged local deltas are recovered into the local Y.Doc without contacting the remote server. The provider requires operator review before sending any recovered pending bytes.
3. New local updates are persisted **before** a network append. A server acknowledgement is followed by a local IndexedDB acknowledgement; a failure of either does not silently delete the operation. Duplicate operation IDs remain byte-for-byte identical, enabling server-side idempotent replay.
4. The journal has bounded single-update (16 KiB), queued-update (16) and queued-byte (128 KiB) limits. Corrupt records, quota errors, unavailable IndexedDB and account mismatches block transport instead of discarding data. The operator can export the current Y.Doc from the lab, but a corrupted journal may need manual recovery.
5. An isolated account-switch listener reloads the lab and drops the old provider. The server continues to derive identity and permissions and checks every read/write; the journal scope never grants server authorization.

**Durability precision:** the browser commits IndexedDB updates asynchronously. A process kill *before the transaction completes* can still lose the last in-flight edit. This is not a WAL/fsync guarantee or encrypted local storage. Do not use with real patient, personal, production or regulated documents. Snapshots/media payloads do not yet have complete recovery guarantees.

## Schema and fidelity coverage

The existing PR16 Chromium/WebKit lab now exercises more of the **real** `maxSchema`: heading, callout, equation, image metadata (URL, alt, caption, width), YouTube timings and captions, Mermaid source, bookmark, TOC, embed, database view, and both inline page and date mentions. Tests compare stable block IDs, type, key props, Arabic Unicode content, cross-peer document equality, and Yjs state reconstruction.

This is **not yet full schema fidelity**. Multi-column nesting, table cells, code-language choices, media file bytes/URLs with signed access, attachment hashes, links to actual database records, Arabic IME composition and drag/drop need independent browser tests. A parser/rendered fixture passing does not guarantee full asset or side-effect parity.

## Automated checks (synthetic)

- `cd experiments/max-v2-pr18 && npm test && npm run build`
- `pnpm exec playwright test --config experiments/max-v2-pr16/playwright.config.mjs` — real BlockNote on Chromium/WebKit against a synthetic in-memory Yjs relay.
- `pnpm exec playwright test --config experiments/max-v2-pr19/journal.playwright.config.mjs` — real IndexedDB persistence and isolation across reload, Chromium/WebKit, no server authentication.
- CI also runs root lint, TypeScript/Convex, unit, backups, production build and existing PR15 provider probe.
- **Never count** synthetic Yjs server identities, simulated durable storage or actual IndexedDB without live Clerk/Convex transport as successful remote multi-account tests.

## Required REAL remote proof (not run in this PR)

This runner is intentionally **not an automatic CI green check**. It errors (rather than skips) if credentials are absent.

1. Provision a **separate** PR17 Convex sandbox deployment with `MAX_V2_PR17_PROVIDER_SANDBOX=true`, JWT issuer/verifier, synthetic page/workspace ACLs, and room. It must be isolated from Max's real Convex and real customer data.
2. Provision three **independent Clerk accounts**: `ALICE` (owner with manage/edit), `BOB` (editor), and `GUEST` (view only). Record each account's server-verified Clerk subject ID. No shared cookies or copied server tokens.
3. Build/serve PR18 lab with only sandbox VITE variables and `VITE_PR19_ENABLE_TEST_HOOKS=true`. Store three authenticated Playwright storage-state files **outside git**, one per identity; never upload them as artifacts. Deploy the sandbox lab at a separate HTTPS URL or serve locally on loopback.
4. Set `MAX_PR19_LIVE_URL`, `MAX_PR19_ALICE_STATE`, `MAX_PR19_BOB_STATE`, `MAX_PR19_GUEST_STATE`, and `MAX_PR19_ALICE_ID`, `MAX_PR19_BOB_ID`, `MAX_PR19_GUEST_ID`. Then run:

```sh
pnpm exec playwright test --config experiments/max-v2-pr19/live.playwright.config.mjs
```

5. The runner checks server-derived identities, distinct browser contexts, peer convergence, read-only guest denial, owner-authorized server revocation of Bob, loss of Bob access, offline Yjs update persistence after browser reload, exported snapshot before explicit review, and post-review recovery visible to a guest. It reports evidence without exporting cookies, credentials or message bodies. Use a newly provisioned disposable sandbox; revocation is destructive to that fixture.
6. Separately verify active lease expiry (five minutes), write downgrade/permission changes, subscription revocation under network partition, no replay after switching signed-in accounts, backup/restore, unavailable storage, multiple tabs, WebKit mobile/RTL IME, and performance for 100/1,000/5,000 blocks. Record exact-head workflow URLs, browser versions and redacted timestamps. Run an independent security review before authorizing rollout.

## Safety, rollback and open blockers

The PR keeps the production Next routes, personal editor, owner-only autosave, production Convex schema, production MCP, migrations, asset storage, permissions and flags unchanged. Reverting the branch (PR18 test changes, journal and documentation) restores the prior sandbox; production content needs no migration.

**Do not merge/deploy for collaboration** based on the new tests alone. Live real-identity verification remains unperformed until the separate credentials and sandbox exist. IndexedDB is not encrypted at rest by Max; unsent writes can exceed limits, transactions can fail, browser storage can be cleared, and large Yjs updates cannot yet be chunked. Server log remains bounded (256 updates / 1 MiB) without snapshot compaction or cryptographic update/schema verification. Missing production gates include independent security audit, asset parity and restore tests, performance/accessibility testing, release/rollback approval and cloud conflict diagnostics.

The root dependency audit job still has `continue-on-error`; it is **not a dependency security certification**.

**Next PR20/44:** determine next milestone from the implementation tracker after reviewing PR19's evidence; do not activate shared production documents automatically.
