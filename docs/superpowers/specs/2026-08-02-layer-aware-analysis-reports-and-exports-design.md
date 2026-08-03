# Layer-aware analysis reports and exports — design proposal

**Date:** 2026-08-02

**Status:** revised after independent Claude Opus 4.7 review; ready for product decision,
not yet an implementation plan

**Scope:** reported incidents, arrests, and 911 calls in the map workspace and right-side
Tabby report surface

## Original prompt

> Trying to plan a more comprehensive feature based on the analysis being not great across
> different layers. Trying to understand how the analysis feature plays with each of the
> layers for arrests, calls, and crime currently, and what's shown and displayed in the right
> window, and if it's just the same report, depending on which layer you have clicked, etc. At
> the same time of thinking of designing individual reports, or at least making the aesthetic
> more obvious, I'd like the user to be able to export these reports.

## Restated goal

Make the selected data layer unmistakable, make each report honest about what its layer
measures, and let the user export the same report they saw. Preserve a common interaction
model where it helps comprehension, but stop presenting reported offenses, enforcement
activity, and requests for service as though they were interchangeable observations.

The feature must preserve CompCat's product invariant: it reports context around reported
events and must not score safety, rank places as safe or unsafe, or imply that a user was
present at an event.

## Executive recommendation

Build **one shared report framework with three explicit layer profiles**, backed by one
canonical report artifact.

- Do not build three unrelated report components. Keep a recognizable shared report
  structure, accessibility behavior, and interaction pattern.
- Do give each layer its own report title, counting unit, filter vocabulary, timestamp
  semantics, source disclosure, methods text, availability window, and selected sections.
- Replace the current client-assembled card with a typed `AnalysisReport` payload that is the
  source for both the right-side UI and all exports.
- Treat a human report and a data export as separate products: offer a print/PDF report plus
  a structured data package, rather than calling one partial CSV the report.
- Initially keep layer changes explicit: changing the map layer should mark an open report as
  historical and offer a clear action to run the corresponding new report. It should not
  silently rerun or relabel the previous result.
- At launch, omit reference-circle position and modeled multi-place inference from arrest
  and call reports. Those sections create a ranking-by-proxy even when labeled descriptive,
  and the current area-by-time model does not yet have a defensible layer-specific estimand.
  Arrest and call reports can still show raw counts by place, composition, time distribution,
  source records, coverage, and limitations.
- Keep the current reference-circle context and one canonical comparison family for reported
  incidents only. This remains reported-incident context, never a safety or risk ranking.

## What exists today

### A layer selects a dataset, not a report implementation

The three public layer values are mutually exclusive:

| UI layer | Backend source | Actual observation | Important limitation |
|---|---|---|---|
| Reported incidents | `seattle_spd_crime` | A stored reported-offense record. One report number may be linked to multiple NIBRS offense rows. | A row count is not necessarily a count of unique police reports. |
| Arrests | `seattle_spd_arrests` | An arrest record at the arrest location. The source's NIBRS description occupies the shared subcategory field; broad category values are best-effort crosswalks. | This describes enforcement activity and location, not a general measure of what happened nearby; the description is not necessarily a filed charge. |
| 911 calls | `seattle_spd_911` | One deduplicated CAD event. Queue time occupies the shared event-start field and arrival time occupies the shared reported-time field. | A call is a request for service, not a confirmed offense; the available ingest window rolls forward at 24 months. |

The mapping is defined in `app/crime/sources.py`; source-specific normalization is in
`app/crime/seattle_socrata.py`. `docs/architecture/data-model.md` records that
`report_number` is a many-to-many linkage key rather than a deduplication key.

Once selected, each source is passed into the same dashboard query and statistics services.
The data changes, but the report shape, radius logic, reference-circle method, exposure
calculation, temporal aggregation, and place-comparison engine are mostly shared.

### The right-side report is assembled in the browser

A direct Quick report currently launches multiple requests from
`frontend/src/lib/useCompare.ts`:

1. Neighborhood/reference-circle analysis.
2. Per-place detail records.
3. Place-to-place comparison when two or more places are selected.
4. A saved-place summary refresh when saved places are present.
5. A separate trend request later, when report details are expanded.

Those responses are assembled into one `AnalysisCardData` object and rendered through
`frontend/src/components/AnalysisCard.tsx`. `/dashboard/analyze` is not the report endpoint;
for saved places it persists summary rows and returns an analysis-run ID.

This has several consequences:

- The same `AnalysisCard` component renders reported incidents, arrests, and calls.
- Layer-specific behavior is mostly noun substitution, a shorter caveat, a few table-header
  changes, and suppression of compact category bars for calls.
- A partial set of endpoint successes can produce an incomplete card without a durable
  section-status record explaining what is missing.
- Directly generated cards and assistant-generated cards have different retention behavior.
- The trend is not frozen with the rest of the card and can change when an old report is
  reopened.

### Changing layers does not change the existing report

Changing the map layer clears current map results and invalidates the active analysis state.
It does not automatically rerun analysis. Existing conversation cards remain tied to their
frozen layer and become `Previous analysis` cards.

An expanded report can therefore remain focused on calls while the map has already switched
to arrests. The report keeps the old data correctly, but the UI does not provide a strong
enough layer or scope masthead to make the mismatch obvious. The live filter card that holds
the fuller arrest/call disclosure is also hidden while report details are expanded.

### The shared report contains layer-language leaks

Examples in the current expanded report include:

- `Incident types` for arrest offense descriptions and call types.
- A temporal note about each report's recorded `offense start`, even though arrests use an
  arrest timestamp and calls use queue time.
- Empty and low-data states such as `All reported`, `too few reports`, and `No incidents`.
- A single Methods appendix with reported-crime terms such as reported-event density,
  nearest incident, reported incidents per month, and NIBRS offense definitions.
- An analyzed-pin badge suffix of `inc.` for every layer.

The more complete calls-as-requests-for-service and arrests-as-enforcement disclosures live
outside the expanded report in `frontend/src/lib/layerCopy.ts`.

### Analysis behavior is not equally well matched to every layer

Single-place reports use descriptive empirical reference circles: equal-radius circles on
eligible street-segment midpoints within MCPP, sector, or city reference frames. The result
describes where the selected count falls in a reference distribution; it is not a p-value or
a personal-risk estimate.

Multi-place reports use a separate inferential comparison: area-by-time exposure,
quasi-Poisson/Wald comparisons, and Benjamini-Hochberg adjustment. The documented empirical
calibration was performed against SPD crime data, while the same engine is invoked for
arrests and calls.

Other current correctness and interpretation risks are:

- The global filter schema accepts category, subcategory, and NIBRS fields for every layer,
  even though calls have null category/NIBRS values and put call type in subcategory.
- The calls UI exposes no call-type filter.
- The trend has a fixed trailing window, accepts only layer and broad category, ignores the
  report radius and selected date window, and can zero-fill through a stale ingest period.
- Neighborhood and Compare expose two different pairwise families, which can produce
  different adjusted p-values for the same pair when three or more places are selected.
- Analyze accepts multiple radii, but Neighborhood, detail records, and export consume only
  one radius and do not consistently preserve request order.
- A record inside two overlapping place buffers appears once under each place. Aggregated
  totals do not clearly distinguish per-place rows from unique source records.
- Generic response fields such as `occurred_at`, `reported_at`, and `offense_subcategory`
  carry different real meanings by layer.
- Map coverage treats arrest sentinel `(-1, -1)` as unmappable, while neighborhood
  coordinate coverage currently treats any non-null pair as having coordinates.

### Current export is a partial recomputation, not the displayed report

There are two public CSV experiences:

1. A card-level `GET /exports/analysis.csv?run_id=...` action.
2. A Manage Places Tableau-oriented session export.

The card export is available only when the UI retains a saved-place analysis-run ID. Ad-hoc
or mixed saved/ad-hoc reports have no export action. A comparison card's run ID identifies an
auxiliary saved-summary run, not the displayed comparison.

The analytical CSV contains reference-circle rows and parameters. It omits the comparison,
trends, type mix, temporal profile, coordinate coverage, detail records, narrative, methods,
visuals, report-generation time, and data-through metadata. It recomputes reference circles
from current incidents and current place records when downloaded, so it can disagree with
the historical card that exposed the link.

The separate Tableau file is session-wide, includes a pseudonymous user hash, and has a
different schema. Both actions are labeled simply `Export CSV`.

Existing ownership checks, no-store response headers, coordinate generalization, sensitive-
place exclusion, and spreadsheet-formula escaping are good foundations to retain.

## Proposed user experience

### Shared interaction, unmistakable layer identity

The report surface keeps one common layout, with a persistent masthead supplied by the
active layer profile. Example:

> **911 Call Activity Report** · CAD events
> 0.5-mile radius · Call type: Disturbance
> Requested Jan 1–Jun 30 · Effective Mar 1–Jun 30
> Latest recorded event Jun 28 · Generated Jul 2

The masthead should stay visible in collapsed and expanded states and include:

- Report title and layer badge.
- Exact counting unit.
- Selected places and radius.
- Requested and effective date ranges.
- Filters in layer-appropriate language.
- Latest recorded event, latest row-ingest, any confirmed source-completeness watermark, and
  report-generation timestamps.
- Report completion status plus its current/different-layer/different-scope relationship to
  the live workspace.

Use neutral categorical accents to distinguish layers. Do not use red/amber/green status
colors, shields, warning triangles as general decoration, severity gradients, or other visual
language that can imply danger or safety.

### Layer profiles

| Profile | Reported incidents | Arrests | 911 calls |
|---|---|---|---|
| Report title | Reported Incident Context Report | Arrest Activity Report | 911 Call Activity Report |
| Counting unit | Reported-offense record, unless a future product decision changes it | Arrest record | Deduplicated CAD event |
| Primary filter | Incident category and offense subcategory | Arrest category and arrest offense description | Call type |
| Primary time label | Recorded offense start | Arrest time | Queued time; arrival shown separately when available |
| Required disclosure | Reported records do not establish personal presence or risk; report numbers may have multiple offense rows | Counts describe enforcement activity at arrest locations; taxonomy crosswalk may be incomplete | Calls are requests for service, not confirmed offenses; location and history are partially redacted/limited |
| Additional data-quality context | Coordinate/redaction coverage and offense-row counting | Taxonomy-crosswalk coverage and sentinel/missing-location coverage; the imported NIBRS description is not necessarily a filed charge | Rolling availability window, missing/redacted-location coverage, deduplication semantics |

Semantic profile data should come from the server in the report payload. The frontend may
own presentation tokens, but it should not maintain a second, divergent definition of the
counting unit or source limitations.

### Shared report sections

1. **Masthead and scope.** The immutable identity of this report.
2. **Summary.** Neutral, descriptive statement of observed counts and data sufficiency.
3. **Place context.** Per-place counts, type mix, temporal distribution, and coordinate
   coverage. Reported-incident reports may additionally include reference-circle context;
   arrest and call reports omit it at launch.
4. **Place comparison.** Present only for two or more places and only at the strongest level
   supported by the layer's validated method.
5. **Temporal distribution.** Frozen monthly or time-of-day distributions computed from the
   exact report scope. The current `/dashboard/trends` series is excluded from the canonical
   report because it ignores radius and requested date window and supports only a broad
   category. It may temporarily remain as a separately labeled ambient workspace panel. A
   trend can re-enter the report only after it accepts the report's radius, effective window,
   layer filter, and confirmed source-completeness bound when one exists.
6. **Source records.** A bounded, clearly truncated table with layer-appropriate time and
   subtype fields. State whether duplicate appearances across place buffers are possible.
7. **Methods and limitations.** Layer-specific definitions plus common statistical methods.

The shared skeleton may omit, add, or relabel a section through layer capabilities. It should
not force every source into crime-oriented content merely to maintain visual parity.

### Behavior when the map layer changes

Recommended behavior:

- Keep the old report frozen and visibly historical.
- Update the map immediately, as today.
- Show a persistent mismatch banner on the report: `This report uses 911 calls; the map is
  showing arrests.`
- Offer a primary action: `Run an Arrest Activity Report with these places and dates`.
- Validate the date range against the new layer before enabling the action.
- Do not silently relabel or rerun the report.

`AnalysisReport.status` describes the artifact itself (`complete`, `partial`, or
`insufficient_data`). Historical/stale framing is a client-derived
`report_relation_to_workspace` value (`current`, `different_layer`, or `different_scope`),
not an immutable report status. This keeps the same snapshot valid as the user changes the
live workspace.

When the chosen dates partly overlap source coverage, preserve the user's requested range for
explanation and offer the intersection through an explicit `Use available dates` action. When
there is no overlap, block the run and offer a reset to that layer's available default window.
All counts and date-based summaries use only the confirmed effective range. Reported-incident
rate exposure uses that same range; arrest and call reports do not claim an area-time rate
estimand at launch.

## Canonical report resource

Introduce a typed, format-neutral `AnalysisReport` resource. It may use a new persisted
model for saved-place reports and the same DTO without persistence for ad-hoc reports.

Conceptual shape:

```text
AnalysisReport
  report_id?                 # present only for persisted saved-place artifacts
  selection_kind             # single_place | multi_place
  comparison_mode            # none | descriptive | modeled
  status                     # complete | partial | insufficient_data
  schema_version
  method_version
  generated_at
  scope
    layer
    source_dataset
    counting_unit
    requested_date_range
    effective_date_range
    latest_recorded_event_date
    latest_row_ingested_at
    confirmed_data_through?  # only when backed by a source-completeness watermark
    radius_m
    filters                  # typed, layer-aware
  selection
    places[]                 # report-safe label; coordinates rounded to 3 decimals
  sections
    overview
      counting_unit
      counting_basis         # unique_source_records
      count
    place_context[]
      counting_unit
      counting_basis         # per_place_membership
      count
    reference_context[]?     # reported incidents only at launch
    comparison?              # present only when comparison_mode = modeled
    type_mix[]
    temporal[]
    coordinate_coverage[]
    records[]                # duplicate_across_places on each membership row
  section_statuses[]         # complete | omitted | failed | truncated + reason
  disclosures[]
  export_policy
```

Ownership metadata and selected saved-place IDs live only in the persisted server envelope.
They are not fields in the public `AnalysisReport` DTO or `report.json`.

Every count-bearing section and row carries both `counting_unit` and `counting_basis`.
`counting_unit` must match `scope.counting_unit`. `counting_basis` is one of
`unique_source_records` or `per_place_membership`; schema validation rejects missing or
inconsistent declarations.

Aggregate totals in the masthead, summary, and `overview.csv` deduplicate by the source
record's stable identifier across all selected buffers. Per-place sections and `records.csv`
use per-place membership so the same source record may appear under multiple overlapping
buffers; every such row sets `duplicate_across_places=true`. `metadata.json` defines both
bases and reports the number of unique records and membership rows.

`source_record_key` means the immutable stored observation identifier, not `report_number`:
one stored offense row for reported incidents, one arrest record, or one deduplicated CAD
event. The service uses the key internally to reconcile totals and set duplicate flags; the
raw key does not need to appear in user-facing artifacts.

The public surface must not leak the generic storage column name where its meaning changes.
Reported incidents expose `offense_subcategory`, arrests expose
`arrest_offense_description`, and calls expose `call_type`. `Arrest offense description` is
the NIBRS description imported from the SPD arrest source and is not represented as a filed
criminal charge.

### Service responsibilities

A new report orchestration service should:

- Resolve the owned saved-place or inline-point selection once.
- Resolve layer availability and requested/effective dates before calculation.
- Apply one radius policy. The first release should support exactly one report radius unless
  the full report and every export are designed for multiple radii.
- Apply typed, layer-valid filters and reject impossible combinations instead of returning a
  misleading zero.
- For reported incidents, generate the candidate-versus-each-alternative comparison family
  already used by `/dashboard/compare`, with one Benjamini-Hochberg adjustment across those
  `k - 1` contrasts. Remove Neighborhood's all-pairs adjusted results from the user-facing
  path in the same Phase 1 change; both families must never coexist in a released report.
- Omit reference-circle and modeled comparison sections for arrests and calls until each has
  a written estimand, a justified model, and empirical calibration.
- Decouple current reference-circle output from legacy polygon-baseline availability.
- Exclude the current scope-mismatched trend endpoint from the canonical artifact. Any future
  replacement must consume the report's radius, effective dates, layer filter, and the lesser
  of `confirmed_data_through` when available and the last complete month. Without a confirmed
  watermark it must stop at `latest_recorded_event_date` and label that weaker basis exactly.
- Freeze every displayed section and its data-quality warnings together.
- Make partial failure explicit through section statuses rather than silently degrading.
- Record row caps, truncation, coordinate coverage, and cross-buffer duplicate semantics.

Candidate public API shape:

```text
POST /dashboard/reports
GET  /dashboard/reports/{report_id}  # owned persisted saved-place reports only
DELETE /dashboard/reports/{report_id}
DELETE /dashboard/reports            # delete all owned persisted report snapshots
```

The first release creates the printable view, JSON, and CSV ZIP in the browser from the
already received frozen DTO. It does not send exact ad-hoc coordinates back through a second
render request and does not require server export routes. Persisted saved-place reports are
retrieved once and use the same client export pipeline.

The frontend continues to call only the required-session public tier. Existing internal
analysis endpoints remain internal; the new report contract must not expose them on bare
public paths.

### Saved and ad-hoc report policy

Saved-place reports can persist an owned immutable snapshot. Ad-hoc reports do not persist
server-side.

Recommended first-release policy:

- Return the same complete DTO for saved and ad-hoc reports.
- Persist saved-place report snapshots with session ownership for the existing
  `MCA_SESSION_DATA_RETENTION_DAYS` inactivity window, 30 days by default. Access remains
  bound to the signed session identity, whose absolute ceiling is also 30 days by default;
  the report adds no independent long-lived archive. Provide owned single-report and
  delete-all report routes; the existing `DELETE /sessions` only clears the cookie and must
  not be described as data erasure.
- Keep direct-report history in `sessionStorage`, capped at the ten newest snapshots. It ends
  with the browser session and is also cleared when the server issues a new identity.
- Keep ad-hoc and mixed-selection snapshots client-side and render print/JSON/data exports
  from that frozen DTO. No first-release server render endpoint receives their point scope.
- Keep exact ad-hoc coordinates only in live calculation state. Every report artifact uses
  display-safe labels and coordinates rounded to three decimal places (roughly 80–110 meters
  in Seattle), matching the current Tableau export's precision.
- Apply one explicit export allowlist to every section. No exact source-record coordinates,
  internal place IDs, owner hashes, raw source keys, or unreviewed free text enter the DTO.
  Every exported coordinate—including any retained record or reference coordinate—uses the
  same three-decimal generalization.
- Apply privacy policy before returning the DTO. Immediately before exporting a persisted
  all-saved report, refresh it through the owned `GET` route. If any selected place has been
  deleted or become sensitive, block the whole export with an explanation; do not partially
  redact or rebuild analytical values in the first release. Generate printable HTML, JSON,
  and every CSV only after that check and record `privacy_policy_checked_at` in the manifest.
- Ad-hoc and mixed reports have no server snapshot to re-evaluate. They use the policy-reduced
  DTO returned at creation and record that creation-time `privacy_policy_checked_at` in every
  export manifest. Once a DTO has reached the browser, a later policy change cannot revoke a
  copy the user already holds; the refresh is a best-effort control for persisted all-saved
  reports, not retroactive revocation.
- Do not include the stable session user hash in user-facing artifacts.

Public sharing of report URLs is out of scope. A `report_id` remains session-owned.

## Export design

### Human report

Start with a dedicated printable HTML view and print stylesheet. Browser `Print / Save PDF`
provides high visual fidelity without introducing a second server-side chart-rendering stack.
It should include the same masthead, summary, plots, tables, disclosures, and methods as the
right pane. The view is produced locally from the frozen DTO; the ZIP also includes its
`printable.html` source so its content can be verified even though browser-generated PDF bytes
vary by browser and print settings. Build it as an inert, self-contained document: HTML-escape
all labels and upstream text and include no scripts or executable user/source content.

Map imagery is optional for the first release. If included later, it must use generalized
locations, show the relevant radius explicitly, and retain coordinate-coverage disclosures.

### Data package

One flat CSV cannot faithfully represent a hierarchical report. Export a ZIP containing:

- `overview.csv`
- `places.csv`
- `reference_context.csv` when applicable (reported incidents only at launch)
- `comparison.csv` when applicable (reported incidents only at launch)
- `type_mix.csv`
- `temporal.csv`
- `records.csv`
- `report.json`
- `printable.html`
- `metadata.json`

Every table should carry `report_id` when present, layer, counting unit, counting basis,
effective dates, radius, and schema version where practical. `metadata.json` holds full
scope, provenance, counting-basis definitions, disclosures, section statuses, truncation,
privacy omissions, and SHA-256 checksums for `report.json`, `printable.html`, and every CSV.

`report.json` is a supported, versioned export artifact rather than an independently
queryable public integration API. Changes are additive within a major `schema_version`, and
major changes ship with retained schema documentation and migration notes. CompCat does not
provide a JSON re-import/render API or promise app-reader compatibility after the server's
30-day snapshot-retention window; offline consumers must dispatch on `schema_version`.

Formula-injection protection applies to user-controlled and upstream **string** cells that
begin with `=`, `+`, `-`, `@`, tab, or carriage return in every CSV, including `records.csv`
and `type_mix.csv`. Typed numeric cells remain numeric, including legitimate negative values;
the implementation must not blindly change the existing Tableau helper's treatment of `-`.

Rename the existing Manage Places action to `Export session data (Tableau CSV)` in Phase 2.
Mark the old analytical endpoint `GET /exports/analysis.csv?run_id=...` with a 30-day
deprecation header when the new export enters beta, label its temporary action `Legacy
reference-circle CSV`, and remove the action and endpoint at Phase 3 exit.

### Snapshot integrity rule

The human view, JSON, and data tables must be generated from the same frozen, already
redacted report payload.
They must not independently rerun analysis at download time.

Analytical values must not change silently. In the first release, a persisted report whose
selected place was later deleted or made sensitive is blocked from in-app export in every
format. Do not partially redact it or rebuild it against current coordinates or current
incident data.

## Statistical launch posture

The first release makes the measurement target and the permitted presentation explicit for
each source:

| Layer | Launch measurement target | Launch presentation |
|---|---|---|
| Reported incidents | Count and area-by-time density of stored reported-offense records inside the selected buffer and effective window. This is neither unique police reports nor personal risk. | Keep empirical reference-circle context. For multiple places, keep only the `/dashboard/compare` candidate-versus-each-alternative family, with its existing adequacy gates and one BH correction across the `k - 1` contrasts. Use context language, never a safe/unsafe winner. |
| Arrests | Observed arrest records at recorded arrest locations inside each selected buffer and effective window. No area-time rate estimand is claimed at launch because enforcement decisions and officer presence affect the process. | Show counts, arrest-offense-description mix, time distribution, records, and coverage. Omit reference-circle position, rate ratios, adjusted p-values, and winner/high/low ordering. When several places are selected, retain selection order and show neutral per-place sections rather than a modeled comparison. |
| 911 calls | Observed deduplicated CAD events inside each selected buffer and effective window. No area-time rate estimand is claimed at launch because calling behavior and clustered requests affect the process. | Show counts, call-type mix, time distribution, records, rolling availability, and coverage. Omit reference-circle position, rate ratios, adjusted p-values, and winner/high/low ordering. When several places are selected, retain selection order and show neutral per-place sections rather than a modeled comparison. |

Arrest or call reference context and modeled comparison can be added later only after a
written estimand, a model justified for that event-generating process, simulation and/or
empirical false-positive and interval-coverage calibration, and product-copy review. The
validation gates those optional sections; it does not block the descriptive report and
export work.

## Proposed decisions for product approval

| Decision | Recommendation |
|---|---|
| Reported-layer counting unit | Keep the current stored-offense-record unit initially, label it exactly, and separately evaluate a future unique-report metric. Do not silently change historical totals. |
| Layer change behavior | Preserve the old report and require an explicit rerun action. |
| Date coverage behavior | For partial overlap, offer the covered intersection through `Use available dates`; for no overlap, block and offer the layer's default window. Never silently pad unavailable history with zeros. |
| Freshness vocabulary | Use `latest_recorded_event_date` and `latest_row_ingested_at` until a verified per-source completeness watermark exists; reserve `confirmed_data_through` for that stronger signal. |
| Radius behavior | One radius per report in the first version. |
| Reference-circle policy | Show only for reported incidents at launch; omit for arrests and calls. |
| Arrest/call comparison | Neutral per-place descriptive sections only; omit modeled comparison until the estimand, model validity, and calibration gates pass. |
| Canonical pairwise family | For reported incidents, use `/dashboard/compare`'s candidate-versus-each-alternative family and one BH correction across `k - 1` contrasts; remove the user-facing Neighborhood all-pairs family in the same Phase 1 release. |
| Trend contract | Exclude the current scope-mismatched trend from the report. Keep it ambient and clearly separate until a replacement accepts full report scope. |
| Overlapping buffers | Aggregate counts use unique source records; per-place sections use per-place membership and flag cross-place duplicates. |
| Arrest subtype term | Use `arrest_offense_description`, labeled `Arrest offense description`, with a disclosure that it is imported NIBRS description text and not necessarily a filed charge. |
| Saved-report retention | Apply the existing owned-session inactivity policy (`MCA_SESSION_DATA_RETENTION_DAYS`, default 30); create no longer-lived report archive. |
| Human export | Printable HTML first, with Save as PDF. |
| Machine export | Canonical JSON plus a multi-table CSV ZIP. |
| Ad-hoc export | Generate every format in the browser from the frozen DTO; no second server render request or persistent ad-hoc snapshot. |
| Coordinate generalization | Round artifact coordinates to three decimal places; exact ad-hoc points stay only in live calculation state. |
| Post-creation privacy | Revalidate persisted all-saved reports immediately before export and block every format if any selected place was deleted or became sensitive. Ad-hoc/mixed exports disclose their frozen creation-time policy check. |
| Direct-report history | Keep the ten newest snapshots in `sessionStorage`; clear them with the browser session or when identity changes. |
| Dual-path exit | Keep the legacy adapter behind a flag only until Quick report and assistant parity tests pass and the new path completes a seven-day production soak; remove it no later than the release immediately following its introduction. |
| Assistant parity | Move assistant-generated reports to the canonical resource in Phase 1, before the redesigned UI and exports ship. |
| Legacy analytical CSV | Send a 30-day deprecation header at new-export beta and remove the action and endpoint at Phase 3 exit. |

## Delivery sequence

Each implementation slice should be independently shippable and gated by `make test-all`.

### Phase 0a — blocking semantic decisions

- Approve the decision table above, including counting bases, per-layer capabilities,
  retention, privacy, and export format.
- Write the layer profiles, measurement targets, freshness/watermark vocabulary, and DTO
  vocabulary as testable contract fixtures.
- Treat a change to any decision as a product change, not an implementation detail.

### Phase 0b — parallel statistical validation

- Specify and investigate defensible arrest- and call-specific estimands and models.
- Test overdispersion, interval coverage, false-positive behavior, sensitivity to clustered
  events, coordinate loss, and other layer-specific assumptions.
- Run in parallel with Phases 1–3. Gate only the optional Phase 4 introduction of arrest/call
  reference context or modeled comparison.

### Phase 1 — canonical report contract

Sequence Phase 1 through three internal gates so the production soak measures one coherent
behavior change at a time:

1. **Contract and storage:** add server-defined semantic layer profiles, typed request and
   response schemas, count-unit constraints, the report orchestration service, owned
   delete-one/delete-all behavior, retention-sweep participation, and foreign-key/deletion
   tests before persisting the first snapshot.
2. **Statistical consolidation:** unify effective coverage, caps, overlap handling, and
   section statuses; exclude the legacy trend; ship the single reported-incident pairwise
   family and remove Neighborhood's user-facing all-pairs result in the same change.
3. **Producer parity and soak:** return the same DTO for saved and ad-hoc scopes, move Quick
   report and assistant creation to it, run parity tests, and complete the seven-day soak.
   Keep the existing UI through a flagged adapter only during this gate, and remove the
   adapter no later than the release immediately following its introduction.

### Phase 2 — layer-aware right pane

- Apply the Phase 1 server-defined semantic profiles through frontend presentation profiles.
- Add persistent report masthead, scope, mismatch state, and explicit rerun action.
- Replace all shared crime-language leaks with layer-appropriate copy.
- Add call-type and arrest-offense-description filtering where supported.
- Render sections from the canonical report DTO, including explicit partial/truncated states.
- Preserve prior direct reports as session history rather than replacing them silently.
- Rename Manage Places to `Export session data (Tableau CSV)` so no two generic `Export CSV`
  actions remain.

### Phase 3 — exports

- Build the printable report from the report DTO.
- Add report JSON and multi-table data ZIP.
- Support saved, ad-hoc, and mixed export client-side under the nonpersistence policy.
- At beta start, add the 30-day deprecation header and `Legacy reference-circle CSV` label to
  the old analytical export. Remove `GET /exports/analysis.csv?run_id=...` and its UI action
  at Phase 3 exit.

### Phase 4 — hardening and optional statistical expansion

- Enable arrest/call reference or modeled comparison only if Phase 0b's estimand, validity,
  calibration, and product-copy gates pass; omission remains a valid final posture.
- Add report schema/version compatibility hardening.
- Conduct copy, accessibility, mobile, privacy, and visual-regression review.

## Acceptance criteria

- Selecting a layer never relabels old data as the new source.
- Every report shows layer, counting unit, radius, filters, requested/effective dates,
  latest recorded event, latest row-ingest, any confirmed completeness watermark, and
  generated-at time in collapsed and expanded states.
- Reported, arrest, and call reports contain no semantically incorrect shared nouns or time
  definitions.
- Impossible filters and uncovered date ranges produce validation guidance, not plausible
  zero-valued reports.
- The right pane, print view, JSON, and CSV package read from the same frozen report payload.
- Every count field in every format declares its counting unit and counting basis; aggregate
  unique-record counts and per-place membership counts reconcile under the overlap rule.
- A comparison export contains the comparison shown in the UI.
- A modeled comparison is present only for a layer with a documented estimand, justified
  model, and empirical calibration. Arrest and call reports omit it at first release.
- Saved-only, ad-hoc-only, and mixed selections all have an intentional export experience.
- Every omitted, failed, truncated, duplicate-prone, or privacy-redacted section is disclosed.
- Persisted all-saved exports refresh policy once and are wholly blocked in every format when
  a selected place was deleted or became sensitive. Ad-hoc/mixed manifests disclose that
  their privacy check was frozen at creation and cannot be retroactively revoked.
- Ownership, no-store headers, sensitivity exclusion, coordinate generalization, and formula
  escaping remain enforced.
- Export allowlist tests cover every section and reject exact coordinates, internal place
  IDs, owner hashes, raw source keys, executable HTML, and unreviewed free text.
- Formula-injection tests cover `=`, `+`, `-`, `@`, tab, and carriage-return prefixes in
  string fields while preserving typed negative numeric values.
- From the beginning of Phase 2 onward, no two user-facing actions share the ambiguous label
  `Export CSV`.
- The full test matrix covers single/multi-place × reported/arrests/calls × saved/ad-hoc,
  comparison mode, retention, deletion, sensitivity changes, stale ingests, overlap, and
  export parity.
- Product-copy guards continue to reject safety scoring, risk prediction, and safe/unsafe
  rankings.

## Out of scope

- Public or anonymously shareable report links.
- A personal safety score, danger score, or recommendation of a safe place.
- Combining the three source layers into one total.
- Combining counts across layers into an index or producing any cross-layer per-place score.
- A new map visualization or severity heatmap.
- New external datasets.
- Server-rendered PDF as a first requirement; printable HTML is the initial human artifact.
- Server-side chart image rendering in the first release.
- Silently changing the historical counting unit for existing analyses.

## Independent review record

The first draft was reviewed in a read-only Claude Code CLI session using Claude Opus 4.7,
high effort (`claude` 2.1.113). The reviewer was asked to act as a skeptical senior product
architect and applied-statistics reviewer, challenge the proposal, and spot-check its claims
against `origin/main` at `ac68758`.

Its initial verdict was conditional approval of the direction, but not approval to turn the
draft into an implementation plan. It found 10 of 12 sampled implementation claims accurate;
it marked the arrest sentinel-coordinate claim as only partially evident and one legacy-label
statement as aspirational. The revision incorporates its blocking recommendations:

- Arrest and call reference circles and modeled comparisons are omitted at launch rather
  than treated as merely uncalibrated crime-model variants.
- Every layer now has an explicit measurement target and presentation boundary.
- One reported-incident pairwise family is named and the competing user-facing family has a
  removal milestone.
- The scope-mismatched trend is removed from the canonical artifact.
- Overlap, counting bases, arrest subtype vocabulary, retention, ad-hoc handling, coordinate
  precision, privacy revalidation, checksum scope, migration exit, and assistant parity are
  concrete decisions rather than placeholders.
- Phase 0 is split so statistical research runs in parallel and gates only optional later
  sections.

The second pass returned **PASS with no remaining blockers**. Its five non-blocking
refinements were incorporated, and a final delta pass on the exact handoff version also
returned **PASS**. The method, findings, and disposition are preserved in
[`docs/reviews/2026-08-02-layer-aware-analysis-reports-opus-review.md`](../../reviews/2026-08-02-layer-aware-analysis-reports-opus-review.md).

## Audit basis

This proposal was derived from a read-only audit of the current `origin/main` implementation
at commit `ac68758`, including:

- `docs/architecture/overview.md`
- `docs/architecture/api.md`
- `docs/architecture/data-model.md`
- `docs/analysis/`
- `app/api/routes_public_dashboard.py`
- `app/services/dashboard_analysis_service.py`
- `app/services/neighborhood_service.py`
- `app/services/analysis_service.py`
- `app/services/trends_service.py`
- `app/services/export_service.py`
- `frontend/src/lib/useCompare.ts`
- `frontend/src/components/AnalysisCard.tsx`
- `frontend/src/components/MapWorkspace.tsx`
- `frontend/src/components/ContextStrip.tsx`
- `frontend/src/lib/layerCopy.ts`
