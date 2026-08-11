# WCAG 2.2 accessibility

> Full assessment completed 2026-08-10 with Axe 4.12.1 and a manual production-build review.
> The 2026-07-30 baseline is retained below as historical evidence.

CompCat targets **WCAG 2.2 Level AA** for the public React dashboard. The current
engineering assessment found no known Level A or AA failures in the audited scope. This
document records the product contract and the repeatable evidence behind that result; it is
not a third-party legal certification.

## Audited scope

- The map workspace, search, map key, pins, zoom controls, and shared-view notice.
- The Tabby rail in desktop open/collapsed states and mobile bar/half/full snaps.
- Empty, analyzed, expanded-detail, warning, and error states.
- About and Manage Places dialogs, all Manage Places tabs, and form validation.
- Trend, temporal, comparison, category, and incident-detail visualizations.
- Area drawing, the Summary/Data inspector, linked chart filters, exact-value tables, and paged
  records.
- Light and dark themes at desktop and 320 CSS-pixel mobile widths.

The assessment covers the application-generated interface. User-provided place names and
assistant responses remain content inputs, so future changes to either must preserve this
contract.

## Implementation contract

### Perceivable

- Informative charts expose concise accessible names and keyboard-operable data tables with
  row/column headers and captions. Decorative marks and icons are hidden from assistive
  technology.
- The page has a coherent heading hierarchy plus named `main`, complementary, section,
  form, dialog, tablist, tab, tabpanel, status, and alert semantics.
- State is never communicated by color alone. Selection also uses text decoration, weight,
  labels, `aria-pressed`, `aria-selected`, or `aria-checked` as appropriate.
- Light and dark tokens meet 4.5:1 for normal text and 3:1 for control boundaries, focus
  indicators, and meaningful graphical marks. The primary measured ratios include:
  16.04:1 light-theme body text, 13.63:1 dark-theme body text, 3.83:1 light control
  boundaries, and 5.94:1 dark control boundaries.
- The interface reflows without page-level horizontal scrolling at 320 CSS pixels and
  remains usable with WCAG text-spacing overrides.
- Hover details that convey information are available through persistent, keyboard-operable
  disclosures. Reduced-motion preferences disable non-essential animation.

### Operable

- Search results, map controls, pins, sheet controls, tabs, disclosures, filters, forms, and
  analysis actions are keyboard operable. Chart tables replace pointer-only value readouts.
- Area selection exposes rectangle, polygon, and lasso pointer modes plus a **Use visible map
  area** button as the equivalent keyboard/mobile path. Escape cancels drawing; click-built
  polygons also support Enter to finish and Backspace to remove the last vertex. The resulting
  Summary/Data inspector implements roving tab focus and gives both temporal charts exact-value
  tables. Type, hour, and day chart values are named toggle buttons with `aria-pressed`; the
  exact-value tables expose the same controls, and active filters appear as individually removable
  chips plus a **Clear filters** action.
- Each visible analysis-filter value is a named disclosure button. Every non-modal anchored
  picker closes on outside pointer input or Escape, and option pickers close immediately on
  selection; Escape and option selection restore focus to the originating filter.
- Radius suggestions remain keyboard-operable shortcuts, while the labeled custom-radius field
  accepts any whole-meter value from 100 through 1,000 and exposes validation errors in the same
  dialog.
  Date presets are ordinary buttons and resolve against the currently active end date.
- Assistant-applied filter changes are announced as deterministic status receipts. Their
  one-time Undo control restores the prior scope without relying on the temporary visual
  highlight, which is disabled when reduced motion is requested.
- Modal dialogs move focus inside on open, contain both forward and reverse Tab navigation,
  close with Escape, and restore focus to their trigger.
- Mobile sheet dragging has a keyboard/tap toggle. Desktop drawer resizing has arrow, Home,
  and End key support. Map zoom is available through buttons.
- At the full mobile sheet snap, the covered map subtree is `inert` and `aria-hidden`; its
  controls cannot receive focus. Bar and half snaps reserve visible map space above the
  sheet.
- Focus order follows the visual task order and every reachable control has a visible,
  non-obscured focus indicator.
- Interactive targets meet WCAG 2.2 target-size requirements or their spacing exception.

### Understandable and robust

- Controls have programmatic names and instructions; validation failures use
  `aria-invalid`, `aria-describedby`, and alert semantics.
- The Manage Places view switcher implements the ARIA tabs keyboard pattern, including
  roving `tabindex`, ArrowLeft/ArrowRight, Home, and End.
- Dynamic freshness, search, analysis, and error messages use status/alert semantics.
- The document language and title are declared, IDs are unique, and interactive roles expose
  their current state and relationships.

## Verification record

The 2026-08-10 assessment is preserved as 26 repeatable Playwright accessibility cases using Axe
4.12.1 with the `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`, and `best-practice`
rule tags. It scans both themes across:

- desktop onboarding, analyzed report, expanded report, About, every Manage Places tab, and area
  Summary/Data states;
- mobile bar, half, and full snaps, area Summary/Data states, and the area inspector at 320 CSS
  pixels with WCAG text-spacing overrides.

All scans return **zero violations**. The suite also makes the browser-level keyboard and layout
checks repeatable: area tabs use roving arrow-key focus, Enter opens exact-value tables, hourly
targets are at least 24 CSS pixels wide, the records table is in the expected tab order, the full
mobile snap makes the covered map inert, and the 320-pixel text-spacing state has no document-level
horizontal overflow.

The manual production-build review also verified:

- a complete 320-pixel keyboard sweep with no obscured focus target and no covered map
  control reachable at the full snap;
- forward/reverse modal focus containment, Escape dismissal, focus restoration, and tabs
  arrow-key behavior;
- keyboard opening of hourly, daily, and monthly chart tables;
- area selection through **Use visible map area**, linked hour filtering, Summary/Data tab behavior,
  the area exact-value table, and the named horizontally scrollable records region;
- 320-pixel bar/half/full reflow and WCAG text-spacing overrides with no document overflow;
- light/dark contrast ratios for text, accents, identity badges, data marks, focus rings,
  control boundaries, and expanded-report metadata;
- the live product-language invariant: no safe/unsafe/dangerous ranking language and only
  the fixed “not a personal risk prediction” caveat.

The earlier 2026-07-30 assessment used Axe 4.10.3 on thirteen stable production-build states and
also returned zero violations. It remains useful historical evidence; the newer durable suite
supersedes its state coverage and includes the later area-selection interface.

The repository gate remains `make test-all` (backend tests and lint plus frontend tests and
the production build). Accessibility behavior is covered by component and stylesheet tests plus
the browser Axe suite under `frontend/tests/visual/`. See
[`ui-regression-testing.md`](ui-regression-testing.md) for the maintained coverage matrix.

## Maintenance rule

Any new public UI state must keep this contract. Add regression coverage for new semantics
or interaction, run `make test-all`, scan both themes at desktop and 320 CSS pixels, and
manually verify keyboard order, focus visibility, reflow, text spacing, and non-color state
cues before calling the change complete.
