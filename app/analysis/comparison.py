from __future__ import annotations

from datetime import date

from app.analysis.divergence import IDENTICAL_DIVERGENT_SHARE
from app.analysis.exposure import analysis_days
from app.analysis.rate_tests import (
    MIN_ANALYSIS_DAYS,
    MIN_COMBINED_COUNT,
    MIN_PLACE_COUNT,
    benjamini_hochberg,
    classify_pairwise_result,
    compare_incident_rates,
    dispersion_status,
)
from app.analysis.schemas import (
    AnalysisOptionResult,
    DecisionClass,
    GeometryType,
    PairDivergenceInput,
    PairwiseComparisonResult,
    StatisticalComparisonResult,
)


def build_statistical_comparison(
    *,
    user_id_hash: str,
    comparison_type: str,
    geometry_type: GeometryType,
    radius_m: int,
    analysis_start_date: date,
    analysis_end_date: date,
    offense_category: str | None,
    offense_subcategory: str | None,
    nibrs_group: str | None,
    options: list[AnalysisOptionResult],
    period_counts_by_option_id: dict[str, list[int]],
) -> StatisticalComparisonResult:
    if len(options) < 2:
        raise ValueError("At least two options are required.")

    # Candidate selection is data-dependent: the lowest observed-rate option is chosen, then
    # tested against every other. Benjamini-Hochberg (below) corrects the multiplicity of the
    # k-1 pairwise tests but NOT this selection, so a reported per-pair adjusted p-value is
    # mildly optimistic (selective inference / "winner's curse"). That is deliberate and safe
    # here because the *decision* is conservative: _overall_decision requires the candidate to
    # be statistically lower than EVERY alternative, and the effect-size floor (rate_ratio
    # <= 0.80) plus the data floors must also hold — so selection alone cannot manufacture a
    # winner. See docs/analysis/statistical-route-place-comparison.md.
    candidate = min(options, key=lambda option: option.incident_rate)
    raw_pairwise: list[PairwiseComparisonResult] = []
    p_values: list[float] = []

    for other in options:
        if other.option_id == candidate.option_id:
            continue
        minimum_data_status = _minimum_data_status(
            analysis_start_date=analysis_start_date,
            analysis_end_date=analysis_end_date,
            candidate=candidate,
            other=other,
        )
        dispersion = _combined_dispersion(
            period_counts_by_option_id.get(candidate.option_id, []),
            period_counts_by_option_id.get(other.option_id, []),
        )
        if minimum_data_status == "non_positive_exposure":
            pairwise = _not_tested_pairwise(
                candidate=candidate,
                other=other,
                dispersion_status_text=dispersion.status,
                dispersion_phi=dispersion.phi,
                minimum_data_status=minimum_data_status,
            )
            raw_pairwise.append(pairwise)
            p_values.append(pairwise.p_value)
            continue

        rate_test = compare_incident_rates(
            count_a=candidate.incident_count,
            exposure_a=candidate.exposure,
            count_b=other.incident_count,
            exposure_b=other.exposure,
            overdispersion_phi=dispersion.phi,
        )
        pairwise = PairwiseComparisonResult(
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
            caveat_text=_pairwise_caveat(
                minimum_data_status,
                dispersion.status,
                rate_test.caveat_text,
            ),
        )
        raw_pairwise.append(pairwise)
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
        comparison_type=comparison_type,
        geometry_type=geometry_type,
        radius_m=radius_m,
        analysis_start_date=analysis_start_date,
        analysis_end_date=analysis_end_date,
        offense_category=offense_category,
        offense_subcategory=offense_subcategory,
        nibrs_group=nibrs_group,
        decision_class=overall_decision,
        recommendation_option_id=recommendation_option_id,
        recommendation_label=recommendation_label,
        overview_summary_text=_overview_summary(overall_decision, recommendation_label),
        overview_caveat_text=_overview_caveat(overall_decision),
        full_caveat_text=_full_caveat(pairwise_results),
        options=options,
        pairwise_results=pairwise_results,
    )


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
    if minimum_data_status in _ROUTE_NOT_TESTED_STATUSES:
        return base
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


def _combined_dispersion(counts_a: list[int], counts_b: list[int]):
    if len(counts_a) < 2 or len(counts_b) < 2 or len(counts_a) != len(counts_b):
        return dispersion_status([])
    combined = [count_a + count_b for count_a, count_b in zip(counts_a, counts_b, strict=True)]
    return dispersion_status(combined)


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


def _minimum_data_status(
    *,
    analysis_start_date: date,
    analysis_end_date: date,
    candidate: AnalysisOptionResult,
    other: AnalysisOptionResult,
) -> str:
    if analysis_days(analysis_start_date, analysis_end_date) < MIN_ANALYSIS_DAYS:
        return "date_range_too_short"
    if candidate.exposure <= 0 or other.exposure <= 0:
        return "non_positive_exposure"
    # Per-option floor (mirrors the neighborhood path's MIN_PLACE_COUNT gate). The
    # candidate is the lowest-rate option and the only one that can win, so a near-empty
    # candidate must not be declared "statistically lower" on a combined count the busy
    # other option satisfies on its own — that would be a safety ranking on no signal.
    if candidate.incident_count < MIN_PLACE_COUNT:
        return "option_count_too_low"
    if candidate.incident_count + other.incident_count < MIN_COMBINED_COUNT:
        return "combined_count_too_low"
    return "met"


def _overall_decision(pairwise_results: list[PairwiseComparisonResult]) -> DecisionClass:
    if any(result.decision_class == DecisionClass.MODEL_WARNING for result in pairwise_results):
        return DecisionClass.MODEL_WARNING
    if any(result.decision_class == DecisionClass.INSUFFICIENT_DATA for result in pairwise_results):
        return DecisionClass.INSUFFICIENT_DATA
    if pairwise_results and all(
        result.decision_class == DecisionClass.STATISTICALLY_LOWER
        for result in pairwise_results
    ):
        return DecisionClass.STATISTICALLY_LOWER
    return DecisionClass.NOT_STATISTICALLY_CLEAR


def _overview_summary(decision_class: DecisionClass, recommendation_label: str | None) -> str:
    if decision_class == DecisionClass.STATISTICALLY_LOWER and recommendation_label:
        return (
            f"{recommendation_label} has a statistically lower reported-incident rate "
            "for the selected corridor, date range, and offense filter."
        )
    if decision_class == DecisionClass.INSUFFICIENT_DATA:
        return "There is insufficient data for a statistical comparison under the selected filters."
    if decision_class == DecisionClass.MODEL_WARNING:
        return "The model detected data or geometry limitations that require analytical review."
    return "There is no statistically clear lower-incident alternative under the selected filters."


def _overview_caveat(decision_class: DecisionClass) -> str:
    if decision_class == DecisionClass.STATISTICALLY_LOWER:
        return "This describes reported incidents, not causation or personal outcomes."
    return "The app still shows alternatives, but it does not make a lower-incident recommendation."


def _full_caveat(pairwise_results: list[PairwiseComparisonResult]) -> str:
    caveats = [result.caveat_text for result in pairwise_results if result.caveat_text]
    base = "Results use exposure-adjusted reported incident rates and conservative thresholds."
    return " ".join([base, *caveats]).strip()


def _pairwise_caveat(
    minimum_data_status: str,
    overdispersion_status: str,
    rate_test_caveat: str,
) -> str:
    caveats: list[str] = []
    if minimum_data_status != "met":
        caveats.append(f"Minimum data status: {minimum_data_status}.")
    if overdispersion_status == "overdispersed":
        caveats.append("Overdispersion was detected, so quasi-Poisson adjustment was used.")
    if overdispersion_status == "insufficient_periods":
        caveats.append("There were too few period bins to estimate overdispersion.")
    if rate_test_caveat:
        caveats.append(rate_test_caveat)
    return " ".join(caveats)
