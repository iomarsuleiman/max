# Max 2.0 local measurements

`scripts/measure-baseline.mjs` measures the existing production build against
fresh synthetic local data. It starts its own server on an available loopback
port and creates its own temporary data directory. It never connects to Convex
or reads an existing user's workspace. Run it after building and while other
builds, test suites and browser work are stopped:

```sh
pnpm build
node scripts/measure-baseline.mjs
```

The optional first argument selects the output directory. `MAX_BASELINE_SAMPLES`
sets the sample count, from 5 to 200, with 30 by default. The output includes raw
samples, environment details, all build JS/CSS chunk sizes, browser resource
timings, a renderer heap sample and five accessibility/reflow screenshots.
The checked-in [JSON report](V2_MEASUREMENTS.json) omits machine-specific server
and temporary data paths. Percentiles use the nearest-rank method.

## What the measurements establish

The fixture creates a welcome page, three bilingual notes and 30 uniquely
searchable pages. Each note contains roughly 2,500 characters. Warm navigation
alternates between two notes and waits for the destination title and its distinct
editor content. Each search waits for the matching query's actual response and
rendered option, rather than counting an already-visible recent page as a search
result.

Input and sidebar event timings run inside the renderer from the capture-phase
event to its next animation frame. Playwright interaction timings also remain in
the report and include driver overhead and locator assertions. These measures
serve different purposes and should not be substituted for one another.

The machine is a Windows x64 laptop with an Intel Core i7-14700HX, 28 logical
processors and roughly 25 GB of memory, running Node 22.23.2 and Chromium
153.0.8010.12 without CPU or network throttling. This is a fast local machine,
not the plan's representative mid-range hardware or a deployed staging system.

## Recorded run, 2026-11-11

The run at 05:52 UTC completed with 30 samples per interaction. The unit and full
browser suites were stopped during the run.

| Measurement                                 | Result           | Local comparison               |
| ------------------------------------------- | ---------------- | ------------------------------ |
| Warm route to distinct editor content, p95  | 245.0 ms         | Under 1,000 ms                 |
| Sidebar click to next frame, p95            | 36.5 ms          | Under 100 ms                   |
| Sidebar Playwright click and assertion, p95 | 87.8 ms          | Includes automation overhead   |
| Editor input event to next frame, p95       | 14.7 ms          | Under 50 ms                    |
| Search including 180 ms debounce, p95       | 217.1 ms         | Under 680 ms                   |
| Cold route to editor, one sample            | 876.0 ms         | No percentile claim            |
| Renderer JavaScript heap, one sample        | 51,578,540 bytes | No leak or memory budget claim |
| All build JS/CSS chunks, uncompressed       | 15,084,040 bytes | Includes code-split chunks     |

All five editor accessibility/reflow modes returned zero axe violations and no
viewport horizontal overflow. Search returned focus to the editor. No page
runtime errors occurred. These results satisfy the measured synthetic local
interaction comparisons, with the environment and scope limits above.

## Accessibility and focus

The harness runs with reduced motion requested and checks editor WCAG 2.2 AA
rules and viewport overflow in wide light, narrow dark RTL, phone light, phone
dark RTL and 200% CSS-zoom reflow modes. This checks layout reflow, not the
browser's native zoom controls or a human screen-reader session.

The initial run reproduced a search focus bug. Focusing the editor, opening
search with Control+K and dismissing it with Escape left focus on the document
body. Search has no Radix Dialog.Trigger when opened by a keyboard shortcut.
The dialog now records its originating element and restores it on dismissal,
while leaving focus in a newly opened dialog when a command navigates there.
`tests/e2e/baseline-focus.spec.ts` checks both returning to writing and opening
Settings. The production benchmark also checks the actual focus result.

The complete corpus has separate [platform visual references](baselines/README.md).
Those captures preserve custom blocks and both browser engines. They exclude
workspace chrome and relative save timestamps so other tests' recent pages do
not invalidate a comparison.

Image inspection rejected the first editor-element captures because scroll
ancestors clipped below-fold content. The references now use overlapping
viewport tiles with recorded scroll geometry. The expanded per-tile axe checks
also reproduced an undersized Figma embed caption link that the original
above-fold audit missed. Its CSS now provides a minimum 24-by-24-pixel target.
The earlier full-suite pass applies to the earlier audit scope; the reference
documentation records the separate expanded tile verification.

## Unmeasured release gates

- Deployed p75 LCP, INP and CLS and real-device typing latency.
- Convex subscription traffic, data volume, cloud query latency and shared
  two-client concurrency.
- Native browser zoom, screen-reader usability, real-device touch and the
  internal pilot's usability acceptance.
- Heap growth over time. The recorded renderer heap is one sample, not a leak
  test. Total build chunk size includes every split JS/CSS chunk, not a
  per-route transfer budget.

These measurements provide a reproducible personal-mode baseline. They do not
certify shared editing, migration safety or completion of the collaboration
release gates.
