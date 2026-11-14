# Max 2.0 — PR 11/44: Arc-inspired navigation ergonomics & accessibility

## Scope and security boundary

This draft stacks on PR #28 (PR 10/44). Navigation stays **membership-metadata-only and read-only**, with both preview flags OFF by default. No workspace page read, collaboration, search, exports, editor, workspace-aware MCP, server write operation, migration or permission grant is introduced. An authenticated Convex query, not client navigation state, remains the authority for membership summaries.

## Accessible and predictable navigation

- Vertical workspace rails and preview context links support ArrowUp, ArrowDown, Home and End to **move focus only**; native Tab, Shift+Tab, Enter and link activation remain unchanged. No document-wide listener, unreviewed hotkey, or auto-navigation is registered.
- The focus order is independent of language direction; horizontal ArrowLeft/ArrowRight remain native for RTL and LTR. IDs use bidi isolation, and layout uses logical inline-start/inline-end properties.
- Deliberate touch/pen taps keep normal link semantics. A movement of 12px or more is treated as a swipe/scroll and cannot follow a link by accident; keyboard activation and mouse clicks are unaffected. No swipe-to-switch or destructive gesture is introduced.
- Rail and mobile navigation list remain scrollable for up to 50 authorized memberships. Links, buttons and dialog close affordances have at least 44px touch targets and visible keyboard focus.
- Mobile preview uses a labeled Radix modal with Escape/focus management, safe-area spacing and a keyboard-accessible close control. Reduced-motion preference removes unnecessary rail loading animation.
- Context list IDs are distinct per sidebar instance so concurrent desktop/mobile render trees never duplicate an aria-controls target.
- Scoped preview collapse/scroll memory restores after expanding; blocked sessionStorage access falls back to defaults. Neither page content nor account-independent navigation history is stored.

## Release and verification

- Confirm exact-head ESLint, both TypeScript checks, Vitest, backup tests, production build, and Chromium/WebKit E2E. Audit CI uses continue-on-error, so passing audit is not a vulnerability-free attestation.
- In a live two-Clerk-account environment, independently validate navigation membership changes/revocation, keyboard focus/Tab/Enter/Escape, touch swipes vs taps, RTL ordering, iOS/Android safe areas, reduced motion, accessibility (including screen reader announcements), and preservation of unsaved private editing when opening workspace preview in a new tab.
- Existing preview paths still require both server/client feature gates; disable either flag to roll back the UI. Rolling back this PR removes only inert client ergonomics and tab-local preview preferences, not any shared content or production data.
- Shared content/MCP remain blocked pending independent authorization, multi-account security review, isolated Convex restore with attachment hash verification and dedicated later PRs.
