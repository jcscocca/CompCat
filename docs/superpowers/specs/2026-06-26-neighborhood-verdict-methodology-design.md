# Neighborhood Verdict Methodology Fix — Rest-of-Beat Baseline + Coherent CI

**Date:** 2026-06-26
**Status:** Approved for implementation
**Related:** refines `2026-06-25-analyze-neighborhood-baseline-design.md` (Decision #1).
Addresses QA issues **#2** and **#3** from the neighborhood-stats audit; follow-up to
PR #17, which fixed #1 (overdispersion-aware verdict) and #5 (minimum place count).

## Goal

Fix two methodology defects in the shipped place-vs-beat neighborhood verdict so the
contrast is independent and the on-screen statistics cannot contradict the verdict badge.

1. **#2 self-dilution.** Each place is currently compared against the *whole* beat, which
   includes the place's own incidents, and the dispersion series double-counts the place.
   Change the baseline to the **rest of the beat** (beat minus the place buffer).
2. **#3 CI/verdict incoherence.** The displayed 95% CI (always Wald) and the p-value that
   drives the badge (exact-conditional in the non-overdispersed branch, and BH-adjusted)
   come from different models and different multiplicity levels, so the on-screen CI can
   contradict the badge. Make the displayed interval **dual to the p-value that drives the
   badge**, demote it to analytical detail, and label it honestly.

## Background / current state

- `app/services/neighborhood_service.py` resolves each place's beat, counts the beat's
  incidents under the active filters (`_beat_incidents`, line ~80 — `WHERE beat == beat`,
  the *entire* beat including the place buffer), forms exposures
  (place `π·r²·days`, beat `area·days`), builds `combined_monthly = place + beat`
  (line ~165 — double-counts the place), and calls `compare_incident_rates`.
- `app/analysis/rate_tests.py::compare_incident_rates` always returns a **Wald** log-rate-
  ratio CI. The p-value depends on the branch: **quasi-Poisson Wald-z** when overdispersed
  (CI and p share one SE — already coherent), but **exact conditional Poisson** otherwise
  (CI and p come from *different* models). The decision p is then **BH-adjusted** across
  places, while the CI is never adjusted.
- `app/analysis/beat_baselines.py::neighborhood_decision` returns `above_clear` /
  `below_clear` only when `adjusted_p < 0.05` **and** the rate ratio clears a ±25% magnitude
  gate (`>= 1.25` / `<= 0.80`).
- `app/analysis/comparison.py` (Compare tab + pairwise) shares the same `rate_tests`
  engine and therefore the same latent CI/p mismatch.

## Decisions (approved in brainstorming)

1. **Baseline = rest of beat** (exclude the place buffer).
2. **CI coherence = coherent CI + honest labeling.** The badge is driven by the phi-aware
   **Wald log-rate-ratio z-test** p-value (BH-adjusted), which is dual to the displayed Wald
   CI. The exact-conditional p is retained and shown as a supplementary statistic. The CI
   moves into analytical detail, labeled per-comparison; copy explains the ≥25% gate.
3. **Engine-wide.** The #3 coherence change lands in the shared `rate_tests` engine, so the
   Compare tab / pairwise path becomes coherent too. Compare verdicts may move in edge
   cases; regression tests pin behavior.
4. **Decision statistic** in the non-overdispersed branch changes from exact-conditional to
   Wald-z (so it is dual to the CI). Mitigated by the existing adequacy gates (≥30 days,
   ≥10 combined, ≥3 place) and the continuity correction. The exact-conditional p remains
   computed and displayed.

## Architecture / mechanism

### Engine — `app/analysis/rate_tests.py`

`compare_incident_rates` computes one phi-aware Wald log-RR standard error in **both**
branches: `se = sqrt(phi * (1/a + 1/b))` with `phi = 1.0` when not overdispersed and the
estimated `phi` when overdispersed. From that single SE it derives:

- the 95% CI (unchanged formula), and
- a **Wald-z** `p_value` = `erfc(|ln RR| / (se * sqrt(2)))`.

CI and `p_value` are therefore dual: `p_value < ALPHA` ⟺ the 95% CI excludes 1.0.

The exact conditional Poisson p (today's non-overdispersed computation) is retained as a
new field **`exact_p_value`** (`None` when overdispersed) for transparency.
It no longer drives any decision. `method` continues to name the SE basis
(`exact_conditional_poisson` is replaced by a Wald-based label for the decision path; the
exact p is surfaced separately).

This is the only engine change: non-overdispersed `p_value` shifts exact → Wald-z, and a
supplementary `exact_p_value` is added. All callers that decide on `p_value` (neighborhood
`place_vs_beat`, `comparison.py`, pairwise) inherit the coherent statistic automatically.

### Rest-of-beat — `app/services/neighborhood_service.py`

- **Count (exact):** carve the buffer out of the beat —
  `rest_incidents = [i for i in beat_incidents if haversine(place, i) > radius_m]`
  (incidents with null coordinates are kept in rest, the conservative choice).
  `rest_count = len(rest_incidents)`. Computing it this way (rather than
  `beat_count - place_count`) is exact regardless of beat-tag-vs-radius edge mismatches.
- **Exposure (approximated):** `rest_exposure = (area_km² − π·r²/1e6) · days`. This assumes
  the buffer lies inside the beat. When the buffer pokes outside, we subtract slightly too
  much → rest-rate biased up → ratio biased down → harder to call "above." The bias is
  conservative, consistent with the product invariant (never over-claim).
- **Dispersion:** `combined_monthly = place_monthly + rest_monthly` (removes the
  double-count; equals the true two-group combined series).
- Pass `rest_count` / `rest_exposure` to the test and to `place_vs_beat`. The BH input list
  is now Wald-z p-values (via the engine change). Surface `exact_p_value` per place.

### Decision + adequacy — `app/analysis/beat_baselines.py`

- `_minimum_data_status` gains **`baseline_too_small`**, returned when `rest_exposure <= 0`
  (buffer ≥ beat area — realistic at r=800m in a ~2 km² beat) or `rest_count == 0` (empty
  surrounding baseline). Both map to the `insufficient_data` verdict; no ratio is shown.
- `PlaceVsBeat` gains `exact_p_value`. The decision still calls `neighborhood_decision`
  with the BH-adjusted (now Wald-z) p; the ±25% magnitude gate is unchanged.

### API + UI

- `app/api/dashboard_schemas.py`: add optional `exact_p_value`. **Field names for the
  baseline stay** (`beat_rate`, `beat_incident_count`) to limit blast radius; their human
  meaning becomes "rest of beat." (A rename to `baseline_*` is an optional planning call.)
- `frontend/src/components/AnalyzeTab.tsx`: the verdict line shows **ratio + badge only**;
  the CI moves into the collapsible analytical detail, labeled *"95% CI for the rate ratio —
  this single comparison; not adjusted for comparing multiple places."* Show `exact_p_value`
  as a supplementary stat. Relabel the baseline as "surrounding beat (excludes this area)."
- `frontend/src/lib/methodsDefinitions.ts`: update `beatBaselineRate`, `confidenceInterval`,
  `rateRatio`; add copy for the ≥25% magnitude gate and the single-comparison-vs-adjusted-
  verdict distinction; add an entry for the exact p if rendered. The existing coverage test
  (every rendered measure resolves to a definition) must stay green.

## Data flow

1. User selects places, sets filters, clicks Run (unchanged).
2. `POST /dashboard/neighborhood` → per place: resolve beat, carve buffer out of the beat to
   get rest-of-beat count/exposure, compute the dual (Wald-z p, Wald CI), BH-adjust across
   places, classify with the ±25% gate.
3. UI renders one block per place: verdict line (ratio + badge), then analytical detail
   (labeled CI, exact p, φ/method, adequacy status, rest-of-beat baseline), then nearest
   incidents.

## Error handling / edge cases

- **Buffer ≥ beat, or empty surrounding baseline** → `baseline_too_small` →
  `insufficient_data`.
- **Sparse rest-of-beat** (count > 0 but small) → existing combined-count gate.
- **Null-coordinate beat incidents** → kept in rest (conservative).
- **Zero counts** → continuity correction (unchanged).

## Testing

- **rate_tests:** non-overdispersed path returns a Wald-z `p_value` plus `exact_p_value`;
  the dual property holds (`p_value < ALPHA` ⟺ CI excludes 1.0); overdispersed path
  unchanged.
- **neighborhood / beat_baselines:** rest-of-beat count and exposure are correct; the
  `baseline_too_small` guard fires for an oversized buffer and an empty rest; a hotspot
  fixture flips toward `above_clear` once self-dilution is removed; dispersion uses
  `place + rest`.
- **comparison.py / Compare:** regression tests pin the updated edge-case verdicts.
- **frontend:** the CI renders in analytical detail with its label; the verdict line carries
  no CI; the magnitude-gate copy is present; methods coverage includes the new/updated terms.
- **Gate:** `make test-all`.

## Behavior-change note

Some neighborhood verdicts move: hotspots become more likely to read `above_clear` once
self-dilution is removed, and a few non-overdispersed edge cases shift with exact → Wald-z.
Compare-tab edge cases shift for the same reason. All changes are pinned by regression
tests, and `2026-06-25-analyze-neighborhood-baseline-design.md` Decision #1 is updated from
"the place's own beat" to "rest of beat."

## Out of scope

- Exact-test CI inversion / BH-selective intervals (the rejected heavier option).
- MCPP / sector / precinct baselines and sparse-beat fallback (already future work in the
  2026-06-25 spec).
- Renaming the API baseline fields (optional; planning may decide).
