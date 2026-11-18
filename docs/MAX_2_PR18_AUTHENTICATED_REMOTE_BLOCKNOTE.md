# Max 2.0 — PR18/44: Authenticated remote BlockNote provider sandbox

Draft only. Stacked on PR #36. No production routes, production shared database, personal notes, autosave, history, MCP, migration or user-facing flags changed.

## What it implements

- An isolated browser harness at experiments/max-v2-pr18 imports the actual Max maxSchema, mounts BlockNote 0.55, and connects a real Y.Doc to PR17 experimental Convex operations through ConvexClient WebSocket and Clerk session JWT (template convex).
- PR17 join now returns server-derived accountId and canEdit for the experiment. The server still rechecks identity, workspace/page read or write rights, lease and revocation on every update operation.
- Yjs updates are sent to append-only ordered Convex log, watched with reactive query, paginated and applied with remote origin suppression. Cursor gaps reject, rather than truncate, content.
- No automatic offline replay: buffered updates stay in RAM, a local snapshot can be exported for review, and reconnect with pending bytes demands an explicit review action. Cross-account reuse fails closed.
- A revoked or expired lease blocks writes. Read-only participants remain non-editable in the browser. Updates over 16 KiB and local buffer overflow block, rather than silently drop bytes.

## Dedicated lab setup (manual; no actual cloud deployment was performed by this PR)

1. Provision the standalone PR17 Convex project with its own Clerk JWT verification, synthetic lab-workspace and lab-page, synthetic memberships, ACL grants and fixtures. Set the private MAX_V2_PR17_PROVIDER_SANDBOX=true flag only in that project.
2. In experiments/max-v2-pr18/.env.local set public sandbox-only VITE_PR18_CONVEX_URL, VITE_PR18_CLERK_PUBLISHABLE_KEY, VITE_PR18_WORKSPACE_ID and VITE_PR18_PAGE_ID. Never put private keys, admin tokens, real Max page IDs or actual user documents in VITE variables.
3. Install dependencies from the isolated experiment directory and run npm run dev. Open localhost port 3238 and authenticate in dedicated Clerk test accounts. Use separate browser profiles for independent sessions.
4. Test Arabic callout, pageLink and bookmark props/IDs, three-account concurrent editing, page read-only guests, revocation during live subscription, partitions, lost acknowledgments, session TTL, and reconnect with pending offline edits.
5. For recovery testing, export a local Yjs snapshot, check exact BlockNote JSON parity and verify the isolated Convex server log and separately restored cloud state.

## Automated verification and release blockers

- npm test in the PR18 experiment uses real Yjs bytes and a *simulated* multi-identity server transport. It validates convergence, binary preservation, no echo, explicit replay consent, view-only restrictions, revocation, account binding and cursor gap rejection.
- npm run build statically bundles the standalone Max-schema browser harness. Root CI, PR16 Chromium/WebKit browser job and previous provider probe must also pass on this PR's exact head.
- These tests are NOT evidence of a working deployed Convex+Clerk browser session or a verified 3-account security test. CI's dependency audit continues to use continue-on-error.
- Remaining: actual multi-account Clerk/Convex E2E logs, real server-mediated revocation, full custom/media fixture parity, durable IndexedDB journal, stalled-client recovery, server-side Yjs validation, awareness/presence, 16 KiB splitting, live cloud backup restore, RTL IME, accessibility/performance and external security review.

**Not merged, deployed or production-ready.** Next PR19: durable offline journal, complete custom-schema parity and real multi-account provider/security evidence in isolated deployments.
