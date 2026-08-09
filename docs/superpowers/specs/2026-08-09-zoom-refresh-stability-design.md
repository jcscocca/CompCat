# Zoom interaction and viewport refresh stability — design proposal

**Date:** 2026-08-09

**Status:** revised after independent Claude review; approved for implementation

**Scope:** map wheel/trackpad zoom and viewport-driven incident-point refreshes in the
public dashboard

## Problem statement

Map navigation and map-data refresh are currently coupled too tightly. Every MapLibre
`moveend` emits new bounds. The incident-point hook treats that bounds update like a filter
change: it immediately clears the current GeoJSON and counts, waits 300 ms, then requests a
replacement. A person making several small zoom corrections therefore sees repeated
disappear/reappear cycles and can start another database query after every short pause.

The behavior was reproduced locally on the current frontend with the bundled three-record
sample:

- One small wheel gesture produced one `/dashboard/incident-points` request.
- Three small gestures about 1.1 seconds apart produced three requests and three visible
  clear/repopulate cycles.
- Each cycle restored the local sample about 0.75 seconds after the gesture and left the
  incident disclosure absent for roughly 0.3 seconds.
- Five wheel events in a rapid burst collapsed to one request, confirming that the existing
  300 ms trailing debounce works only inside a much shorter interval than normal
  adjust-and-inspect behavior.

The production endpoint can take longer because each refresh performs a conditional count,
a grouped-location count, and a grouped-location payload query over the requested date and
viewport scope. The service also documents that its `coalesce(offense_start_utc,
report_utc)` date expression is not covered by an expression index.

## Goals

- Camera movement must remain immediate and continuous even when incident data is slow.
- A viewport-only refresh must never blank successfully loaded points or counts while a
  replacement is pending.
- Ordinary zoom correction gestures should coalesce into substantially fewer requests.
- Wheel and trackpad zoom should be less aggressive than MapLibre's defaults.
- The interface must disclose a meaningfully slow background refresh without repeatedly
  interrupting screen-reader users during routine map movement.
- Layer, date, category, availability, and error changes must remain semantically honest;
  points from one query scope must never be presented as another scope.

## Non-goals

- Changing the incident-point API response shape.
- Adding client-side spatial counting or presenting cached counts as exact for a new scope.
- Adding a heatmap, changing clustering thresholds, or changing the initial camera.
- Shipping the deferred database expression index in this interaction-focused change. The
  index should be evaluated separately against production Postgres query plans.

## Proposed behavior

### 1. Tune camera input without changing controls

After MapLibre map construction, configure its existing scroll handler:

- Trackpad zoom rate: `1 / 180` instead of MapLibre's default `1 / 100`.
- Mouse-wheel zoom rate: `1 / 600` instead of MapLibre's default `1 / 450`.

Keep the zoom buttons, touch gestures, click-to-expand cluster behavior, camera fit, and
keyboard behavior unchanged. These values are initial product defaults and must be covered
by a unit test so a library upgrade cannot silently restore the more aggressive rates.

### 2. Give viewport changes a longer trailing settle window

Use one serialized refresh lane with a single timer, a single active `AbortController`, and
two possible cadences:

- **Initial valid viewport or query-scope change:** 300 ms trailing debounce, preserving
  current first-load and filter-control timing.
- **Viewport-only change after a successful response:** 700 ms trailing debounce.

Every newer change cancels the one pending timer, aborts the one prior client request, and
increments a monotonically increasing request generation. A response may commit state only
when its generation is still current and its signal is not aborted. This generation guard is
required even though `fetch` normally rejects after abort: it makes stale-response rejection
an explicit hook invariant rather than an implementation assumption.

A rapid sequence whose gaps remain below the applicable debounce produces exactly one
request for the final state. The backend may still finish a synchronous query after a client
abort, so the longer viewport window is the primary protection against starting avoidable
work.

`moveend` remains the camera event boundary. Do not emit requests from `move`, `zoom`, or
`zoomend`, and do not add geometric thresholds that could leave the `current map view`
count indefinitely stale after a small final adjustment.

### 3. Use stale-while-revalidate only inside the same query scope

Define the query scope as:

- selected layer;
- analysis start and end dates;
- offense category;
- layer availability/enabled state.

When only bounds change inside the same valid scope:

1. Keep the last successful GeoJSON and all associated counts visible.
2. Mark the hook as refreshing.
3. After the 700 ms settle window, request the final bounds.
4. Replace points and counts atomically on success.

When the query scope changes, becomes unavailable, or becomes invalid:

1. Abort pending viewport work.
2. Clear points and counts immediately so the old scope is never relabeled.
3. Fetch the valid new scope after the 300 ms filter debounce, or remain empty when the
   scope cannot be queried.

The hook must compare the semantic scope explicitly rather than inferring the change type
from whether data currently exists. This preserves correct behavior for zero-result
responses and repeated scopes.

On a failed viewport refresh after a successful same-scope response, preserve the prior
points and counts but mark them stale. The count chip must persistently say `Previous view`
until a same-scope refresh succeeds; the existing incident-layer warning explains that the
update failed. This avoids turning a transient network failure into another blank-map event
without silently labeling old bounds as current. A failed initial or query-scope request
remains empty because there is no valid same-scope response to retain.

### 4. Disclose slow background work without visual churn

Expose `refreshing` from the incident-point hook and pass it to the map disclosure.

- Keep the existing count chip and expanded details in place while refreshing.
- Show a compact `Updating…` suffix only when refresh activity lasts at least 400 ms. Apply
  `aria-busy=true` at the same delayed threshold, not immediately, so assistive-technology
  users do not lose access to the preserved count during every fast camera adjustment.
  This avoids flashing on fast local responses while giving slower production requests
  visible feedback.
- The suffix is visual status, not a new assertive or polite live-region announcement on
  every camera adjustment. The existing count announcement may update when the replacement
  response arrives.
- A stale response shows `Previous view` persistently. When a retry is also slow, the state
  may read `Previous view · Updating…`.
- Initial load retains the current behavior: the disclosure does not claim a count before
  the first response, and the first request retains the current 300 ms debounce.

### 5. Keep map source replacement atomic

`MapCanvas` continues to call `GeoJSONSource.setData` only when the incident-point
collection actually changes. A bounds-only refresh therefore leaves the current source and
any visible clustering intact until the replacement arrives. Existing incident popups
intentionally remain available while a same-scope viewport refresh is pending and close
when the collection is replaced, not merely when the camera moves.

## State model

| Situation | Existing data | Visible points/count | `refreshing` | Debounce |
|---|---:|---|---:|---:|
| Initial valid viewport | No | Empty until first response | Yes | 300 ms |
| Bounds change, same scope | Yes | Preserve previous response | Yes | 700 ms |
| Layer/date/category change | Either | Clear immediately | Yes | 300 ms |
| Disabled or invalid scope | Either | Clear immediately | No | None |
| Successful response | Either | Replace atomically | No | None |
| Failed initial/new-scope response | No valid same-scope data | Empty and warn | No | None |
| Failed viewport refresh | Yes | Preserve, mark `Previous view`, and warn | No | None |

## Acceptance criteria

- A bounds-only rerender preserves the previous GeoJSON and counts throughout debounce and
  network wait.
- A layer, date, category, disabled-state, or invalid-range change clears previous data
  immediately.
- Three viewport changes less than 700 ms apart produce one request for the final bounds.
- The first valid viewport requests after 300 ms rather than inheriting the longer viewport
  refresh delay.
- A scope change still requests after 300 ms and cannot be populated by an aborted prior
  response.
- A scope change during an active viewport debounce cancels that timer; no old-scope request
  may start afterward.
- A late response from an older request generation cannot commit even if its promise settles
  after abort.
- A successful zero-result response still counts as a successful scope: its next bounds-only
  refresh preserves the empty result and uses the 700 ms cadence.
- One small wheel gesture uses the configured slower input rates and does not blank the
  incident layer.
- A refresh lasting less than 400 ms never flashes `Updating…`; a longer refresh displays it
  while retaining the previous count, and `aria-busy` follows the same 400 ms gate.
- A failed viewport refresh retains the prior response with persistent `Previous view`
  labeling; a successful retry removes the stale state.
- An open incident popup survives the viewport debounce and pending request, then closes
  when a replacement collection commits.
- Existing cluster expansion, fly-to, fit-bounds, zoom buttons, map clicks, theme switching,
  mobile interaction blocking, and layer-error handling continue to work.
- Focused tests, the full frontend suite and build, backend tests, and Ruff all pass.

## Verification plan

### Automated

- Extend `useIncidentPoints` tests with deferred promises for same-scope preservation,
  scope-change clearing, distinct debounce durations, abort behavior, zero-result scopes,
  generation-guarded stale responses, mid-debounce scope changes, failure retention, and
  successful stale recovery.
- Extend `MapCanvas` tests to assert the exact configured trackpad rate (`1 / 180`) and wheel
  rate (`1 / 600`) and the intentional popup lifetime.
- Extend `IncidentDisclosure` tests for delayed `Updating…`, retained counts, and
  delayed `aria-busy`, plus persistent `Previous view` behavior.
- Extend `MapWorkspace` integration coverage to ensure `refreshing` reaches the disclosure.

### Browser

Using a seeded local backend and the real MapLibre canvas:

1. Perform one zoom-button step and one small wheel/trackpad-equivalent step.
2. Confirm the prior dots and count chip never disappear while the request is pending.
3. Perform five rapid wheel events and confirm one trailing incident-point request.
4. Make several paced corrections and confirm the map remains usable even if each settled
   state eventually refreshes.
5. Confirm the slow-refresh indicator appears only after its delay.

## Documentation impact

Update the architecture overview's map-layer section to describe same-scope
stale-while-revalidate behavior, the two refresh cadences, and the input-rate tuning. Keep
this design proposal and the independent review record as the rationale for the change.

## Independent review disposition

Claude's first verdict was **REVISE**. The blocking findings were the ambiguity between one
or two debounce timers, lack of an explicit stale-response guard, immediate `aria-busy`
despite delayed visual status, and an unspecified first-load delay. It also challenged
blanking the map after a transient viewport refresh failure.

This revision resolves those findings with one serialized request lane, a generation guard,
a retained 300 ms initial load, matching 400 ms visual/accessibility gates, and a truthful
stale-data state after viewport failures. The complete review record is preserved in
[`docs/reviews/2026-08-09-zoom-refresh-claude-review.md`](../../reviews/2026-08-09-zoom-refresh-claude-review.md).
