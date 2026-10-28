# UI regression testing

> Added 2026-08-10 after a repository-wide documentation and frontend-coverage audit.

CompCat protects the dashboard at four complementary boundaries. Component tests protect behavior
and accessibility semantics, browser Axe scans protect composed states, browser screenshots protect
composition and responsive layout, and a live built-app pass catches integration issues that mocks
cannot represent.

## Coverage matrix

| Surface | Durable automated coverage |
|---|---|
| App/session bootstrap, restore, search, pin, bulk place, shared-link, direct report, assistant effects, failure recovery | `frontend/src/components/MapWorkspace.test.tsx` |
| Desktop rail resizing/focus, mobile bar/half/full snaps, map inaccessibility at full snap | `MapWorkspace.test.tsx`, `BottomSheet.test.tsx`, and stylesheet contract tests |
| Context pickers, custom 100–1,000 m radii, date validation/presets, layer availability, copy-link disclosure | `ContextStrip.test.tsx` and focused `frontend/src/lib/` tests |
| Canonical report rendering, expansion, exports, coverage adjustments, reference distributions, trends, incident rows | `AnalysisCard.test.tsx`, `TrendSection.test.tsx`, `reportExport.test.ts`, and backend report tests |
| Print tabs remain detached from their opener, wait for saved-place privacy revalidation, close on rejection, and explain blocked popups | `report-export.desktop.spec.ts` |
| Successful upload erasure clears matching reports from the mounted thread and tab history while preserving other history | `reportHistory.test.ts` |
| Area rectangle/polygon/lasso behavior, keyboard alternative, linked filters with synchronized type/hour/day counts, zero-result buckets, tabs, rows, highlights, pagination, CSV, close/reopen, and redraw cancellation | `MapCanvas.test.tsx`, `AreaSelectionCard.test.tsx`, `useAreaSelection.test.ts`, `desktop.spec.ts`, and `tests/test_area_selection.py` |
| Map clusters, stacks, popups, active-layer wording, theme rebuilds, badges, camera fitting | `MapCanvas.test.tsx`, `IncidentDisclosure.test.tsx`, `MapLegend.test.tsx`, and map-style tests |
| Composed accessibility in both themes across desktop onboarding/reports/dialogs/area views and mobile snaps/area views/320-pixel text spacing | 26 Playwright Axe cases in `accessibility.desktop.spec.ts` and `accessibility.mobile.spec.ts` |
| Stable browser composition | Playwright baselines for desktop light onboarding, desktop About dialog, desktop area inspector, and mobile dark half-sheet |

The browser tests use deterministic API fixtures in `frontend/tests/visual/mockDashboard.ts`. Axe
4.12.1 runs WCAG 2 A/AA, WCAG 2.1 A/AA, WCAG 2.2 AA, and best-practice rules against those states.
For screenshots, the MapLibre canvas itself is hidden because GPU rendering varies across platforms;
the map container, controls, disclosures, overlays, top bar, rail/sheet, modal, and area inspector
remain. macOS development and Linux CI use separately reviewed baselines because text rasterization
differs materially between the operating systems. Each platform retains the same strict one-percent
changed-pixel limit, so cross-platform noise cannot force a tolerance broad enough to hide layout
changes.

## Commands

Install the browser once per machine:

```bash
cd frontend
npm ci
npx playwright install chromium
```

Run the automated frontend layers:

```bash
npm test
npm run test:visual
```

The repository gate runs both plus backend tests, lint, and the production build:

```bash
make test-all
```

CI installs the matching Chromium revision before running the browser accessibility and screenshot
suite. Browser output belongs under `frontend/test-results/` and is ignored by Git.

In shared ThinkPad CI, frontend unit tests use at most two workers and browser tests use one.
CI also bounds common numerical, Go, Rust and Node helper thread pools to two workers.
The `frontend-unit` CI job runs unit tests and the production build. The existing `frontend` check
remains the final browser gate and starts after backend, Postgres, Docker and frontend-unit checks
pass. Its repository browser queue holds pending visual jobs before assigning a runner.
The gate runs the complete suite in a pinned Playwright/Node container with private HOME, temporary
files, IPC and loopback port 4173, two CPUs, 8 GiB RAM, 2 GiB shared memory, and no host ports,
host filesystem mounts or external network. This isolated job does not take the host browser lock.
`CI_BROWSER_RUNNER_LABEL` can select a reserved repository runner once that registration has the
matching label; the default remains `thinkpad`.

The container's collected inventory must retain all 38 existing cases and account for every
case in the result, including future additions. Original assertions, retries and screenshot
tolerances stay in the source suite. Container cleanup checks kind/run/attempt labels and removes
only its immutable ID and unique image tag, including after cancellation. Console logs retain
every case result. Temporary reports and screenshots use an owner-only, receipt-checked
`$RUNNER_TEMP/compcat-ci-browser-<run>-<attempt>` directory and are removed after success,
failure or cancellation; runner-managed temporary cleanup also applies. There is no persistent
diagnostics archive or cloud artifact upload. Build layers use the existing default Docker
builder cache: the audited ThinkPad policy targets 20 GiB of retained cache with periodic GC
(not a hard per-job disk cap), including a 48-hour source/cache-mount policy at 2.764 GiB.
No workflow changes daemon-wide settings or prunes another job's images or cache.
Native browser commands that share a host still need its
browser lock, with a bounded wait, for example `flock -w 60 "$HOME/.cache/thinkpad-actions-browser.lock"`.

PR updates replace the preceding run for the same PR, and main pushes replace older main runs.
A trusted closed-PR event uses that same group to retire obsolete work, running only a fixed
summary without checkout. Manually dispatched acceptance runs keep their own run/attempt group.
All product checks refuse the closure event and fork PR heads. A fixed fork-policy job fails
with instructions to review the change and run it through a repository branch for full CI;
it never checks out or executes PR code. Every job has a bounded timeout. No artifacts are
uploaded automatically.

## Updating screenshots

Do not update a baseline merely to make a failure green. First open the actual/diff images under
`frontend/test-results/visual/` and decide whether the change is intentional across the whole state:

- hierarchy, spacing, wrapping, clipping, and scroll position;
- both sides of the map/rail boundary;
- disabled, selected, and focusable control affordances;
- light/dark tokens and modal scrim treatment;
- mobile map space versus the half sheet; and
- the reported-context-only product language.

When the change is intentional, regenerate and inspect every affected image:

```bash
cd frontend
npm run test:visual:update
npm run test:visual
```

The update command writes only the current operating system's files (`darwin` on macOS, `linux` in
CI-compatible containers). Keep both platform sets synchronized for intentional layout changes and
inspect each actual/diff before committing. Commit the changed PNGs with the UI change. A new
important composed state should usually add a new baseline; a state whose risk is primarily logic
or semantics should stay in the faster component suite.

From the repository root, regenerate the Linux set with the Playwright image matching the installed
`@playwright/test` version (currently 1.63.0):

```bash
docker run --rm --init --ipc=private --shm-size=2g --cpus=2 --memory=8g \
  -v "${PWD}":/work \
  -v compcat-playwright-node-modules:/work/frontend/node_modules \
  -w /work/frontend \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  bash -lc "npm ci && npm run test:visual:update"
docker volume rm compcat-playwright-node-modules
```

## Live built-app check

Visual snapshots deliberately mock API traffic and do not replace the repository's end-to-end
verification recipe. For frontend changes, build the dashboard, seed the synthetic incident data,
launch the worktree app on an unused port, then verify:

1. desktop light and dark onboarding;
2. one saved-place report and one multi-place report;
3. area selection Summary/Data tabs plus cumulative type/hour/day filters, removable chips, exact-value tables, close/reopen, redraw cancellation, pagination, and CSV scope;
4. mobile bar, half, and full sheet snaps;
5. keyboard focus, Escape behavior, and map inaccessibility at the full snap; and
6. the product-language sweep: no safety ranking or personal-presence claims, with only the fixed
   “not a personal risk prediction” caveat allowed.

The current full accessibility record is in [`accessibility.md`](accessibility.md).
