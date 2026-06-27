# Neighborhood Verdict Methodology Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the place-vs-beat neighborhood verdict use a rest-of-beat baseline (so a place is not compared against itself) and an on-screen CI that cannot contradict the verdict badge.

**Architecture:** A small shared-engine change in `rate_tests.py` makes the displayed CI and the decision p-value dual (one phi-aware Wald log-rate-ratio SE) and keeps the exact-conditional p as a supplementary stat; `neighborhood_service.py` carves the place buffer out of the beat baseline; the frontend demotes and relabels the CI. The CI formulas are unchanged, so only the non-overdispersed `p_value` and the `method` string move.

**Tech Stack:** Python, FastAPI, SQLAlchemy, pytest, ruff; React, TypeScript, Vitest, Vite.

**Spec:** `docs/superpowers/specs/2026-06-26-neighborhood-verdict-methodology-design.md`

**Worktree/branch:** `.worktrees/neighborhood-stats-methodology` on `claude/neighborhood-stats-methodology`. Run all commands from the worktree root.

---

## File Structure

- `app/analysis/schemas.py` — `RateTestResult` gains `exact_p_value: float | None`.
- `app/analysis/rate_tests.py` — `compare_incident_rates` unifies on one phi-aware Wald SE; `p_value` becomes Wald-z in both branches; `method` becomes `wald_log_rate_ratio` / `quasi_poisson_log_rate_ratio`; adds `exact_p_value`.
- `app/services/neighborhood_service.py` — rest-of-beat count/exposure, `combined_monthly = place + rest`, `baseline_too_small` guard, `exact_p_value` in the payload.
- `app/analysis/beat_baselines.py` — `PlaceVsBeat` gains `exact_p_value`.
- `frontend/src/types.ts` — `NeighborhoodPlace` gains `exact_p_value`.
- `frontend/src/components/AnalyzeTab.tsx` — CI moves from the verdict line into analytical detail; baseline relabelled; exact p shown.
- `frontend/src/lib/methodsDefinitions.ts` — copy updates for the rest-of-beat baseline, the per-comparison CI, and the ≥25% gate.
- `docs/superpowers/specs/2026-06-25-analyze-neighborhood-baseline-design.md` — Decision #1 updated.
- Tests: `tests/test_analysis_rate_tests.py`, `tests/test_neighborhood_service.py`, `tests/test_neighborhood_stats_quality.py`, `tests/test_beat_baselines.py`, `tests/test_statistical_comparison_*.py`, `frontend/src/components/AnalyzeTab.test.tsx` (and the methods-coverage test).

---

## Task 1: Engine — dual CI/p-value + supplementary exact p

**Files:**
- Modify: `app/analysis/schemas.py`
- Modify: `app/analysis/rate_tests.py`
- Test: `tests/test_analysis_rate_tests.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_analysis_rate_tests.py` (the file already imports `compare_incident_rates`; add `ALPHA` to that import):

```python
def test_ci_and_p_value_are_dual_in_non_overdispersed_branch():
    # The decision p-value and the 95% CI now come from one phi-aware Wald SE,
    # so "p < ALPHA" must be exactly equivalent to "the 95% CI excludes 1".
    for count_a, exposure_a, count_b, exposure_b in [
        (5, 100.0, 40, 100.0),   # clearly lower
        (30, 100.0, 33, 100.0),  # borderline
        (20, 100.0, 22, 100.0),  # not clear
    ]:
        result = compare_incident_rates(
            count_a=count_a, exposure_a=exposure_a, count_b=count_b, exposure_b=exposure_b
        )
        excludes_one = result.ci_lower > 1.0 or result.ci_upper < 1.0
        assert (result.p_value < ALPHA) == excludes_one
        assert result.method == "wald_log_rate_ratio"
        assert result.exact_p_value is not None


def test_overdispersed_branch_has_no_exact_p_value():
    result = compare_incident_rates(
        count_a=8, exposure_a=100.0, count_b=40, exposure_b=100.0, overdispersion_phi=3.0
    )
    assert result.method == "quasi_poisson_log_rate_ratio"
    assert result.exact_p_value is None
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_analysis_rate_tests.py::test_ci_and_p_value_are_dual_in_non_overdispersed_branch tests/test_analysis_rate_tests.py::test_overdispersed_branch_has_no_exact_p_value -q`
Expected: FAIL — `RateTestResult` has no attribute `exact_p_value`, and `method` is `exact_conditional_poisson`.

- [ ] **Step 3: Add `exact_p_value` to `RateTestResult`**

In `app/analysis/schemas.py`, add the field at the end of the `RateTestResult` dataclass (after `caveat_text`):

```python
    caveat_text: str
    exact_p_value: float | None = None
```

- [ ] **Step 4: Rewrite `compare_incident_rates`**

In `app/analysis/rate_tests.py`, replace the body from `rate_ratio = ...` through the `return RateTestResult(...)` with:

```python
    rate_ratio = (safe_count_a / exposure_a) / (safe_count_b / exposure_b)
    phi = overdispersion_phi or 1.0
    se_log_rr = math.sqrt(phi * ((1 / safe_count_a) + (1 / safe_count_b)))

    # The displayed CI and the decision p-value are derived from ONE phi-aware Wald
    # standard error, so "p_value < ALPHA" is dual to "the 95% CI excludes 1".
    z_value = abs(math.log(rate_ratio)) / se_log_rr if se_log_rr else 0.0
    p_value = math.erfc(z_value / math.sqrt(2))
    ci_lower = math.exp(math.log(rate_ratio) - Z_975 * se_log_rr)
    ci_upper = math.exp(math.log(rate_ratio) + Z_975 * se_log_rr)

    if phi > DISPERSION_THRESHOLD:
        method = "quasi_poisson_log_rate_ratio"
        overdispersion_status = "overdispersed"
        exact_p_value: float | None = None
    else:
        method = "wald_log_rate_ratio"
        overdispersion_status = "poisson_ok"
        # Retained for transparency; shown as a supplementary statistic, not decided on.
        exact_p_value = _exact_conditional_poisson_p_value(
            count_a=count_a,
            exposure_a=exposure_a,
            count_b=count_b,
            exposure_b=exposure_b,
        )

    return RateTestResult(
        count_a=count_a,
        count_b=count_b,
        exposure_a=exposure_a,
        exposure_b=exposure_b,
        rate_a=raw_rate_a,
        rate_b=raw_rate_b,
        rate_ratio=rate_ratio,
        ci_lower=ci_lower,
        ci_upper=ci_upper,
        p_value=p_value,
        method=method,
        overdispersion_phi=overdispersion_phi,
        overdispersion_status=overdispersion_status,
        used_continuity_correction=used_correction,
        caveat_text=" ".join(caveats),
        exact_p_value=exact_p_value,
    )
```

- [ ] **Step 5: Update existing assertions for the new method/p semantics**

The non-overdispersed `method` string changed. Find every literal and update it:

Run: `grep -rn "exact_conditional_poisson" tests/ app/`

In `tests/test_analysis_rate_tests.py`, change the two assertions `assert ... .method == "exact_conditional_poisson"` (in `test_compare_incident_rates_finds_lower_rate_with_exact_method` and the dispersion-comparison test) to `== "wald_log_rate_ratio"`. Leave `quasi_poisson_log_rate_ratio` assertions unchanged. Update any other test file the grep reports (e.g. `tests/test_statistical_comparison_service.py`, `tests/test_assistant_tools.py`) the same way. The only `app/` hit is the literal inside `rate_tests.py` itself (already handled).

- [ ] **Step 6: Run the rate-tests file and the grep-reported files**

Run: `.venv/bin/python -m pytest tests/test_analysis_rate_tests.py -q`
Expected: PASS. If `test_..._dispersion...` asserts `adjusted.p_value > poisson.p_value`, it still holds (phi>1 inflates the SE → larger p); if any other reported file fails on a `p_value`/decision numeric, re-pin it to the printed value and note it in the commit body.

- [ ] **Step 7: Commit**

```bash
git add app/analysis/schemas.py app/analysis/rate_tests.py tests/test_analysis_rate_tests.py tests/test_statistical_comparison_service.py tests/test_assistant_tools.py
git commit -m "fix: make rate-test CI and p-value dual, keep exact p as supplementary"
```
(Only `git add` the test files the grep actually changed.)

---

## Task 2: Rest-of-beat baseline + baseline_too_small guard

**Files:**
- Modify: `app/services/neighborhood_service.py`
- Modify: `app/analysis/beat_baselines.py`
- Test: `tests/test_neighborhood_service.py`, `tests/test_neighborhood_stats_quality.py`

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_neighborhood_service.py` (it already imports `neighborhood_analysis_for_places` and `session_with_places_and_beat_crime`):

```python
def test_baseline_excludes_place_buffer_incidents(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=[place_id], radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"M2": 3.0},
    )
    place = result["places"][0]
    # 5 incidents are within the 250 m buffer; 8 are elsewhere in beat M2.
    # The baseline is now the REST of the beat, so the 5 are carved out.
    assert place["place_incident_count"] == 5
    assert place["beat_incident_count"] == 8
    assert place["baseline_available"] is True
    assert place["exact_p_value"] is not None


def test_oversized_buffer_marks_baseline_too_small(tmp_path):
    session, user_hash, place_id = session_with_places_and_beat_crime(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=[place_id], radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"M2": 0.1},  # buffer (~0.196 km^2) is larger than the beat
    )
    place = result["places"][0]
    assert place["minimum_data_status"] == "baseline_too_small"
    assert place["decision"] == "insufficient_data"
```

Add to `tests/test_neighborhood_stats_quality.py` an inline hotspot fixture and test (it already imports `create_app`, `get_sessionmaker`, `CrimeIncident`, `PlaceCluster`, `public_user_hash`, `neighborhood_analysis_for_places`, `UTC`, `date`, `datetime`):

```python
def _session_with_hotspot_place(tmp_path):
    """12 incidents inside the 250 m buffer (2/month, low temporal dispersion) and 6
    elsewhere in the same beat (1/month). With the rest-of-beat baseline the contrast
    is sharp and not overdispersed, so the verdict is 'above_clear'."""
    from fastapi.testclient import TestClient

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'hot.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    plat, plon = 47.6100, -122.3300
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="hot", user_id_hash=user_hash, cluster_version="t", cluster_method="manual",
            centroid_latitude=plat, centroid_longitude=plon,
            display_latitude=plat, display_longitude=plon, visit_count=5,
            inferred_place_type="manual_place", sensitivity_class="normal",
            display_label="Hot", label_source="test",
        )
    )
    for month in range(1, 7):
        for k in range(2):
            session.add(
                CrimeIncident(
                    id=f"hot-near-{month}-{k}",
                    offense_start_utc=datetime(2026, month, 10, tzinfo=UTC),
                    offense_category="PROPERTY", beat="Z9",
                    latitude=plat + 0.0005 + k * 0.0002, longitude=plon,
                )
            )
    for month in range(1, 7):
        session.add(
            CrimeIncident(
                id=f"hot-far-{month}",
                offense_start_utc=datetime(2026, month, 20, tzinfo=UTC),
                offense_category="PROPERTY", beat="Z9",
                latitude=plat + 0.02, longitude=plon + 0.02 + month * 0.0005,
            )
        )
    session.commit()
    return session, user_hash


def test_hotspot_reads_above_clear_after_removing_self_dilution(tmp_path):
    session, user_hash = _session_with_hotspot_place(tmp_path)
    result = neighborhood_analysis_for_places(
        session=session, user_id_hash=user_hash, place_ids=["hot"], radius_m=250,
        analysis_start_date=date(2026, 1, 1), analysis_end_date=date(2026, 6, 30),
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        area_lookup={"Z9": 3.0},
    )
    place = result["places"][0]
    assert place["place_incident_count"] == 12
    assert place["beat_incident_count"] == 6  # rest of beat only
    assert place["decision"] == "above_clear"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_neighborhood_service.py::test_baseline_excludes_place_buffer_incidents tests/test_neighborhood_service.py::test_oversized_buffer_marks_baseline_too_small "tests/test_neighborhood_stats_quality.py::test_hotspot_reads_above_clear_after_removing_self_dilution" -q`
Expected: FAIL — `beat_incident_count` is 13 (whole beat), there is no `baseline_too_small` status, and `exact_p_value` is missing.

- [ ] **Step 3: Add `exact_p_value` to `PlaceVsBeat`**

In `app/analysis/beat_baselines.py`, add the field to the `PlaceVsBeat` dataclass (after `decision`):

```python
    decision: str
    exact_p_value: float | None = None
```

And in `place_vs_beat`, pass it through in the `return PlaceVsBeat(...)` (add after `decision=decision,`):

```python
        decision=decision,
        exact_p_value=test.exact_p_value,
```

- [ ] **Step 4: Carve the buffer out of the beat in `neighborhood_service.py`**

In the first loop of `neighborhood_analysis_for_places`, replace the block from `beat_incidents = _beat_incidents(...)` through the `raw.append({...})` (the valid-beat branch, roughly lines 153–196) with:

```python
        beat_incidents = _beat_incidents(
            session,
            beat,
            analysis_start_date,
            analysis_end_date,
            offense_category,
            offense_subcategory,
            nibrs_group,
        )
        # Rest of beat: the surrounding baseline EXCLUDING the place's own buffer, so the
        # place is not compared against itself. Carve the buffer out by distance (incidents
        # with missing coordinates are kept in the baseline, the conservative choice).
        rest_incidents = [
            incident
            for incident in beat_incidents
            if incident.latitude is None
            or incident.longitude is None
            or haversine_m(
                cluster.display_latitude,
                cluster.display_longitude,
                incident.latitude,
                incident.longitude,
            )
            > radius_m
        ]
        place_exposure = _place_exposure_km2_days(radius_m, days)
        buffer_km2 = pi * radius_m * radius_m / 1_000_000.0
        rest_area = area - buffer_km2
        if rest_area <= 0 or not rest_incidents:
            raw.append(
                {
                    "cluster": cluster,
                    "beat": beat,
                    "place_incidents": place_incidents,
                    "baseline_too_small": True,
                }
            )
            continue
        rest_exposure = rest_area * days
        place_monthly = _monthly_counts(place_incidents, analysis_start_date, analysis_end_date)
        rest_monthly = _monthly_counts(rest_incidents, analysis_start_date, analysis_end_date)
        combined_monthly = [
            p + r for p, r in zip(place_monthly, rest_monthly, strict=True)
        ]
        # Decide on the overdispersion-aware p-value computed from the place-vs-rest series.
        dispersion = dispersion_status(combined_monthly)
        place_test = compare_incident_rates(
            count_a=len(place_incidents),
            exposure_a=max(place_exposure, 1e-9),
            count_b=len(rest_incidents),
            exposure_b=max(rest_exposure, 1e-9),
            overdispersion_phi=dispersion.phi,
        )
        p_values.append(place_test.p_value)
        raw.append(
            {
                "cluster": cluster,
                "beat": beat,
                "area": area,
                "place_incidents": place_incidents,
                "beat_incidents": rest_incidents,
                "place_exposure": place_exposure,
                "beat_exposure": rest_exposure,
                "place_monthly": place_monthly,
                "combined_monthly": combined_monthly,
            }
        )
```

- [ ] **Step 5: Handle `baseline_too_small` and surface `exact_p_value` in the second loop**

In the result-building loop, immediately after the existing `if entry.get("beat") is None or entry.get("area") is None:` block (the `baseline_unavailable` branch), add:

```python
        if entry.get("baseline_too_small"):
            places.append(
                {
                    **base,
                    "baseline_available": False,
                    "decision": "insufficient_data",
                    "minimum_data_status": "baseline_too_small",
                    "place_incident_count": len(entry.get("place_incidents", [])),
                    "type_mix": _type_mix(entry.get("place_incidents", [])),
                }
            )
            continue
```

Then in the valid-place dict appended at the end of that loop, add `exact_p_value` (after `"adjusted_p_value": result.adjusted_p_value,`):

```python
                "adjusted_p_value": result.adjusted_p_value,
                "exact_p_value": result.exact_p_value,
```

- [ ] **Step 6: Re-pin the existing overdispersion quality test**

In `tests/test_neighborhood_stats_quality.py::test_overdispersed_place_verdict_honors_overdispersion`, the beat count is now the rest of the beat (40 total − 13 in-buffer = 27). Change:

```python
    assert place["beat_incident_count"] == 27
```

(`place_incident_count == 13`, `overdispersion_status == "overdispersed"`, `adjusted_p_value > 0.05`, and `decision == "not_clear"` all still hold — removing the double-count lowers φ from ~53 to ~40 but the quasi-Poisson test is still not significant.)

- [ ] **Step 7: Run the targeted tests**

Run: `.venv/bin/python -m pytest tests/test_neighborhood_service.py tests/test_neighborhood_stats_quality.py tests/test_beat_baselines.py -q`
Expected: PASS. If `tests/test_beat_baselines.py::test_place_vs_beat_reports_ratio_and_above` shifts (it calls `place_vs_beat` directly, now Wald-z), confirm it still reads `above_clear`; re-pin only if a numeric assertion drifts.

- [ ] **Step 8: Commit**

```bash
git add app/services/neighborhood_service.py app/analysis/beat_baselines.py tests/test_neighborhood_service.py tests/test_neighborhood_stats_quality.py
git commit -m "fix: compare each place to the rest of its beat, not the whole beat"
```

---

## Task 3: Frontend — demote CI, relabel baseline, show exact p

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/components/AnalyzeTab.tsx`
- Modify: `frontend/src/lib/methodsDefinitions.ts`
- Test: `frontend/src/components/AnalyzeTab.test.tsx` (and the methods-coverage test, whichever file holds it)

- [ ] **Step 1: Read the existing AnalyzeTab/methods tests**

Run: `ls frontend/src/components/*.test.tsx frontend/src/lib/*.test.ts 2>/dev/null` and open the AnalyzeTab test plus the methods-coverage test. Note how a `NeighborhoodPlace` fixture is built and how the coverage test enumerates rendered measures, so the new assertions match existing patterns.

- [ ] **Step 2: Write the failing test**

In the AnalyzeTab test file, add a test asserting the CI is no longer on the verdict line and now appears in the analytical detail. Use the file's existing render helper / fixture shape; the assertions are:

```tsx
it("shows the confidence interval in analytical detail, not on the verdict line", () => {
  // render AnalyzeTab with a neighborhood place that has ci_lower/ci_upper set,
  // using this file's existing render helper and NeighborhoodPlace fixture.
  const verdict = screen.getByLabelText(/Verdict for/i);
  const sub = verdict.querySelector(".mc-verdict-sub")!;
  expect(sub.textContent).not.toMatch(/95% CI/);
  const details = verdict.querySelector(".mc-analytical")!;
  expect(details.textContent).toMatch(/95% CI/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd frontend && npm test -- AnalyzeTab`
Expected: FAIL — the CI string is currently on `.mc-verdict-sub`.

- [ ] **Step 4: Add `exact_p_value` to the type**

In `frontend/src/types.ts`, add to the `NeighborhoodPlace` type (next to `adjusted_p_value?: number;`):

```ts
  exact_p_value?: number | null;
```

- [ ] **Step 5: Move the CI and relabel the baseline in `AnalyzeTab.tsx`**

In `VerdictBlock`, replace the `mc-verdict-sub` paragraph (the one that interpolates the rate comparison and the `95% CI` clause) with:

```tsx
          <p className="mc-verdict-sub">
            {place.place_label} vs surrounding beat {place.beat} (excludes this area): {place.place_rate?.toFixed(2)} vs {place.beat_rate?.toFixed(2)} /km²·day
          </p>
```

Then inside the `<dl>` in `<details className="mc-analytical">`, add a CI row as the first child and an exact-p row after the method row, and a clarifying note before `</details>`:

```tsx
              <div><dt>95% CI (this comparison)</dt><dd>{place.ci_lower != null ? `${place.ci_lower.toFixed(1)}–${place.ci_upper?.toFixed(1)}×` : "—"}</dd></div>
              <div><dt>Adjusted p-value</dt><dd>{place.adjusted_p_value?.toFixed(3)}</dd></div>
              <div><dt>Exact p-value</dt><dd>{place.exact_p_value != null ? place.exact_p_value.toFixed(3) : "—"}</dd></div>
              <div><dt>Dispersion</dt><dd>{place.overdispersion_status}</dd></div>
              <div><dt>Method</dt><dd>{place.method}</dd></div>
              <div><dt>Adequacy</dt><dd>{place.minimum_data_status}</dd></div>
              <div><dt>Nearest</dt><dd>{place.nearest_incident_m != null ? `${Math.round(place.nearest_incident_m)} m` : "—"}</dd></div>
```

And just before the closing `</details>` (after the type-mix list), add:

```tsx
            <p className="mc-analytical-note">
              The 95% CI is for this single comparison. The verdict also adjusts for
              comparing multiple places (Benjamini–Hochberg) and requires at least a 25%
              rate difference, so a CI that only just clears 1× can still read “not clear.”
            </p>
```

- [ ] **Step 6: Update the methods copy**

In `frontend/src/lib/methodsDefinitions.ts`, replace the `beatBaselineRate` and `confidenceInterval` entries with:

```ts
  { id: "beatBaselineRate", term: "Surrounding-beat baseline", shownAs: "Beat M2",
    plain: "The rest of your place's SPD police beat (2018-present), EXCLUDING the area inside your search radius, used as the 'normal for this area' reference. The same filters apply.",
    howToRead: "Your place is compared to its surroundings, not to itself." },
  { id: "confidenceInterval", term: "95% confidence interval", shownAs: "2.1–7.6×",
    plain: "The plausible range for the ratio given the sample size, for this single place-vs-beat comparison.",
    howToRead: "Shown in the analytical detail. The verdict also adjusts for comparing several places and requires the ratio past 1.25× / 0.8×, so a CI that just clears 1× may still read 'not clear.' Wider = less certain." },
```

If Step 1 showed the coverage test enumerates a measure for the exact p (e.g. an ⓘ-anchored term), add an entry:

```ts
  { id: "exactPValue", term: "Exact p-value", shownAs: "0.012",
    plain: "A small-sample exact conditional Poisson p-value, shown for transparency. The verdict is decided on the interval-consistent (Wald) p-value instead.",
    howToRead: "Supplementary — the badge does not depend on it." },
```

- [ ] **Step 7: Run frontend tests and build**

Run: `cd frontend && npm test -- AnalyzeTab Methods && npm run build`
Expected: PASS, and the build succeeds. If the methods-coverage test fails because a rendered ⓘ term lacks a definition, add its entry (Step 6).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types.ts frontend/src/components/AnalyzeTab.tsx frontend/src/components/AnalyzeTab.test.tsx frontend/src/lib/methodsDefinitions.ts
git commit -m "feat: move neighborhood CI to analytical detail and relabel as rest-of-beat"
```

---

## Task 4: Update the neighborhood baseline spec

**Files:**
- Modify: `docs/superpowers/specs/2026-06-25-analyze-neighborhood-baseline-design.md`

- [ ] **Step 1: Update Decision #1 and the CI presentation**

In that spec, change Decision #1 from "Baseline = the place's own SPD police beat" to the rest-of-beat definition, and add a one-line note that the on-screen CI is shown in analytical detail (dual to the decision p-value, labelled per-comparison). Use this replacement for Decision #1:

```markdown
1. **Baseline = the rest of the place's own SPD police beat** (2018-present geometry),
   i.e. the beat with the place's search-radius buffer carved out, so a place is never
   compared against itself. Each place is scored as an exposure-adjusted rate (incidents
   per km²·day) and compared to that rest-of-beat rate. The 95% CI shown for the ratio is
   dual to the decision p-value (one phi-aware Wald SE) and is presented in the analytical
   detail, labelled as a single-comparison interval.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-25-analyze-neighborhood-baseline-design.md
git commit -m "docs: update neighborhood baseline spec for rest-of-beat + coherent CI"
```

---

## Task 5: Full verification gate

- [ ] **Step 1: Run the full gate**

Run: `make test-all`
Expected: pytest, ruff, frontend `npm test`, and `npm run build` all pass.

- [ ] **Step 2: Fix any stragglers**

If any other suite asserts the old `method` string, the whole-beat count, or a moved verdict, re-pin it to the new value (the change is intended and documented in the spec's behavior-change note). Re-run `make test-all` until green.

- [ ] **Step 3: Final status check**

Run: `git status --short --branch`
Expected: only the intended files changed; `app/static/dashboard/` artifacts remain ignored.

---

## Self-Review

- **Spec coverage:** #2 rest-of-beat (Task 2 carving + exposure + `baseline_too_small` + dispersion fix); #3 dual CI/p + exact p (Task 1) and CI demotion/labeling + gate copy (Task 3); engine-wide so Compare inherits (Task 1 grep-sweep + Task 5); spec update (Task 4); regression pins (hotspot flip, `baseline_too_small`, dual property, re-pinned quality test). Covered.
- **Placeholders:** none — every code step shows the code; the two read-first steps (Task 3 Step 1, and the grep in Task 1 Step 5) are discovery against real files, not deferred work.
- **Type consistency:** `exact_p_value` is added to `RateTestResult` (Task 1), threaded through `PlaceVsBeat` (Task 2), into the payload dict (Task 2), into the `NeighborhoodPlace` TS type (Task 3), and rendered (Task 3) — consistent name throughout. `method` values (`wald_log_rate_ratio` / `quasi_poisson_log_rate_ratio`) are consistent across Tasks 1 and 3.
