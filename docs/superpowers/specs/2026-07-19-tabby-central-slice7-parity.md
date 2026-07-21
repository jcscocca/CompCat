# Tabby-central redesign — Slice 7 parity checklist

Date: 2026-07-19
Status: committed — gates the Task 3 deletion of `CompareTab`, `ExportTab`, `RailNav`,
and `CompareAddressInput` (already removed on this branch; see commit `193e0e7`).

Purpose: the design spec (`2026-07-19-tabby-central-redesign-design.md`, Migration
section) requires a written parity checklist mapping every retired Compare/Export
capability to its new rail-side home and the test that proves it, before the legacy
surfaces can be deleted for good. Every "Verified by" citation below was grepped against
the actual test files on this branch (paths are repo-relative); none are assumed.

## Checklist

| Capability | New home (component + interaction) | Verified by |
| --- | --- | --- |
| Address add | `SearchPill` lookup → `MapWorkspace.handleLookup` replaces the address list with the looked-up point and runs it via the inline-points path (no place saved). | `frontend/src/components/MapWorkspace.test.tsx`: `"looks up an address and analyzes it via the points path without saving a place"` |
| Address save | The lookup's draft-pin **Save** popover (`PinDraftPopover`) persists the point as a place; `useAddressList.markSaved` links the existing ad-hoc list entry to the new place in place instead of adding a duplicate. | `frontend/src/components/MapWorkspace.test.tsx`: `"saves a looked-up address to places on request"`; `frontend/src/lib/useAddressList.test.ts`: `"markSaved upgrades a matching ad-hoc entry in place (opt-in Save flow)"` |
| Address remove | `ManagePlacesModal`'s per-row **Remove** button (saved places). Pure ad-hoc (unsaved) entries have no standalone remove control — a new lookup replaces the list wholesale instead, since the redesign carries at most one ad-hoc entry at a time (`CompareAddressInput`'s multi-row ad-hoc list is not reproduced; see note below). | `frontend/src/components/ManagePlacesModal.test.tsx`: `"delegates delete, toggle, drop-pin, and close"` |
| Explicit run | `ContextStrip`'s **Run analysis** button (footer of the open editor), wired to the deterministic `analyze_places`/`compare_places` command by saved-place count. | `frontend/src/components/ContextStrip.test.tsx`: `"Run analysis is disabled when runDisabled and fires onRun when enabled"`; `frontend/src/components/MapWorkspace.test.tsx`: `"ContextStrip Run analysis runs analyze_places for a single saved place"`, `"ContextStrip Run analysis runs compare_places for 2+ saved places"`, `"ContextStrip Run analysis is disabled with no saved places"` |
| Exact date inputs | `ContextStrip` editor's start/end `<input type="date">` pair. | `frontend/src/components/ContextStrip.test.tsx`: `"patches dates through the date inputs"` |
| Radius/category choices | `ContextStrip` editor's radius and offense-category chip groups. | `frontend/src/components/ContextStrip.test.tsx`: `"opens the editor on click and patches the radius"`, `"patches the offense category"` |
| Share links | `ContextStrip`'s **Copy link** button (build + clipboard write); consuming end: `?view=` hydration on mount (points and compare payloads alike). | `frontend/src/components/ContextStrip.test.tsx`: `"copies the share link and flashes a transient Copied note"`; `frontend/src/components/MapWorkspace.test.tsx`: `"ContextStrip Copy link writes the share URL and flashes Copied"`, `"hydrates a shared view from ?view= and runs the points path"`, `"hydrates a shared Compare view and renders its comparison instead of the select-two prompt"` |
| Loading a11y announcement | SSE `status` narration (`useAssistantTurn`'s `statusLine`) renders inside the rail's `aria-live="polite"` thread log during a command/chat turn. **No dedicated unit test asserts this wiring** — `statusLine` rendering and the log's `aria-live` attribute are each covered structurally but not together. | Structural: `frontend/src/components/AssistantPanel.tsx:138` (`<div className="mc-dock-log" aria-live="polite">`), `:186-188` (statusLine render inside that div); `frontend/src/lib/useAssistantTurn.ts` (`status` event → `setStatusLine`). Coordinator E2E: run `analyze_places`/`compare_places` from `ContextStrip` and confirm the in-progress status text is inside the polite log region, not a separate unannounced element. |
| Error a11y announcement | Dashboard errors (rename/save/delete/export failures) surface on `AssistantPanel`'s `errorLine`, `role="alert"`; turn-level errors (LLM outage, tool failure) append a `notice` thread item with a **Retry** action. | `frontend/src/components/AssistantPanel.test.tsx`: `"announces a non-empty errorLine as an alert on the rail"`, `"shows Retry on a notice followed only by receipts and calls onRetry"`; `frontend/src/components/MapWorkspace.test.tsx`: `"surfaces a failed rename as an alert on the rail"`; `frontend/src/lib/useAssistantTurn.test.ts`: `"llm_unreachable error on chat sets offline and appends the notice"` |
| Layer disclosures | Rehomed. `layerDisclosure(layer)` (`frontend/src/lib/layerCopy.ts`) returns the retired `CompareTab` copy verbatim for arrests/calls (null for reported); `ContextStrip` renders it as `<p className="mc-layer-note" role="note">` below the summary button, unconditionally while that layer is active (not gated on the editor being open), matching `CompareTab`'s prior unconditional placement. `.mc-layer-note` CSS was re-added (trimmed — no `strong` child rule, since the plain-string copy has no inline emphasis). | `frontend/src/lib/layerCopy.test.ts`: `"returns the retired calls-layer disclosure verbatim"`, `"returns the retired arrests-layer disclosure verbatim"`, `"has no disclosure for the reported layer"`; `frontend/src/components/ContextStrip.test.tsx`: `"shows the arrests layer disclosure below the summary, editor closed or open"`, `"shows the calls layer disclosure"`, `"has no layer disclosure for the reported layer"` |
| Baseline detail | `PlaceContextCard` (unchanged, imported directly) inside the expanded card's `mc-card-places` grid. Analyze and compare cards both retain the frozen neighborhood payload, so comparison cards preserve each address's full baseline context alongside `CompareRankedList`. | `frontend/src/components/PlaceContextCard.test.tsx`: `"shows baseline analytics behind How we know"`; integration: `frontend/src/components/AnalysisCard.test.tsx`: `"renders comparison, neighborhood trends, and incident details together when expanded"` |
| Trends | `TrendSection` (unchanged, imported directly) inside the expanded card, fetched with the card's frozen layer/category. | `frontend/src/components/TrendSection.test.tsx`: `"renders the reported title and subtitle"`, `"shows both the index and count footnotes"`; integration: `frontend/src/components/AnalysisCard.test.tsx`: `"passes the frozen layer and category to the trends fetch when expanded"` |
| Incident rows | `IncidentDetailsSection` (unchanged, imported directly) inside the expanded card. It has no dedicated test file of its own (none did before this slice either — its only prior importer was `CompareTab`, which had no incident-row-specific test) and is exercised only through its callers. | Integration: `frontend/src/components/AnalysisCard.test.tsx`: `"toggles expansion and renders MethodsAppendix + incident-details when expanded"` (asserts `getByLabelText(/near selected places/)`, the section's `aria-label`) |
| Methods | `MethodsAppendix` (unchanged, imported directly) inside the expanded card. | `frontend/src/components/MethodsAppendix.test.tsx`: `"opens from the Methods button and lists every definition"`; integration: `frontend/src/components/AnalysisCard.test.tsx`: `"toggles expansion and renders MethodsAppendix + incident-details when expanded"` |
| Export privacy toggles | `ManagePlacesModal`'s per-row **Include in export** checkbox (`sensitivity_class` normal ↔ `suppress_from_public_export`). | `frontend/src/components/ManagePlacesModal.test.tsx`: `"toggles include-in-export both directions"`; `frontend/src/components/MapWorkspace.test.tsx`: `"Manage modal export toggle calls updatePlace with the export sensitivity class"` |
| Run-scoped card exports | `AnalysisCard`'s **Export CSV** link, present only when `card.runId` is set, scoped via `?run_id=`. | `frontend/src/components/AnalysisCard.test.tsx`: `"renders a run-scoped export link when runId is set and omits it when null"`; `frontend/src/components/MapWorkspace.test.tsx`: `"the card export link carries the run-scoped run_id"` |
| Tableau CSV | `ManagePlacesModal`'s footer **Download Tableau CSV** link (`href` = the dashboard's export href). | `frontend/src/components/ManagePlacesModal.test.tsx`: `"renders the Download Tableau CSV link with the given href"`; `frontend/src/components/MapWorkspace.test.tsx`: `"Manage modal footer links to the dashboard's Tableau export href"` |
| Product caveat line | `REVISED_CAVEAT` (moved to `frontend/src/lib/layerCopy.ts`), rendered above `MethodsAppendix` in the expanded `AnalysisCard` only. | `frontend/src/components/AnalysisCard.test.tsx`: `"shows the product caveat above the methods appendix only when expanded"` |
| Copy-link status idiom | `ContextStrip`'s transient `mc-copy-status` note (`role="status"`, `aria-live="polite"`) — "Copied" / "Couldn't copy — try again." — carried over verbatim from `CompareTab`'s copy-status pattern. | `frontend/src/components/ContextStrip.test.tsx`: `"copies the share link and flashes a transient Copied note"`, `"shows a failure note when the copy handler reports failure"`, `"copy status region is polite live and empty at rest"` |
| Lookup-save ad-hoc linkage | `MapWorkspace.selectPlaceIds` calls `useAddressList.markSaved` when a newly saved place's coordinates match an existing ad-hoc list entry, linking it in place (one chip, checked) instead of dedup-adding a second row — mirrors the retired `CompareTab` row-level Save behavior. | `frontend/src/components/MapWorkspace.test.tsx`: `"saves a looked-up address to places on request"`; `frontend/src/lib/useAddressList.test.ts`: `"markSaved upgrades a matching ad-hoc entry in place (opt-in Save flow)"` |

## Known judgment items

1. **Empty-app errors announce in two `role="alert"` surfaces (intentional).** When the
   session fails to start, the same `data.error` string renders both as the map-canvas
   banner (`MapWorkspace.tsx:711`, gated on `data.places.length === 0 && list.entries.length
   === 0`) and as the rail's `errorLine` alert (`AssistantPanel.tsx:244`, always present).
   This is deliberate duplication for a first-load failure, not a bug: the map is the
   default focus before the rail is read, so the error must be visible in both places.
   Verified by `frontend/src/components/MapWorkspace.test.tsx`: `"shows an error when the
   session cannot start"` (asserts `findAllByText` returns more than one match, with the
   inline comment "Rendered by both error surfaces in an empty app: the map banner and
   the rail alert.").

2. **Local auto-run cards carry no export link/badges (`runId` null by design), and
   point-only local cards render no follow-up chips.** A share-link card whose points
   were never saved has empty `placeIds`; the chip row is suppressed for such cards
   (`MapWorkspace.tsx` followupChips memo) because the deterministic re-run commands
   need saved place ids — saving the place and analyzing restores chips.
   Share-link, lookup, and restored-session auto-runs go through `useCompare.run()`
   because the assistant tools can't take raw lat/lng points; their results synthesize
   into a `runId: null` card (`frontend/src/lib/localCard.ts`). `AnalysisCard` only
   renders the Export CSV link when `card.runId` is set, and `liveBadges` is populated
   solely from the assistant bridge's `effect.badges` (`MapWorkspace.tsx:431`), which the
   local-card completion effect never touches (`MapWorkspace.tsx:216-230`) — so a local
   card structurally cannot carry a presence badge either. Verified by
   `frontend/src/components/AnalysisCard.test.tsx`: `"renders a run-scoped export link
   when runId is set and omits it when null"`; `frontend/src/components/MapWorkspace.test.tsx`:
   `"auto-runs analysis on load with the restored selection and lands a rail card"`,
   `"legacy 1-point analyze share link auto-runs and lands as a local card on the rail"`,
   `"share-link mount auto-runs exactly once and fires no place-added offer"`,
   `"an address lookup auto-runs once and fires no place-added offer (no place saved)"`,
   `"hydrates a shared Compare view and renders its comparison instead of the select-two
   prompt"` (all assert `queryByRole("link", { name: "Export CSV" })` is absent).
