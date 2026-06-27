import math

import pytest

from app.analysis.rate_tests import (
    ALPHA,
    DecisionClass,
    benjamini_hochberg,
    classify_pairwise_result,
    compare_incident_rates,
    dispersion_status,
)


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


def test_compare_incident_rates_finds_lower_rate_with_wald_method():
    result = compare_incident_rates(
        count_a=8,
        exposure_a=30.0,
        count_b=28,
        exposure_b=30.0,
    )

    assert result.method == "wald_log_rate_ratio"
    assert result.rate_a == 8 / 30.0
    assert result.rate_b == 28 / 30.0
    assert round(result.rate_ratio, 3) == 0.286
    assert result.p_value < 0.05
    assert result.ci_lower < result.rate_ratio < result.ci_upper


def test_compare_incident_rates_handles_zero_count_with_continuity_correction():
    result = compare_incident_rates(
        count_a=0,
        exposure_a=30.0,
        count_b=12,
        exposure_b=30.0,
    )

    assert result.used_continuity_correction is True
    assert result.rate_ratio < 0.1
    assert result.p_value < 0.05
    assert "continuity correction" in result.caveat_text


@pytest.mark.parametrize(
    ("count_a", "count_b"),
    [
        (-1, 12),
        (8, -1),
        (1.5, 12),
        (8, 2.5),
    ],
)
def test_compare_incident_rates_rejects_invalid_counts(count_a, count_b):
    with pytest.raises(ValueError, match="Incident counts must be nonnegative integers"):
        compare_incident_rates(
            count_a=count_a,
            exposure_a=30.0,
            count_b=count_b,
            exposure_b=30.0,
        )


@pytest.mark.parametrize(
    ("exposure_a", "exposure_b"),
    [
        (math.nan, 30.0),
        (30.0, math.nan),
        (math.inf, 30.0),
        (30.0, math.inf),
    ],
)
def test_compare_incident_rates_rejects_non_finite_exposures(exposure_a, exposure_b):
    with pytest.raises(ValueError, match="Exposure values must be finite and positive"):
        compare_incident_rates(
            count_a=8,
            exposure_a=exposure_a,
            count_b=28,
            exposure_b=exposure_b,
        )


@pytest.mark.parametrize("phi", [-1.0, math.inf, math.nan])
def test_compare_incident_rates_rejects_invalid_overdispersion_phi(phi):
    with pytest.raises(ValueError, match="Overdispersion phi must be finite and nonnegative"):
        compare_incident_rates(
            count_a=8,
            exposure_a=30.0,
            count_b=28,
            exposure_b=30.0,
            overdispersion_phi=phi,
        )


def test_dispersion_status_marks_high_variance_periods_as_overdispersed():
    status = dispersion_status([0, 0, 0, 12, 0, 12])

    assert status.status == "overdispersed"
    assert status.phi > 1.2


def test_dispersion_status_marks_short_series_as_insufficient_periods():
    status = dispersion_status([2])

    assert status.status == "insufficient_periods"
    assert status.phi is None


def test_dispersion_status_rejects_negative_period_counts():
    with pytest.raises(ValueError, match="Period counts must be nonnegative integers"):
        dispersion_status([1, -1, 2])


@pytest.mark.parametrize("period_counts", [[1, 1.5, 2], [1, True, 2]])
def test_dispersion_status_rejects_non_integer_period_counts(period_counts):
    with pytest.raises(ValueError, match="Period counts must be nonnegative integers"):
        dispersion_status(period_counts)


def test_quasi_poisson_adjustment_weakens_high_dispersion_significance():
    poisson = compare_incident_rates(
        count_a=8,
        exposure_a=30.0,
        count_b=28,
        exposure_b=30.0,
        overdispersion_phi=1.0,
    )
    adjusted = compare_incident_rates(
        count_a=8,
        exposure_a=30.0,
        count_b=28,
        exposure_b=30.0,
        overdispersion_phi=4.0,
    )

    assert poisson.method == "wald_log_rate_ratio"
    assert adjusted.method == "quasi_poisson_log_rate_ratio"
    assert adjusted.p_value > poisson.p_value
    assert adjusted.ci_lower < poisson.ci_lower
    assert adjusted.ci_upper > poisson.ci_upper


def test_benjamini_hochberg_adjusts_p_values_monotonically():
    adjusted = benjamini_hochberg([0.01, 0.04, 0.03])

    assert adjusted == [0.03, 0.04, 0.04]


@pytest.mark.parametrize("p_value", [-0.01, 1.01, math.inf, math.nan])
def test_benjamini_hochberg_rejects_invalid_p_values(p_value):
    with pytest.raises(ValueError, match="P-values must be finite values between 0 and 1"):
        benjamini_hochberg([0.01, p_value])


def test_classify_requires_statistical_and_practical_thresholds():
    statistically_lower = classify_pairwise_result(
        rate_ratio=0.5,
        adjusted_p_value=0.01,
        minimum_data_met=True,
        model_warning=False,
    )
    weak_practical_difference = classify_pairwise_result(
        rate_ratio=0.9,
        adjusted_p_value=0.01,
        minimum_data_met=True,
        model_warning=False,
    )
    weak_statistical_difference = classify_pairwise_result(
        rate_ratio=0.5,
        adjusted_p_value=0.20,
        minimum_data_met=True,
        model_warning=False,
    )

    assert statistically_lower == DecisionClass.STATISTICALLY_LOWER
    assert weak_practical_difference == DecisionClass.NOT_STATISTICALLY_CLEAR
    assert weak_statistical_difference == DecisionClass.NOT_STATISTICALLY_CLEAR


def test_classify_returns_insufficient_data_before_other_decisions():
    result = classify_pairwise_result(
        rate_ratio=0.5,
        adjusted_p_value=0.01,
        minimum_data_met=False,
        model_warning=True,
    )

    assert result == DecisionClass.INSUFFICIENT_DATA


def test_classify_returns_model_warning_when_data_is_sufficient():
    result = classify_pairwise_result(
        rate_ratio=0.5,
        adjusted_p_value=0.01,
        minimum_data_met=True,
        model_warning=True,
    )

    assert result == DecisionClass.MODEL_WARNING
