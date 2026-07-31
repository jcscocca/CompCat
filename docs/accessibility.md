# WCAG 2.2 accessibility

> Last assessed 2026-07-30 against the React dashboard in this repository.

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

The 2026-07-30 assessment used Axe 4.10.3 with the `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa`, `wcag22aa`, and `best-practice` rule tags. Thirteen stable production-build
states were scanned:

- desktop empty and analyzed states in both themes;
- desktop expanded analysis details;
- About and Manage Places dialogs;
- mobile bar, half, and full snaps in both themes.

All thirteen states returned **zero violations**. Axe marks rounded empty textareas as a
manual color-contrast review because sampling their rounded corner can hit the parent
surface. Their computed text/surface ratios were reviewed directly: 16.04:1 in light mode
and 13.63:1 in dark mode.

Manual checks also verified:

- a complete 320-pixel keyboard sweep with no obscured focus target and no covered map
  control reachable at the full snap;
- forward/reverse modal focus containment, Escape dismissal, focus restoration, and tabs
  arrow-key behavior;
- keyboard opening of hourly, daily, and 60-row monthly chart tables;
- 320-pixel bar/half/full reflow and WCAG text-spacing overrides with no document overflow;
- light/dark contrast ratios for text, accents, identity badges, data marks, focus rings,
  and control boundaries;
- the live product-language invariant: no safe/unsafe/dangerous ranking language and only
  the fixed “not a personal risk prediction” caveat.

The repository gate remains `make test-all` (backend tests and lint plus frontend tests and
the production build). Accessibility behavior is also covered by component and stylesheet
regression tests under `frontend/src/` and `frontend/tests/`.

## Maintenance rule

Any new public UI state must keep this contract. Add regression coverage for new semantics
or interaction, run `make test-all`, scan both themes at desktop and 320 CSS pixels, and
manually verify keyboard order, focus visibility, reflow, text spacing, and non-color state
cues before calling the change complete.
