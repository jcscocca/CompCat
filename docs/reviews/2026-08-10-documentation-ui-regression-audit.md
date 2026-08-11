# Documentation and UI regression audit — 2026-08-10

**Scope:** every maintained repository document, the registered FastAPI surface, SQLAlchemy model
metadata and migrations, current launcher/deployment references, frontend test inventory, and the
recent canonical-report, custom-filter, map-disclosure, and area-selection UI work. Files under
`docs/superpowers/` remain intentionally historical and were checked only for their archive label,
not rewritten to describe current code.

## Findings resolved

- The docs index advertised 12 mapped entities after `AnalysisReportSnapshot` raised the total to
  13. The index and data-model audit stamp now match `Base.metadata.tables`.
- The README route table omitted canonical-report, area-selection, area CSV, and three internal
  mirror routes. The canonical API table also described `/health/data` in prose without inventorying
  it. Both inventories now cover every application `APIRoute`.
- The overview, API contract, root configuration summary, and private deployment guide lagged the
  independently selectable three-slot LLM chain and in two places still said failover wrapped two
  backends.
- `SECURITY.md` still described an occasional on-demand demo and said the deployed app made no
  third-party requests. It now distinguishes zero third-party **browser** traffic from controlled
  server-side geocoding, LLM, and Seattle Open Data requests, and reflects the small public instance.
- The README under-described the current dashboard: three disjoint data layers, transient area
  selection, layer-native canonical reports, and report-card export formats are now explicit.
- The accessibility page now records a complete 2026-08-10 Axe/manual pass that includes the
  area-selection inspector, while retaining the earlier 2026-07-30 baseline as historical evidence.

## Regression protection added

- `tests/test_documentation_contract.py` fails when the canonical API table differs from registered
  routes, the README omits a route, the mapped-table count drifts, or a maintained local Markdown
  link breaks. Archived `docs/superpowers/` plans are excluded because stale source links are part of
  their stated historical contract.
- Playwright now captures reviewed platform-independent baselines for desktop light onboarding, the
  desktop About modal, the desktop area inspector, and the mobile dark half-sheet. Network responses
  are deterministic; only the GPU-dependent map canvas is hidden.
- Twenty-six durable Playwright accessibility cases run Axe 4.12.1 in both themes across desktop
  onboarding, reports, dialogs, area views, all mobile sheet snaps, and a 320-pixel text-spacing
  state. The area cases also assert keyboard tabs, exact-value disclosure, target sizing, and the
  scrollable records region.
- `make test-all` and the frontend CI job run the visual suite in addition to the existing Vitest
  behavior/accessibility suite and production build.
- [`../ui-regression-testing.md`](../ui-regression-testing.md) records the coverage matrix, baseline
  review rules, commands, and the live built-app checklist.

## Remaining honest limits

- Axe and screenshots are regression guards, not replacements for assistive-technology user testing.
- Live report results depend on seeded backend geography and remain part of the built-app checklist;
  deterministic component tests carry the detailed report-state matrix.
- External operator state—Cloudflare analytics, production freshness, backups, and soak evidence—can
  be documented and checked by runbook but cannot be proven by this local code audit.

## Verification result

`make test-all` passed on 2026-08-10 with:

- 1,285 backend tests passed and 4 skipped, including the four documentation-contract checks;
- Ruff passing with no findings;
- 838 frontend behavior/accessibility tests passing across 81 files;
- all 26 Playwright Axe/accessibility cases and four visual baselines passing; and
- a successful TypeScript and Vite production build.

The separately seeded live worktree check also passed at desktop and mobile widths. It covered the
three-layer map shell, a shared canonical report, rectangle selection through **Use visible map
area**, area summary and data-table views, the responsive half-sheet, the About dialog, and the
product-invariant wording. Basemap tiles were intentionally absent; the app displayed its designed
fallback while pins and analysis continued to work.
