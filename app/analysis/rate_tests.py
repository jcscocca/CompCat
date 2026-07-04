from __future__ import annotations

import math
from collections.abc import Sequence

from app.analysis.schemas import (
    DecisionClass,
    DispersionResult,
    RateInterval,
    RateTestResult,
)

ALPHA = 0.05
DISPERSION_THRESHOLD = 1.2
MAX_RATE_RATIO_FOR_RECOMMENDATION = 0.80
MIN_COMBINED_COUNT = 10
# A confident place-vs-beat verdict needs a minimum signal from the PLACE itself,
# not just a combined count the busy beat satisfies on its own. Tunable.
MIN_PLACE_COUNT = 3
MIN_ANALYSIS_DAYS = 30
Z_975 = 1.959963984540054


def compare_incident_rates(
    *,
    count_a: int,
    exposure_a: float,
    count_b: int,
    exposure_b: float,
    overdispersion_phi: float | None = None,
) -> RateTestResult:
    if not _is_nonnegative_integer(count_a) or not _is_nonnegative_integer(count_b):
        raise ValueError("Incident counts must be nonnegative integers.")
    if not math.isfinite(exposure_a) or exposure_a <= 0:
        raise ValueError("Exposure values must be finite and positive.")
    if not math.isfinite(exposure_b) or exposure_b <= 0:
        raise ValueError("Exposure values must be finite and positive.")
    if overdispersion_phi is not None and (
        not math.isfinite(overdispersion_phi) or overdispersion_phi < 0
    ):
        raise ValueError("Overdispersion phi must be finite and nonnegative.")

    raw_rate_a = count_a / exposure_a
    raw_rate_b = count_b / exposure_b
    safe_count_a = count_a
    safe_count_b = count_b
    used_correction = False
    caveats: list[str] = []
    if count_a == 0 or count_b == 0:
        safe_count_a = count_a + 0.5
        safe_count_b = count_b + 0.5
        used_correction = True
        caveats.append("A continuity correction was used because one option had zero incidents.")

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


def rate_confidence_interval(
    *,
    count: int,
    exposure: float,
    overdispersion_phi: float | None = None,
) -> RateInterval:
    """Quasi-Poisson Wald interval on a single exposure-adjusted rate.

    The single-rate analogue of ``compare_incident_rates``: same phi-aware Wald log SE
    (here ``sqrt(phi / count)``), same continuity convention, so a per-address interval and
    the pairwise verdict share one variance model. Empirically justified over negative
    binomial in docs/analysis/overdispersion-and-rate-intervals.md.
    """
    if not _is_nonnegative_integer(count):
        raise ValueError("Incident counts must be nonnegative integers.")
    if not math.isfinite(exposure) or exposure <= 0:
        raise ValueError("Exposure values must be finite and positive.")
    if overdispersion_phi is not None and (
        not math.isfinite(overdispersion_phi) or overdispersion_phi < 0
    ):
        raise ValueError("Overdispersion phi must be finite and nonnegative.")

    used_correction = count == 0
    safe_count = count + 0.5 if used_correction else count
    phi = overdispersion_phi or 1.0
    se_log_rate = math.sqrt(phi / safe_count)
    log_center = math.log(safe_count / exposure)
    method = (
        "quasi_poisson_rate_interval"
        if overdispersion_phi is not None and overdispersion_phi > DISPERSION_THRESHOLD
        else "poisson_rate_interval"
    )
    return RateInterval(
        count=count,
        exposure=exposure,
        rate=count / exposure,
        ci_lower=math.exp(log_center - Z_975 * se_log_rate),
        ci_upper=math.exp(log_center + Z_975 * se_log_rate),
        overdispersion_phi=overdispersion_phi,
        used_continuity_correction=used_correction,
        method=method,
    )


def _is_nonnegative_integer(value: object) -> bool:
    return type(value) is int and value >= 0


def _exact_conditional_poisson_p_value(
    *,
    count_a: int,
    exposure_a: float,
    count_b: int,
    exposure_b: float,
) -> float:
    total = count_a + count_b
    if total == 0:
        return 1.0
    probability_a = exposure_a / (exposure_a + exposure_b)
    observed = _binomial_probability(total, count_a, probability_a)
    p_value = 0.0
    for successes in range(total + 1):
        probability = _binomial_probability(total, successes, probability_a)
        if probability <= observed + 1e-15:
            p_value += probability
    return min(1.0, p_value)


def _binomial_probability(trials: int, successes: int, probability: float) -> float:
    if probability <= 0:
        return 1.0 if successes == 0 else 0.0
    if probability >= 1:
        return 1.0 if successes == trials else 0.0
    log_combination = (
        math.lgamma(trials + 1)
        - math.lgamma(successes + 1)
        - math.lgamma(trials - successes + 1)
    )
    log_probability = (
        log_combination
        + successes * math.log(probability)
        + (trials - successes) * math.log1p(-probability)
    )
    return math.exp(log_probability)


def dispersion_status(period_counts: Sequence[int]) -> DispersionResult:
    if any(not _is_nonnegative_integer(count) for count in period_counts):
        raise ValueError("Period counts must be nonnegative integers.")
    if len(period_counts) < 2:
        return DispersionResult(phi=None, status="insufficient_periods")
    mean = sum(period_counts) / len(period_counts)
    if mean == 0:
        return DispersionResult(phi=0.0, status="poisson_ok")
    variance = sum((count - mean) ** 2 for count in period_counts) / (len(period_counts) - 1)
    phi = variance / mean
    status = "overdispersed" if phi > DISPERSION_THRESHOLD else "poisson_ok"
    return DispersionResult(phi=phi, status=status)


def benjamini_hochberg(p_values: Sequence[float]) -> list[float]:
    if any(not math.isfinite(p_value) or p_value < 0 or p_value > 1 for p_value in p_values):
        raise ValueError("P-values must be finite values between 0 and 1.")
    count = len(p_values)
    indexed = sorted(enumerate(p_values), key=lambda item: item[1], reverse=True)
    adjusted = [1.0] * count
    running_min = 1.0
    for rank_from_largest, (original_index, p_value) in enumerate(indexed):
        rank = count - rank_from_largest
        candidate = min(1.0, p_value * count / rank)
        running_min = min(running_min, candidate)
        adjusted[original_index] = running_min
    return adjusted


def classify_pairwise_result(
    *,
    rate_ratio: float,
    adjusted_p_value: float,
    minimum_data_met: bool,
    model_warning: bool,
) -> DecisionClass:
    if not minimum_data_met:
        return DecisionClass.INSUFFICIENT_DATA
    if model_warning:
        return DecisionClass.MODEL_WARNING
    if adjusted_p_value < ALPHA and rate_ratio <= MAX_RATE_RATIO_FOR_RECOMMENDATION:
        return DecisionClass.STATISTICALLY_LOWER
    return DecisionClass.NOT_STATISTICALLY_CLEAR
