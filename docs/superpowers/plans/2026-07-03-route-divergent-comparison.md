# Route Comparison on Divergent Corridors — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-scope the route statistical comparison to divergent corridors — the segments where alternatives actually differ — so shared-corridor incidents stop diluting the test.

**Architecture:** A new pure-geometry module (`app/analysis/divergence.py`) computes divergent lengths/shares per route pair; a new engine function (`build_route_divergent_comparison` in `app/analysis/comparison.py`) runs the existing rate-test machinery on per-pair disjoint counts/exposures; `compare_route_request` feeds it via set algebra over the per-option corridor memberships it already computes. No DB migration; the site path is untouched.

**Tech Stack:** Python 3.11, FastAPI, SQLAlchemy, pytest; existing pure-Python haversine/stat helpers. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-03-route-divergent-comparison-design.md`

**Context for workers:**
- Run everything from the worktree root: `/Users/jscocca/Repos/Crime Commute Safety Tool/.worktrees/route-divergent-comparison` (note the space in the path — quote it).
- Python is the symlinked venv: `.venv/bin/python`.
- The product invariant (no safety scoring/ranking language) applies to every string you add. "Lower reported-incident rate" is allowed; "safer" is not.

---

### Task 1: Divergence geometry module

**Files:**
- Create: `app/analysis/divergence.py`
- Test: `tests/test_analysis_divergence.py` (new)

Background: `app/analysis/exposure.py` already provides `point_to_route_distance_m(lat, lon, route_points)` (min distance from a point to a polyline, meters), `route_length_km(points)`, and `analysis_days(start, end)`. `app/normalization/geo.py` provides `haversine_m(lat1, lon1, lat2, lon2)`. Coordinates below are Seattle-ish; 0.001° latitude ≈ 111 m, 0.001° longitude ≈ 75 m at this latitude.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_analysis_divergence.py`:

```python
from datetime import date

from app.analysis.divergence import (
    SAMPLE_STEP_M,
    densify_polyline,
    divergent_exposure_square_km_days,
    divergent_length_km,
    divergent_share,
)
from app.normalization.geo import haversine_m

VERTICAL_1KM = [(47.600, -122.340), (47.610, -122.340)]
VERTICAL_2KM = [(47.600, -122.340), (47.620, -122.340)]


def test_densify_polyline_keeps_endpoints_and_spacing():
    dense = densify_polyline(VERTICAL_1KM)

    assert dense[0] == VERTICAL_1KM[0]
    assert dense[-1] == VERTICAL_1KM[-1]
    assert len(dense) > 40  # ~1113 m at 25 m steps
    for start, end in zip(dense, dense[1:], strict=False):
        assert haversine_m(start[0], start[1], end[0], end[1]) <= SAMPLE_STEP_M + 0.001


def test_densify_polyline_degenerate_inputs_pass_through():
    assert densify_polyline([]) == []
    assert densify_polyline([(47.6, -122.34)]) == [(47.6, -122.34)]


def test_divergent_length_is_zero_for_identical_polylines():
    assert divergent_length_km(VERTICAL_1KM, VERTICAL_1KM, radius_m=250) == 0.0


def test_divergent_length_is_full_length_for_far_apart_polylines():
    other = [(47.600, -122.300), (47.610, -122.300)]  # ~3 km east

    result = divergent_length_km(VERTICAL_1KM, other, radius_m=250)

    assert abs(result - 1.113) < 0.06


def test_divergent_length_partial_overlap_excludes_shared_stretch():
    # Other covers the northern half of self; southern samples beyond 250 m diverge.
    other = [(47.610, -122.340), (47.620, -122.340)]

    result = divergent_length_km(VERTICAL_2KM, other, radius_m=250)

    # ~1.113 km southern half minus the 250 m radius apron ≈ 0.863 km.
    assert 0.75 < result < 0.95


def test_divergent_length_handles_multiple_divergent_runs():
    # Other covers only the middle; self diverges at both ends (diverge/rejoin/diverge).
    self_points = [(47.600, -122.340), (47.630, -122.340)]
    other = [(47.610, -122.340), (47.620, -122.340)]

    result = divergent_length_km(self_points, other, radius_m=250)

    # Two runs of ~(1.113 - 0.25) km each.
    assert 1.55 < result < 1.9


def test_divergent_length_degenerate_inputs_are_zero():
    assert divergent_length_km([(47.6, -122.34)], VERTICAL_1KM, radius_m=250) == 0.0
    assert divergent_length_km(VERTICAL_1KM, [], radius_m=250) == 0.0


def test_divergent_share_is_ratio_of_route_length():
    assert divergent_share(VERTICAL_1KM, 0.0) == 0.0
    assert abs(divergent_share(VERTICAL_1KM, 1.113) - 1.0) < 0.01
    assert divergent_share([(47.6, -122.34)], 1.0) == 0.0


def test_divergent_exposure_is_length_times_width_times_days():
    result = divergent_exposure_square_km_days(
        length_km=2.0,
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 1, 30),
    )

    assert result == 2.0 * 2 * 0.25 * 30
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_analysis_divergence.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.analysis.divergence'`

- [ ] **Step 3: Implement the module**

Create `app/analysis/divergence.py`:

```python
from __future__ import annotations

import math
from datetime import date

from app.analysis.exposure import analysis_days, point_to_route_distance_m, route_length_km
from app.normalization.geo import haversine_m

SAMPLE_STEP_M = 25.0
IDENTICAL_DIVERGENT_SHARE = 0.02


def densify_polyline(
    points: list[tuple[float, float]],
    step_m: float = SAMPLE_STEP_M,
) -> list[tuple[float, float]]:
    if len(points) < 2:
        return list(points)
    dense: list[tuple[float, float]] = [points[0]]
    for start, end in zip(points, points[1:], strict=False):
        span_m = haversine_m(start[0], start[1], end[0], end[1])
        segment_count = max(1, math.ceil(span_m / step_m))
        for index in range(1, segment_count + 1):
            fraction = index / segment_count
            dense.append(
                (
                    start[0] + (end[0] - start[0]) * fraction,
                    start[1] + (end[1] - start[1]) * fraction,
                )
            )
    return dense


def divergent_length_km(
    self_points: list[tuple[float, float]],
    other_points: list[tuple[float, float]],
    radius_m: int,
    step_m: float = SAMPLE_STEP_M,
) -> float:
    if len(self_points) < 2 or not other_points:
        return 0.0
    samples = densify_polyline(self_points, step_m)
    outside = [
        point_to_route_distance_m(latitude, longitude, other_points) > radius_m
        for latitude, longitude in samples
    ]
    total_m = 0.0
    for index in range(len(samples) - 1):
        # A span counts as divergent only when BOTH endpoints clear the radius — the
        # conservative side of the boundary spans next to the shared region.
        if outside[index] and outside[index + 1]:
            start = samples[index]
            end = samples[index + 1]
            total_m += haversine_m(start[0], start[1], end[0], end[1])
    return total_m / 1000


def divergent_share(
    self_points: list[tuple[float, float]],
    divergent_km: float,
) -> float:
    total_km = route_length_km(self_points)
    if total_km <= 0:
        return 0.0
    return min(1.0, divergent_km / total_km)


def divergent_exposure_square_km_days(
    *,
    length_km: float,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
) -> float:
    # No pi*r^2 end-cap term: divergent runs border the shared region, so the caps
    # largely fall inside corridor already covered. Documented in
    # docs/analysis/statistical-route-place-comparison.md.
    radius_km = radius_m / 1000
    return length_km * 2 * radius_km * analysis_days(analysis_start_date, analysis_end_date)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_analysis_divergence.py -v`
Expected: 9 passed

- [ ] **Step 5: Lint and commit**

```bash
.venv/bin/python -m ruff check app/analysis/divergence.py tests/test_analysis_divergence.py
git add app/analysis/divergence.py tests/test_analysis_divergence.py
git commit -m "feat(analysis): divergence geometry primitives

Densified-polyline divergent-length/share and divergent-corridor
exposure for the route comparison re-scope.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Divergent route comparison engine

**Files:**
- Modify: `app/analysis/schemas.py` (add `ROUTE_DIVERGENT_CORRIDOR` at line 14, add `PairDivergenceInput` after `RouteComparisonRequest`)
- Modify: `app/analysis/comparison.py` (add `build_route_divergent_comparison` + helpers; generalize `_not_tested_pairwise`; delete `_rate_or_zero`)
- Test: `tests/test_route_divergent_comparison.py` (new)

- [ ] **Step 1: Add the schema pieces**

In `app/analysis/schemas.py`, extend `GeometryType`:

```python
class GeometryType(StrEnum):
    PLACE_BUFFER = "place_buffer"
    ROUTE_CORRIDOR = "route_corridor"
    ROUTE_DIVERGENT_CORRIDOR = "route_divergent_corridor"
```

Immediately after the `RouteComparisonRequest` class, add:

```python
class PairDivergenceInput(BaseModel):
    option_a_id: str
    option_b_id: str
    count_a: int
    count_b: int
    exposure_a: float
    exposure_b: float
    period_counts_a: list[int]
    period_counts_b: list[int]
    divergent_share_a: float
    divergent_share_b: float
```

- [ ] **Step 2: Write the failing engine tests**

Create `tests/test_route_divergent_comparison.py`:

```python
from datetime import date

import pytest

from app.analysis.comparison import build_route_divergent_comparison
from app.analysis.schemas import (
    AnalysisOptionResult,
    DecisionClass,
    GeometryType,
    PairDivergenceInput,
)


def _option(option_id: str, label: str, incident_count: int, exposure: float = 60.0):
    return AnalysisOptionResult(
        option_id=option_id,
        option_label=label,
        geometry_type=GeometryType.ROUTE_CORRIDOR,
        radius_m=250,
        incident_count=incident_count,
        exposure=exposure,
        exposure_unit="square_km_days",
        incident_rate=incident_count / exposure if exposure > 0 else 0.0,
    )


def _build(options, pair_inputs):
    return build_route_divergent_comparison(
        user_id_hash="user",
        radius_m=250,
        analysis_start_date=date(2024, 1, 1),
        analysis_end_date=date(2024, 2, 29),
        offense_category="PROPERTY",
        offense_subcategory=None,
        nibrs_group=None,
        options=options,
        pair_inputs=pair_inputs,
    )


def test_divergent_test_fires_when_whole_corridors_look_identical():
    # Whole-corridor context: 90 vs 110 on equal exposure — the OLD framing would have
    # been not_statistically_clear (rate ratio 0.82 > 0.80). The divergent numbers are
    # decisive: 8 vs 28 on equal divergent exposure.
    result = _build(
        options=[_option("a", "Route A", 90), _option("b", "Route B", 110)],
        pair_inputs=[
            PairDivergenceInput(
                option_a_id="a",
                option_b_id="b",
                count_a=8,
                count_b=28,
                exposure_a=15.0,
                exposure_b=15.0,
                period_counts_a=[4, 4],
                period_counts_b=[14, 14],
                divergent_share_a=0.3,
                divergent_share_b=0.3,
            )
        ],
    )

    assert result.geometry_type == GeometryType.ROUTE_DIVERGENT_CORRIDOR
    assert result.decision_class == DecisionClass.STATISTICALLY_LOWER
    assert result.recommendation_option_id == "a"
    assert result.overview_summary_text.startswith("Where these routes differ, Route A")
    pairwise = result.pairwise_results[0]
    assert pairwise.incident_count_a == 8  # divergent count, not the whole-corridor 90
    assert pairwise.incident_count_b == 28
    assert pairwise.winner_option_id == "a"
    assert "share ~70% of their corridors" in pairwise.caveat_text
    # Context rows still carry whole-corridor counts.
    assert [option.incident_count for option in result.options] == [90, 110]
    verdict_text = " ".join(
        [result.overview_summary_text, result.overview_caveat_text, pairwise.caveat_text]
    ).lower()
    for banned in ("safe", "unsafe", "safety", "danger", "dangerous", "risk", "risky"):
        assert banned not in verdict_text, banned


def test_effectively_identical_corridors_report_same_corridor_outcome():
    result = _build(
        options=[_option("a", "Route A", 40), _option("b", "Route B", 41)],
        pair_inputs=[
            PairDivergenceInput(
                option_a_id="a",
                option_b_id="b",
                count_a=0,
                count_b=0,
                exposure_a=0.01,
                exposure_b=0.01,
                period_counts_a=[0, 0],
                period_counts_b=[0, 0],
                divergent_share_a=0.0,
                divergent_share_b=0.01,
            )
        ],
    )

    pairwise = result.pairwise_results[0]
    assert pairwise.minimum_data_status == "corridors_effectively_identical"
    assert pairwise.method == "not_tested_minimum_data"
    assert pairwise.p_value == 1.0
    assert result.decision_class == DecisionClass.INSUFFICIENT_DATA
    assert result.recommendation_option_id is None
    assert result.overview_summary_text == (
        "These route options follow essentially the same corridor at this radius, "
        "so there is no divergent segment to compare."
    )


def test_divergent_floors_block_near_empty_candidate():
    result = _build(
        options=[_option("a", "Route A", 30), _option("b", "Route B", 60)],
        pair_inputs=[
            PairDivergenceInput(
                option_a_id="a",
                option_b_id="b",
                count_a=1,
                count_b=20,
                exposure_a=10.0,
                exposure_b=10.0,
                period_counts_a=[1, 0],
                period_counts_b=[10, 10],
                divergent_share_a=0.4,
                divergent_share_b=0.4,
            )
        ],
    )

    assert result.pairwise_results[0].minimum_data_status == "option_count_too_low"
    assert result.decision_class == DecisionClass.INSUFFICIENT_DATA
    assert result.recommendation_option_id is None


def test_candidate_is_lowest_aggregate_divergent_rate_and_must_win_every_pair():
    # Aggregate divergent rates: a = (8+8)/(15+15) ≈ 0.53, b ≈ 1.87, c = 0.60 → candidate a.
    # a beats b decisively but a-vs-c is 8 vs 9 (ratio 0.89 > 0.80) → overall not clear.
    result = _build(
        options=[
            _option("a", "Route A", 90),
            _option("b", "Route B", 110),
            _option("c", "Route C", 95),
        ],
        pair_inputs=[
            PairDivergenceInput(
                option_a_id="a",
                option_b_id="b",
                count_a=8,
                count_b=28,
                exposure_a=15.0,
                exposure_b=15.0,
                period_counts_a=[4, 4],
                period_counts_b=[14, 14],
                divergent_share_a=0.3,
                divergent_share_b=0.3,
            ),
            PairDivergenceInput(
                option_a_id="a",
                option_b_id="c",
                count_a=8,
                count_b=9,
                exposure_a=15.0,
                exposure_b=15.0,
                period_counts_a=[4, 4],
                period_counts_b=[5, 4],
                divergent_share_a=0.25,
                divergent_share_b=0.25,
            ),
            PairDivergenceInput(
                option_a_id="b",
                option_b_id="c",
                count_a=28,
                count_b=9,
                exposure_a=15.0,
                exposure_b=15.0,
                period_counts_a=[14, 14],
                period_counts_b=[5, 4],
                divergent_share_a=0.3,
                divergent_share_b=0.25,
            ),
        ],
    )

    assert len(result.pairwise_results) == 2  # candidate vs each other option
    assert all(
        pairwise.option_a_id == "a" for pairwise in result.pairwise_results
    )
    assert result.decision_class == DecisionClass.NOT_STATISTICALLY_CLEAR
    assert result.recommendation_option_id is None
    assert result.overview_summary_text == (
        "Where these routes differ, no option has a statistically clear lower "
        "reported-incident rate under the selected filters."
    )


def test_requires_two_options_and_full_pair_coverage():
    with pytest.raises(ValueError):
        _build(options=[_option("a", "Route A", 10)], pair_inputs=[])
    with pytest.raises(ValueError):
        _build(
            options=[_option("a", "Route A", 10), _option("b", "Route B", 12)],
            pair_inputs=[],
        )
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_route_divergent_comparison.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_route_divergent_comparison'`

- [ ] **Step 4: Implement the engine**

In `app/analysis/comparison.py`:

1. Extend the imports:

```python
from app.analysis.divergence import IDENTICAL_DIVERGENT_SHARE
```

and add `PairDivergenceInput` to the existing `from app.analysis.schemas import (...)` block.

2. Replace `_not_tested_pairwise` and delete `_rate_or_zero` (it becomes unused):

```python
def _not_tested_pairwise_values(
    *,
    option_a_id: str,
    option_a_label: str,
    option_b_id: str,
    option_b_label: str,
    count_a: int,
    count_b: int,
    exposure_a: float,
    exposure_b: float,
    exposure_unit: str,
    dispersion_status_text: str,
    dispersion_phi: float | None,
    minimum_data_status: str,
    caveat_text: str,
) -> PairwiseComparisonResult:
    return PairwiseComparisonResult(
        option_a_id=option_a_id,
        option_a_label=option_a_label,
        option_b_id=option_b_id,
        option_b_label=option_b_label,
        winner_option_id=None,
        winner_label=None,
        decision_class=DecisionClass.NOT_STATISTICALLY_CLEAR,
        method="not_tested_minimum_data",
        incident_count_a=count_a,
        incident_count_b=count_b,
        exposure_a=exposure_a,
        exposure_b=exposure_b,
        exposure_unit=exposure_unit,
        rate_a=count_a / exposure_a if exposure_a > 0 else 0.0,
        rate_b=count_b / exposure_b if exposure_b > 0 else 0.0,
        rate_ratio=1.0,
        ci_lower=1.0,
        ci_upper=1.0,
        p_value=1.0,
        adjusted_p_value=1.0,
        overdispersion_phi=dispersion_phi,
        overdispersion_status=dispersion_status_text,
        minimum_data_status=minimum_data_status,
        caveat_text=caveat_text,
    )


def _not_tested_pairwise(
    *,
    candidate: AnalysisOptionResult,
    other: AnalysisOptionResult,
    dispersion_status_text: str,
    dispersion_phi: float | None,
    minimum_data_status: str,
) -> PairwiseComparisonResult:
    return _not_tested_pairwise_values(
        option_a_id=candidate.option_id,
        option_a_label=candidate.option_label,
        option_b_id=other.option_id,
        option_b_label=other.option_label,
        count_a=candidate.incident_count,
        count_b=other.incident_count,
        exposure_a=candidate.exposure,
        exposure_b=other.exposure,
        exposure_unit=candidate.exposure_unit,
        dispersion_status_text=dispersion_status_text,
        dispersion_phi=dispersion_phi,
        minimum_data_status=minimum_data_status,
        caveat_text=_pairwise_caveat(minimum_data_status, dispersion_status_text, ""),
    )
```

3. Add the route builder and helpers (place after `build_statistical_comparison`):

```python
_ROUTE_NOT_TESTED_STATUSES = {"corridors_effectively_identical", "non_positive_exposure"}


def build_route_divergent_comparison(
    *,
    user_id_hash: str,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    options: list[AnalysisOptionResult],
    pair_inputs: list[PairDivergenceInput],
) -> StatisticalComparisonResult:
    if len(options) < 2:
        raise ValueError("At least two options are required.")
    if len(pair_inputs) != len(options) * (len(options) - 1) // 2:
        raise ValueError("A divergence input is required for every option pair.")

    # Same selective-inference posture as build_statistical_comparison (selection
    # uncorrected, decision conservative), but ranked by aggregate DIVERGENT rate —
    # the divergent segments are the only regions this test evaluates.
    candidate = _divergent_candidate(options, pair_inputs)
    sides = _candidate_pair_sides(candidate.option_id, pair_inputs)

    raw_pairwise: list[PairwiseComparisonResult] = []
    p_values: list[float] = []
    for other in options:
        if other.option_id == candidate.option_id:
            continue
        side = sides[other.option_id]
        minimum_data_status = _route_minimum_data_status(
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
            side=side,
        )
        dispersion = _combined_dispersion(side.period_counts_a, side.period_counts_b)
        if minimum_data_status in _ROUTE_NOT_TESTED_STATUSES:
            pairwise = _not_tested_pairwise_values(
                option_a_id=candidate.option_id,
                option_a_label=candidate.option_label,
                option_b_id=other.option_id,
                option_b_label=other.option_label,
                count_a=side.count_a,
                count_b=side.count_b,
                exposure_a=side.exposure_a,
                exposure_b=side.exposure_b,
                exposure_unit=candidate.exposure_unit,
                dispersion_status_text=dispersion.status,
                dispersion_phi=dispersion.phi,
                minimum_data_status=minimum_data_status,
                caveat_text=_route_pairwise_caveat(
                    minimum_data_status, dispersion.status, "", side
                ),
            )
            raw_pairwise.append(pairwise)
            p_values.append(pairwise.p_value)
            continue

        rate_test = compare_incident_rates(
            count_a=side.count_a,
            exposure_a=side.exposure_a,
            count_b=side.count_b,
            exposure_b=side.exposure_b,
            overdispersion_phi=dispersion.phi,
        )
        raw_pairwise.append(
            PairwiseComparisonResult(
                option_a_id=candidate.option_id,
                option_a_label=candidate.option_label,
                option_b_id=other.option_id,
                option_b_label=other.option_label,
                winner_option_id=None,
                winner_label=None,
                decision_class=DecisionClass.NOT_STATISTICALLY_CLEAR,
                method=rate_test.method,
                incident_count_a=rate_test.count_a,
                incident_count_b=rate_test.count_b,
                exposure_a=rate_test.exposure_a,
                exposure_b=rate_test.exposure_b,
                exposure_unit=candidate.exposure_unit,
                rate_a=rate_test.rate_a,
                rate_b=rate_test.rate_b,
                rate_ratio=rate_test.rate_ratio,
                ci_lower=rate_test.ci_lower,
                ci_upper=rate_test.ci_upper,
                p_value=rate_test.p_value,
                adjusted_p_value=rate_test.p_value,
                overdispersion_phi=dispersion.phi,
                overdispersion_status=dispersion.status,
                minimum_data_status=minimum_data_status,
                caveat_text=_route_pairwise_caveat(
                    minimum_data_status, dispersion.status, rate_test.caveat_text, side
                ),
            )
        )
        p_values.append(rate_test.p_value)

    adjusted = benjamini_hochberg(p_values)
    pairwise_results: list[PairwiseComparisonResult] = []
    for pairwise, adjusted_p_value in zip(raw_pairwise, adjusted, strict=True):
        decision_class = classify_pairwise_result(
            rate_ratio=pairwise.rate_ratio,
            adjusted_p_value=adjusted_p_value,
            minimum_data_met=pairwise.minimum_data_status == "met",
            model_warning=pairwise.overdispersion_status == "insufficient_periods",
        )
        pairwise_results.append(
            pairwise.model_copy(
                update={
                    "adjusted_p_value": adjusted_p_value,
                    "decision_class": decision_class,
                    "winner_option_id": (
                        pairwise.option_a_id
                        if decision_class == DecisionClass.STATISTICALLY_LOWER
                        else None
                    ),
                    "winner_label": (
                        pairwise.option_a_label
                        if decision_class == DecisionClass.STATISTICALLY_LOWER
                        else None
                    ),
                },
            ),
        )

    overall_decision = _overall_decision(pairwise_results)
    recommendation_option_id = (
        candidate.option_id if overall_decision == DecisionClass.STATISTICALLY_LOWER else None
    )
    recommendation_label = (
        candidate.option_label if overall_decision == DecisionClass.STATISTICALLY_LOWER else None
    )
    return StatisticalComparisonResult(
        user_id_hash=user_id_hash,
        comparison_type="route",
        geometry_type=GeometryType.ROUTE_DIVERGENT_CORRIDOR,
        radius_m=radius_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        decision_class=overall_decision,
        recommendation_option_id=recommendation_option_id,
        recommendation_label=recommendation_label,
        overview_summary_text=_route_overview_summary(
            overall_decision, recommendation_label, pairwise_results
        ),
        overview_caveat_text=_overview_caveat(overall_decision),
        full_caveat_text=_full_caveat(pairwise_results),
        options=options,
        pairwise_results=pairwise_results,
    )


def _divergent_candidate(
    options: list[AnalysisOptionResult],
    pair_inputs: list[PairDivergenceInput],
) -> AnalysisOptionResult:
    totals: dict[str, tuple[int, float]] = {option.option_id: (0, 0.0) for option in options}
    for pair in pair_inputs:
        count_a, exposure_a = totals[pair.option_a_id]
        totals[pair.option_a_id] = (count_a + pair.count_a, exposure_a + pair.exposure_a)
        count_b, exposure_b = totals[pair.option_b_id]
        totals[pair.option_b_id] = (count_b + pair.count_b, exposure_b + pair.exposure_b)
    eligible = [
        (totals[option.option_id][0] / totals[option.option_id][1], index, option)
        for index, option in enumerate(options)
        if totals[option.option_id][1] > 0
    ]
    if eligible:
        return min(eligible, key=lambda item: (item[0], item[1]))[2]
    # All corridors effectively identical: no divergent exposure anywhere. Fall back to
    # the whole-corridor rate purely to structure the (all not-tested) pairwise rows.
    return min(options, key=lambda option: option.incident_rate)


def _candidate_pair_sides(
    candidate_id: str,
    pair_inputs: list[PairDivergenceInput],
) -> dict[str, PairDivergenceInput]:
    sides: dict[str, PairDivergenceInput] = {}
    for pair in pair_inputs:
        if pair.option_a_id == candidate_id:
            sides[pair.option_b_id] = pair
        elif pair.option_b_id == candidate_id:
            sides[pair.option_a_id] = _flip_pair(pair)
    return sides


def _flip_pair(pair: PairDivergenceInput) -> PairDivergenceInput:
    return PairDivergenceInput(
        option_a_id=pair.option_b_id,
        option_b_id=pair.option_a_id,
        count_a=pair.count_b,
        count_b=pair.count_a,
        exposure_a=pair.exposure_b,
        exposure_b=pair.exposure_a,
        period_counts_a=pair.period_counts_b,
        period_counts_b=pair.period_counts_a,
        divergent_share_a=pair.divergent_share_b,
        divergent_share_b=pair.divergent_share_a,
    )


def _route_minimum_data_status(
    *,
    analysis_start_date: date,
    analysis_end_date: date,
    side: PairDivergenceInput,
) -> str:
    if analysis_days(analysis_start_date, analysis_end_date) < MIN_ANALYSIS_DAYS:
        return "date_range_too_short"
    if (
        side.divergent_share_a < IDENTICAL_DIVERGENT_SHARE
        and side.divergent_share_b < IDENTICAL_DIVERGENT_SHARE
    ):
        return "corridors_effectively_identical"
    if side.exposure_a <= 0 or side.exposure_b <= 0:
        return "non_positive_exposure"
    if side.count_a < MIN_PLACE_COUNT:
        return "option_count_too_low"
    if side.count_a + side.count_b < MIN_COMBINED_COUNT:
        return "combined_count_too_low"
    return "met"


def _route_pairwise_caveat(
    minimum_data_status: str,
    overdispersion_status: str,
    rate_test_caveat: str,
    side: PairDivergenceInput,
) -> str:
    base = _pairwise_caveat(minimum_data_status, overdispersion_status, rate_test_caveat)
    shared_pct = round((1 - max(side.divergent_share_a, side.divergent_share_b)) * 100)
    note = (
        f"These routes share ~{shared_pct}% of their corridors; "
        "only the divergent segments were compared."
    )
    return " ".join(part for part in (base, note) if part)


def _route_overview_summary(
    decision_class: DecisionClass,
    recommendation_label: str | None,
    pairwise_results: list[PairwiseComparisonResult],
) -> str:
    if decision_class == DecisionClass.STATISTICALLY_LOWER and recommendation_label:
        return (
            f"Where these routes differ, {recommendation_label} has a statistically lower "
            "reported-incident rate for the selected date range and offense filter."
        )
    if pairwise_results and all(
        result.minimum_data_status == "corridors_effectively_identical"
        for result in pairwise_results
    ):
        return (
            "These route options follow essentially the same corridor at this radius, "
            "so there is no divergent segment to compare."
        )
    if decision_class == DecisionClass.INSUFFICIENT_DATA:
        return "There is insufficient data for a statistical comparison under the selected filters."
    if decision_class == DecisionClass.MODEL_WARNING:
        return "The model detected data or geometry limitations that require analytical review."
    return (
        "Where these routes differ, no option has a statistically clear lower "
        "reported-incident rate under the selected filters."
    )
```

- [ ] **Step 5: Run the new tests, then the touched suites**

Run: `.venv/bin/python -m pytest tests/test_route_divergent_comparison.py -v`
Expected: 5 passed

Run: `.venv/bin/python -m pytest tests/test_statistical_comparison_service.py tests/test_analysis_rate_tests.py -q`
Expected: all pass — the site path and `_not_tested_pairwise` wrapper are behavior-identical.

- [ ] **Step 6: Lint and commit**

```bash
.venv/bin/python -m ruff check app tests
git add app/analysis/schemas.py app/analysis/comparison.py tests/test_route_divergent_comparison.py
git commit -m "feat(analysis): route comparison engine on divergent corridors

New build_route_divergent_comparison: per-pair disjoint counts and
divergent exposures through the existing rate-test machinery, candidate
by aggregate divergent rate, corridors_effectively_identical outcome,
route-scoped verdict copy. Site path untouched.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire the route service to the divergent engine

**Files:**
- Modify: `app/services/analysis_service.py:129-226` (`compare_route_request`) plus imports
- Test: `tests/test_statistical_comparison_service.py` (extend)

- [ ] **Step 1: Write the failing end-to-end tests**

Append to `tests/test_statistical_comparison_service.py` (imports of `RouteAlternative`, `RouteRequest`, `CrimeIncident`, `RouteComparisonRequest`, `compare_route_request`, `create_app`, `get_sessionmaker` already exist at the top of the file):

```python
def test_compare_route_request_tests_divergent_corridors_only(tmp_path):
    # Two routes share a heavy-incident southern stretch on -122.340; A continues
    # straight north, B jogs east via -122.310 and rejoins at the destination. The 40
    # shared incidents land in BOTH whole corridors; the divergent test must ignore
    # them and decide on the 10-vs-150 divergent contrast.
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "route-divergence-user"
    session.add(
        RouteRequest(
            id="rr-divergent",
            user_id_hash=user_hash,
            origin_label="Origin",
            origin_latitude=47.600,
            origin_longitude=-122.340,
            destination_label="Destination",
            destination_latitude=47.630,
            destination_longitude=-122.340,
            mode="transit",
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 2, 29),
        )
    )
    session.flush()
    session.add_all(
        [
            RouteAlternative(
                id="alt-direct",
                route_request_id="rr-divergent",
                user_id_hash=user_hash,
                provider_route_id="prov-direct",
                route_label="Route A",
                rank=1,
                mode_mix="transit",
                summary_geometry="47.600,-122.340;47.630,-122.340",
            ),
            RouteAlternative(
                id="alt-jog",
                route_request_id="rr-divergent",
                user_id_hash=user_hash,
                provider_route_id="prov-jog",
                route_label="Route B",
                rank=2,
                mode_mix="transit",
                summary_geometry=(
                    "47.600,-122.340;47.615,-122.340;47.615,-122.310;"
                    "47.630,-122.310;47.630,-122.340"
                ),
            ),
        ]
    )
    # 40 shared incidents on the common southern stretch (inside BOTH 250 m corridors).
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-shared-{index}",
                offense_start_utc=datetime(
                    2024, 1 + (index % 2), 1 + (index // 2) % 27, tzinfo=UTC
                ),
                offense_category="PROPERTY",
                latitude=47.605,
                longitude=-122.340,
            )
            for index in range(40)
        ]
    )
    # 10 incidents on A's divergent northern straight (≥ 750 m from every B leg).
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-a-{index}",
                offense_start_utc=datetime(2024, 1 + (index % 2), 10 + index // 2, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.622,
                longitude=-122.340,
            )
            for index in range(10)
        ]
    )
    # 150 incidents on B's divergent -122.310 leg (~2.25 km from A).
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-b-{index}",
                offense_start_utc=datetime(
                    2024, 1 + (index % 2), 1 + (index // 2) % 27, tzinfo=UTC
                ),
                offense_category="PROPERTY",
                latitude=47.6225,
                longitude=-122.310,
            )
            for index in range(150)
        ]
    )
    session.commit()

    result = compare_route_request(
        session=session,
        user_id_hash=user_hash,
        request=RouteComparisonRequest(
            route_request_id="rr-divergent",
            radius_m=250,
            offense_category="PROPERTY",
        ),
    )
    session.close()

    assert result is not None
    assert result["geometry_type"] == "route_divergent_corridor"
    # Context rows keep whole-corridor counts (shared incidents included).
    options = {option["label"]: option for option in result["overview"]["options"]}
    assert options["Route A"]["incident_count"] == 50
    assert options["Route B"]["incident_count"] == 190
    # The test itself saw only the divergent counts.
    pairwise = result["analytical"]["pairwise_results"][0]
    assert pairwise["incident_count_a"] == 10
    assert pairwise["incident_count_b"] == 150
    assert "only the divergent segments were compared" in pairwise["caveat_text"]
    assert result["overview"]["decision_class"] == "statistically_lower"
    assert result["overview"]["recommendation_label"] == "Route A"
    assert result["overview"]["summary_text"].startswith("Where these routes differ, Route A")


def test_compare_route_request_reports_effectively_identical_corridors(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "route-identical-user"
    session.add(
        RouteRequest(
            id="rr-identical",
            user_id_hash=user_hash,
            origin_label="Origin",
            origin_latitude=47.600,
            origin_longitude=-122.340,
            destination_label="Destination",
            destination_latitude=47.630,
            destination_longitude=-122.340,
            mode="transit",
            analysis_start_date=date(2024, 1, 1),
            analysis_end_date=date(2024, 2, 29),
        )
    )
    session.flush()
    session.add_all(
        [
            RouteAlternative(
                id=f"alt-{suffix}",
                route_request_id="rr-identical",
                user_id_hash=user_hash,
                provider_route_id=f"prov-{suffix}",
                route_label=f"Route {suffix.upper()}",
                rank=rank,
                mode_mix="transit",
                summary_geometry="47.600,-122.340;47.630,-122.340",
            )
            for rank, suffix in ((1, "a"), (2, "b"))
        ]
    )
    session.add_all(
        [
            CrimeIncident(
                id=f"inc-{index}",
                offense_start_utc=datetime(2024, 1 + (index % 2), 5 + index // 2, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.610,
                longitude=-122.340,
            )
            for index in range(12)
        ]
    )
    session.commit()

    result = compare_route_request(
        session=session,
        user_id_hash=user_hash,
        request=RouteComparisonRequest(
            route_request_id="rr-identical",
            radius_m=250,
            offense_category="PROPERTY",
        ),
    )
    session.close()

    assert result is not None
    pairwise = result["analytical"]["pairwise_results"][0]
    assert pairwise["minimum_data_status"] == "corridors_effectively_identical"
    assert result["overview"]["recommendation_option_id"] is None
    assert result["overview"]["summary_text"] == (
        "These route options follow essentially the same corridor at this radius, "
        "so there is no divergent segment to compare."
    )
```

- [ ] **Step 2: Run new tests to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_statistical_comparison_service.py -v -k "divergent or identical_corridors"`
Expected: FAIL — `KeyError`/assertion on `geometry_type == "route_divergent_corridor"` (old path returns `route_corridor` and pairwise counts include shared incidents) and the identical case returns a normal not-clear verdict.

- [ ] **Step 3: Rewire `compare_route_request`**

In `app/services/analysis_service.py`:

1. Update imports — replace the `app.analysis.comparison` import line and extend the others:

```python
from app.analysis.comparison import build_route_divergent_comparison, build_statistical_comparison
from app.analysis.divergence import (
    divergent_exposure_square_km_days,
    divergent_length_km,
    divergent_share,
)
```

and add `PairDivergenceInput` to the `from app.analysis.schemas import (...)` block. Add `RouteAlternative` is already imported; `CrimeIncidentData` is already imported.

2. In `compare_route_request`, replace the per-alternative loop body and the final `build_statistical_comparison(...)` call. The loop currently populates `option_results`, `period_counts_by_option_id`, and `geometry_metadata_by_option_id`; change it to:

```python
    option_results: list[AnalysisOptionResult] = []
    geometry_metadata_by_option_id: dict[str, dict[str, Any]] = {}
    points_by_alternative_id: dict[str, list[tuple[float, float]]] = {}
    corridor_incidents_by_alternative_id: dict[str, list[CrimeIncidentData]] = {}

    for alternative in alternatives:
        points_by_alternative_id[alternative.id] = parse_route_geometry(
            alternative.summary_geometry
        )
        matching_incidents = count_incidents_in_route_corridor(
            incidents=incidents,
            geometry=alternative.summary_geometry,
            radius_m=request.radius_m,
            analysis_start_date=route_request.analysis_start_date,
            analysis_end_date=route_request.analysis_end_date,
            offense_category=request.offense_category,
            offense_subcategory=request.offense_subcategory,
            nibrs_group=request.nibrs_group,
        )
        corridor_incidents_by_alternative_id[alternative.id] = matching_incidents
        exposure = route_corridor_exposure_square_km_days(
            geometry=alternative.summary_geometry,
            radius_m=request.radius_m,
            analysis_start_date=route_request.analysis_start_date,
            analysis_end_date=route_request.analysis_end_date,
        )
        option_results.append(
            _option_result(
                option_id=alternative.id,
                option_label=alternative.route_label,
                geometry_type=GeometryType.ROUTE_CORRIDOR,
                radius_m=request.radius_m,
                incident_count=len(matching_incidents),
                exposure=exposure,
            )
        )
        geometry_metadata_by_option_id[alternative.id] = {
            "summary_geometry": alternative.summary_geometry,
            "radius_m": request.radius_m,
        }

    pair_inputs = _route_pair_divergence_inputs(
        alternatives=alternatives,
        points_by_alternative_id=points_by_alternative_id,
        corridor_incidents_by_alternative_id=corridor_incidents_by_alternative_id,
        radius_m=request.radius_m,
        analysis_start_date=route_request.analysis_start_date,
        analysis_end_date=route_request.analysis_end_date,
    )
    comparison = build_route_divergent_comparison(
        user_id_hash=user_id_hash,
        radius_m=request.radius_m,
        analysis_start_date=route_request.analysis_start_date,
        analysis_end_date=route_request.analysis_end_date,
        offense_category=request.offense_category,
        offense_subcategory=request.offense_subcategory,
        nibrs_group=request.nibrs_group,
        options=option_results,
        pair_inputs=pair_inputs,
    )
    return _persist_and_payload(
        session,
        comparison,
        source_route_request_id=route_request.id,
        geometry_metadata_by_option_id=geometry_metadata_by_option_id,
    )
```

(The `period_counts_by_option_id` dict disappears from this function; `compare_site_options` keeps its own copy untouched.)

3. Add the helper (place after `compare_route_request`):

```python
def _route_pair_divergence_inputs(
    *,
    alternatives: list[RouteAlternative],
    points_by_alternative_id: dict[str, list[tuple[float, float]]],
    corridor_incidents_by_alternative_id: dict[str, list[CrimeIncidentData]],
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
) -> list[PairDivergenceInput]:
    pair_inputs: list[PairDivergenceInput] = []
    for index_a, alternative_a in enumerate(alternatives):
        for alternative_b in alternatives[index_a + 1 :]:
            points_a = points_by_alternative_id[alternative_a.id]
            points_b = points_by_alternative_id[alternative_b.id]
            incidents_a = corridor_incidents_by_alternative_id[alternative_a.id]
            incidents_b = corridor_incidents_by_alternative_id[alternative_b.id]
            # Both membership lists filter the SAME incidents_in_bbox objects, so id()
            # identifies the same record; incidents near both corridors drop out of both.
            ids_a = {id(incident) for incident in incidents_a}
            ids_b = {id(incident) for incident in incidents_b}
            only_a = [incident for incident in incidents_a if id(incident) not in ids_b]
            only_b = [incident for incident in incidents_b if id(incident) not in ids_a]
            length_a = divergent_length_km(points_a, points_b, radius_m)
            length_b = divergent_length_km(points_b, points_a, radius_m)
            pair_inputs.append(
                PairDivergenceInput(
                    option_a_id=alternative_a.id,
                    option_b_id=alternative_b.id,
                    count_a=len(only_a),
                    count_b=len(only_b),
                    exposure_a=divergent_exposure_square_km_days(
                        length_km=length_a,
                        radius_m=radius_m,
                        analysis_start_date=analysis_start_date,
                        analysis_end_date=analysis_end_date,
                    ),
                    exposure_b=divergent_exposure_square_km_days(
                        length_km=length_b,
                        radius_m=radius_m,
                        analysis_start_date=analysis_start_date,
                        analysis_end_date=analysis_end_date,
                    ),
                    period_counts_a=_monthly_counts(
                        incidents=only_a,
                        analysis_start_date=analysis_start_date,
                        analysis_end_date=analysis_end_date,
                    ),
                    period_counts_b=_monthly_counts(
                        incidents=only_b,
                        analysis_start_date=analysis_start_date,
                        analysis_end_date=analysis_end_date,
                    ),
                    divergent_share_a=divergent_share(points_a, length_a),
                    divergent_share_b=divergent_share(points_b, length_b),
                )
            )
    return pair_inputs
```

- [ ] **Step 4: Run the service + route suites**

Run: `.venv/bin/python -m pytest tests/test_statistical_comparison_service.py tests/test_route_alternatives_api.py tests/test_routes_public_api.py tests/test_route_endpoints.py -v`
Expected: all pass. `test_compare_route_request_floors_near_empty_candidate` still passes — its corridors are fully disjoint, so divergent counts equal whole-corridor counts (1 vs 20) and the `option_count_too_low` floor still fires. The API tests assert structure only.

- [ ] **Step 5: Lint, full backend suite, commit**

```bash
.venv/bin/python -m ruff check app tests
.venv/bin/python -m pytest -q
git add app/services/analysis_service.py tests/test_statistical_comparison_service.py
git commit -m "feat(routes): route verdict now tests divergent corridors only

compare_route_request partitions each pair's incidents into disjoint
divergent regions (set algebra over the existing per-option corridor
memberships) and feeds divergent exposures to the new engine. Option
rows keep whole-corridor counts as descriptive context. Retires the
whole-corridor hypothesis test for routes (spec decision 2026-07-03).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Methodology doc + ROADMAP

**Files:**
- Modify: `docs/analysis/statistical-route-place-comparison.md`
- Modify: `docs/ROADMAP.md` (Phase 4 list)
- Reference (already committed): `docs/analysis/img/route-divergence-corridors.svg`

- [ ] **Step 1: Scope the route claim in "What The App Can Claim"**

In `docs/analysis/statistical-route-place-comparison.md`, replace:

```markdown
The app can say that one route or site has a statistically lower reported-incident rate
than another route or site for the selected date range, geography, radius, offense filter,
and method. This claim is scoped to the public SPD incident records and the exact analysis
inputs used for the comparison.
```

with:

```markdown
The app can say that one route or site has a statistically lower reported-incident rate
than another route or site for the selected date range, geography, radius, offense filter,
and method. For routes, the claim is further scoped to the divergent corridors — the
segments where the compared routes actually differ. This claim is scoped to the public SPD
incident records and the exact analysis inputs used for the comparison.
```

- [ ] **Step 2: Split route exposure into context vs test**

Replace:

```markdown
Place exposure is the selected place buffer area in square kilometers multiplied by the
number of analysis days. Route exposure is the selected route corridor area in square
kilometers multiplied by the number of analysis days.

For route comparisons, the corridor area is calculated as:

```text
route_corridor_area_square_km = (route_length_km * 2 * radius_km) + pi * radius_km^2
```
```

with:

```markdown
Place exposure is the selected place buffer area in square kilometers multiplied by the
number of analysis days.

Route *context* (the per-option rows shown alongside a comparison) uses the whole
corridor's area:

```text
route_corridor_area_square_km = (route_length_km * 2 * radius_km) + pi * radius_km^2
```

The route *statistical test* instead uses each side's divergent-corridor area:

```text
divergent_corridor_area_square_km = divergent_length_km * 2 * radius_km
```

There is no end-cap term because divergent runs border the shared corridor, so the caps
largely fall inside area that is already shared.
```

- [ ] **Step 3: Add the divergent-corridors section (with the figure)**

Insert a new section immediately after the "## Incident Inclusion" section:

```markdown
## Route Comparisons Test Divergent Corridors

![Two routes share most of their corridor; incidents in the shared corridor drop out of
the test and only the divergent corridors are compared](img/route-divergence-corridors.svg)

Route alternatives between the same origin and destination share most of their corridor.
An incident in the shared corridor would land in both routes' counts, which drags the
rate ratio toward 1.0 and lets the shared stretch mask a real difference on the segments
that actually differ. It also violates the rate test's assumption that the two counts are
independent — the same physical incidents would be counted on both sides.

Route comparisons therefore partition incidents per pair of routes:

- within the radius of route A only → counts for A
- within the radius of route B only → counts for B
- within the radius of both → excluded from the test entirely

Each side's exposure is its divergent corridor's area multiplied by the analysis days.
Divergent length is measured by sampling each route's geometry every ~25 meters and
keeping the spans that are farther than the radius from the other route.

The shared corridor is traversed either way, so it carries no information for the choice
between the routes; the whole-corridor counts remain visible as descriptive context, but
they are not tested. When both routes' divergent share is under 2% the options are
reported as following essentially the same corridor, and no test is run.

A known limitation of the same kind remains on the site path: two *place* buffers that
overlap also double-count the incidents in their intersection. Site comparisons are
usually between well-separated places, so the effect is second-order there; a future
change may apply the same disjoint-region treatment.
```

- [ ] **Step 4: Note the route floors in "Recommendation Threshold"**

In the "## Recommendation Threshold" section, replace:

```markdown
- combined incident count of at least 10
- no unhandled model warning
```

with:

```markdown
- combined incident count of at least 10
- no unhandled model warning

For route comparisons, the counts and exposures above are the divergent-corridor values —
the floors apply to the segments being tested, not to the whole corridors.
```

- [ ] **Step 5: Add the ROADMAP entry**

In `docs/ROADMAP.md`, add to the end of the Phase 4 item list (the `## Phase 4 — Harden & polish + new capabilities` section, alongside the other `- [x] **H…**` entries):

```markdown
- [x] **Routes verdict on divergent corridors** — the route statistical comparison now
  tests only the segments where alternatives differ: per-pair disjoint incident counts
  (shared-corridor incidents drop out of both sides) over divergent-corridor exposure,
  through the unchanged rate-test/BH/floors machinery. Fixes the structurally guaranteed
  "not statistically clear" verdict on mostly-overlapping alternatives and restores the
  rate test's independence assumption; time-shifted duplicate itineraries now report
  "essentially the same corridor". Whole-corridor counts remain as descriptive context.
  Spec/plan: `docs/superpowers/{specs,plans}/2026-07-03-route-divergent-comparison*`.
```

- [ ] **Step 6: Commit**

Note: the spec's `docs/architecture/api.md` check is already resolved — its route lines
(81, 101-102, 121, 124) describe the comparison generically without whole-corridor
semantics, so no edit is needed there.

```bash
git add docs/analysis/statistical-route-place-comparison.md docs/ROADMAP.md
git commit -m "docs(analysis): divergent-corridor route methodology + roadmap tick

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Fixture reconciliation + full gate

**Files:**
- Modify: `frontend/src/components/RoutesTab.test.tsx:27` (fixture string, cosmetic)

- [ ] **Step 1: Align the frontend fixture with the new backend copy**

In `frontend/src/components/RoutesTab.test.tsx`, replace the fixture `summary_text` value:

```
"Link light rail via Westlake has a statistically lower reported-incident rate for the selected corridor."
```

with:

```
"Where these routes differ, Link light rail via Westlake has a statistically lower reported-incident rate for the selected date range and offense filter."
```

(The component renders backend strings verbatim; the test's regex `/statistically lower reported-incident rate/i` matches both, so this is alignment, not a behavior change.)

- [ ] **Step 2: Run the full verification gate**

```bash
make test-all
```

Expected: pytest green (incl. the migration-chain tests), `ruff check .` clean, frontend `npm test` green, `npm run build` succeeds.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/RoutesTab.test.tsx
git commit -m "test(frontend): align Routes verdict fixture with divergent-corridor copy

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Completion

After Task 5, the branch is ready for review: push and open a PR against `main` titled
`feat(routes): route verdict on divergent corridors`, PR body summarizing the spec
decision (whole-corridor test retired for routes; divergent-segment test is the verdict;
no migration), linking the spec and this plan, and noting `make test-all` green. The user
squash-merges PRs themselves — do not merge.
