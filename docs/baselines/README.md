# Editor visual references

The platform directories contain screenshots of the synthetic complete editor
corpus in `tests/fixtures/editor-document.json`. Each manifest records the
fixture checksum, production build, browser versions, viewport, theme,
direction, scroll position, capture rectangle, physical image dimensions and
screenshot checksums. Each mode has overlapping viewport tiles from the top
through the bottom of the real page scroll surface. The collector rejects gaps
and missing top or bottom coverage.

The corpus test freezes its clock, disables screenshot animations and stubs
third-party embeds. Its images and media bytes are synthetic. The references
cover the existing editor, not a proposed collaboration interface.

## Reproduce and compare

Use the same operating system, installed browser versions and fonts as the
reference manifest. After `pnpm build`, run the three corpus projects against
that existing build with a fresh temporary workspace:

```sh
E2E_SKIP_BUILD=true pnpm exec playwright test tests/e2e/editor-baseline.spec.ts --output test-results/visual-repeat
node scripts/measure-baseline-visual.mjs compare test-results/visual-repeat
```

The collector requires fresh tiles for all twelve project/mode combinations
from the current build, rejects
duplicates and stale results, verifies reference checksums, and compares decoded
RGBA pixels. A channel difference greater than 16 counts as changed; more than
0.5% changed pixels fails the comparison. Inspect actual images and their changes
before accepting a new reference:

```sh
node scripts/measure-baseline-visual.mjs capture test-results/visual-repeat
```

The collector also accepts ordinary `test-results` output from the full browser
suite. In PowerShell set `$env:E2E_SKIP_BUILD = "true"` before the Playwright
command instead of the inline environment assignment. The test server creates
disposable workspace data under `test-results/server-data`. Do not
point browser tests at personal data or use production data for screenshots.

## Capture correction

The initial element screenshots were rejected after image inspection: scrolling
ancestors clipped most below-fold content, leaving large blank areas. Pixel
equality between those images did not prove visual coverage. They have been
replaced by viewport tiles that preserve the real scroll surface and exclude
the topbar and sidebar. The test loads the diagram SVG before recording geometry
and verifies the final columns are in the viewport at the bottom. Toggle
children remain in their explicitly tested collapsed state.

Two fresh runs on 2026-11-11 passed all three browser projects. All 48 viewport
tiles matched with zero changed pixels. Every tile received a WCAG 2.2 AA audit;
the wider coverage exposed and now guards the bookmark-title input and embed
caption link target sizes. Provider iframe contents are synthetic and excluded
from axe; each Max iframe's accessible name is checked separately. The references
total roughly 8.5 MB and visibly include the final database and bilingual columns.

## Limits

These are diagnostic platform references. They are deliberately not global CI
pixel assertions: Windows and Linux font rendering differ. A comparison on an
operating system with no references fails with a missing-manifest error rather
than silently accepting new images.

The original corpus test still asserts content, stable IDs, keyboard toggles,
overflow and automated WCAG rules on every supported browser platform. Visual
references do not establish design approval, screen-reader usability, real-device
behavior or compatibility with external media providers. Human review and
assistive-technology checks remain release gates.
