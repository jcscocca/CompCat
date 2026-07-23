from __future__ import annotations

import math
from collections.abc import Sequence
from functools import cache

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
# Above this many degrees of freedom the Student-t 0.975 quantile and two-sided tail are
# numerically indistinguishable from the normal, so the z path is used to avoid the beta /
# bisection work (t_{200,0.975} = 1.9718 vs z = 1.9600; the gap keeps shrinking as ν grows).
MAX_T_DF = 200


def compare_incident_rates(
    *,
    count_a: int,
    exposure_a: float,
    count_b: int,
    exposure_b: float,
    overdispersion_phi: float | None = None,
    dispersion_periods: int | None = None,
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
    phi = _effective_phi(overdispersion_phi)
    se_log_rr = math.sqrt(phi * ((1 / safe_count_a) + (1 / safe_count_b)))

    # The displayed CI and the decision p-value are derived from ONE phi-aware Wald
    # standard error AND one reference distribution, so "p_value < ALPHA" stays exactly
    # dual to "the 95% CI excludes 1". When phi was ESTIMATED from n dispersion bins the
    # reference is Student-t on nu = n - 1 df (quasi-likelihood convention, Wedderburn 1974;
    # McCullagh & Nelder 1989 §4.5), which widens the interval to absorb phi-hat noise; when
    # phi is assumed (overdispersion_phi is None) the reference is normal, exactly as before.
    z_value = abs(math.log(rate_ratio)) / se_log_rr if se_log_rr else 0.0
    df = _dispersion_df(overdispersion_phi, dispersion_periods)
    if df is None:
        p_value = math.erfc(z_value / math.sqrt(2))
        critical = Z_975
    else:
        p_value = _student_t_two_sided_p(z_value, df)
        critical = _student_t_quantile_975(df)
    ci_lower = math.exp(math.log(rate_ratio) - critical * se_log_rr)
    ci_upper = math.exp(math.log(rate_ratio) + critical * se_log_rr)

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
    dispersion_periods: int | None = None,
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
    phi = _effective_phi(overdispersion_phi)
    se_log_rate = math.sqrt(phi / safe_count)
    log_center = math.log(safe_count / exposure)
    method = (
        "quasi_poisson_rate_interval"
        if overdispersion_phi is not None and overdispersion_phi > DISPERSION_THRESHOLD
        else "poisson_rate_interval"
    )
    # Same quasi-likelihood convention as the pairwise path: a phi estimated from n bins uses
    # the Student-t 0.975 quantile on nu = n - 1 df; an assumed phi (None) uses the normal.
    df = _dispersion_df(overdispersion_phi, dispersion_periods)
    critical = Z_975 if df is None else _student_t_quantile_975(df)
    # A zero-count rate is exactly 0, and the exact-Poisson lower bound at k=0 is 0. The
    # continuity correction only exists to give a finite, honest *upper* bound; clamp the lower
    # bound to 0 so the point estimate stays inside its own interval (otherwise the number line
    # renders the dot at 0, detached to the left of a bar that starts above 0).
    ci_lower = 0.0 if count == 0 else math.exp(log_center - critical * se_log_rate)
    return RateInterval(
        count=count,
        exposure=exposure,
        rate=count / exposure,
        ci_lower=ci_lower,
        ci_upper=math.exp(log_center + critical * se_log_rate),
        overdispersion_phi=overdispersion_phi,
        used_continuity_correction=used_correction,
        method=method,
    )


def _effective_phi(overdispersion_phi: float | None) -> float:
    """Overdispersion multiplier for the Wald SE, floored at 1.0 (plain Poisson).

    A φ < 1 (apparent under-dispersion) would shrink the SE below Poisson and could manufacture a
    spurious "statistically lower" verdict; in the small monthly-bin samples here an estimate
    below 1 is almost always noise, so flooring keeps inference conservative. The method *label*
    still reflects the raw estimate (φ > DISPERSION_THRESHOLD), so flooring only ever widens an
    interval, never mislabels one. Applied identically in the pairwise and single-rate paths so
    the two stay consistent.
    """
    if overdispersion_phi is None:
        return 1.0
    return max(overdispersion_phi, 1.0)


def _dispersion_df(overdispersion_phi: float | None, dispersion_periods: int | None) -> int | None:
    """Degrees of freedom for the phi-estimation t correction, or None to use the normal.

    Returns nu = dispersion_periods - 1 only when phi was actually ESTIMATED (not None) from at
    least two period bins; otherwise the caller keeps the normal reference. Above MAX_T_DF the t
    and normal quantiles/tails coincide numerically, so None is returned to skip the beta work.
    """
    if overdispersion_phi is None or dispersion_periods is None or dispersion_periods < 2:
        return None
    df = dispersion_periods - 1
    if df >= MAX_T_DF:
        return None
    return df


def _betacf(a: float, b: float, x: float) -> float:
    """Continued-fraction for the incomplete beta (Lentz's method; Numerical Recipes betacf)."""
    max_iterations = 300
    epsilon = 3.0e-16
    tiny = 1.0e-300
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < tiny:
        d = tiny
    d = 1.0 / d
    h = d
    for m in range(1, max_iterations + 1):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        h *= d * c
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < tiny:
            d = tiny
        c = 1.0 + aa / c
        if abs(c) < tiny:
            c = tiny
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < epsilon:
            break
    return h


def _regularized_incomplete_beta(a: float, b: float, x: float) -> float:
    """Regularized incomplete beta I_x(a, b), pure stdlib (Numerical Recipes betai)."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    front = math.exp(
        math.lgamma(a + b)
        - math.lgamma(a)
        - math.lgamma(b)
        + a * math.log(x)
        + b * math.log1p(-x)
    )
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def _student_t_two_sided_p(t: float, df: int) -> float:
    """P(|T_df| > |t|): the two-sided Student-t tail via the incomplete beta.

    Uses P(|T| > |t|) = I_{df/(df + t^2)}(df/2, 1/2); at t = 0 this is I_1 = 1.
    """
    if t == 0.0:
        return 1.0
    x = df / (df + t * t)
    return _regularized_incomplete_beta(df / 2.0, 0.5, x)


def _student_t_cdf(t: float, df: int) -> float:
    tail = 0.5 * _student_t_two_sided_p(t, df)  # magnitude of the one-sided upper tail at |t|
    return 1.0 - tail if t > 0.0 else tail


@cache
def _student_t_quantile_975(df: int) -> float:
    """t_{df, 0.975} by bisection on the CDF (tolerance 1e-10 on t, bounded iterations).

    Cached on df: the CI multiplier is reused across every rate call sharing a bin count.
    """
    low, high = 0.0, 1.0e6
    for _ in range(200):
        mid = 0.5 * (low + high)
        if _student_t_cdf(mid, df) < 0.975:
            low = mid
        else:
            high = mid
        if high - low < 1e-10:
            break
    return 0.5 * (low + high)


def _is_nonnegative_integer(value: object) -> bool:
    return type(value) is int and value >= 0


# The exact conditional-Poisson p-value is O(total) lgamma/exp evaluations and is only ever
# a supplementary statistic (never decided on). For a sector/citywide baseline `count_b` can
# be tens of thousands, so skip it above this size — the Wald p-value already drives the
# verdict, and exact vs Wald agree closely once total is this large anyway.
_EXACT_POISSON_MAX_TOTAL = 5000


def _exact_conditional_poisson_p_value(
    *,
    count_a: int,
    exposure_a: float,
    count_b: int,
    exposure_b: float,
) -> float | None:
    total = count_a + count_b
    if total == 0:
        return 1.0
    if total > _EXACT_POISSON_MAX_TOTAL:
        return None
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
    # n_periods is the length of the SAME series phi is estimated from; callers thread it back
    # as dispersion_periods so the t correction uses nu = n_periods - 1.
    n_periods = len(period_counts)
    if n_periods < 2:
        return DispersionResult(phi=None, status="insufficient_periods", n_periods=n_periods)
    mean = sum(period_counts) / n_periods
    if mean == 0:
        return DispersionResult(phi=0.0, status="poisson_ok", n_periods=n_periods)
    variance = sum((count - mean) ** 2 for count in period_counts) / (n_periods - 1)
    phi = variance / mean
    status = "overdispersed" if phi > DISPERSION_THRESHOLD else "poisson_ok"
    return DispersionResult(phi=phi, status=status, n_periods=n_periods)


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
