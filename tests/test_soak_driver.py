import random

import pytest

from app.api.dashboard_schemas import (
    DashboardAnalyzeRequest,
    DashboardCompareRequest,
    DashboardIncidentDetailsRequest,
)
from scripts.soak import soak_driver as sd


def test_parse_duration_units():
    assert sd.parse_duration("90s") == 90
    assert sd.parse_duration("5m") == 300
    assert sd.parse_duration("2h") == 7200
    assert sd.parse_duration("120") == 120  # bare seconds


def test_parse_duration_rejects_garbage():
    with pytest.raises(ValueError):
        sd.parse_duration("later")


def test_percentile_basic():
    values = list(range(1, 101))  # 1..100
    assert sd.percentile(values, 50) == pytest.approx(50, abs=1)
    assert sd.percentile(values, 95) == pytest.approx(95, abs=1)
    assert sd.percentile(values, 99) == pytest.approx(99, abs=1)


def test_percentile_edges():
    assert sd.percentile([], 95) is None
    assert sd.percentile([42.0], 95) == 42.0


def test_choose_endpoint_respects_weights():
    rng = random.Random(1234)
    weights = {"a": 1, "b": 0, "c": 3}
    picks = [sd.choose_endpoint(rng, weights) for _ in range(2000)]
    assert picks.count("b") == 0  # zero weight never chosen
    assert picks.count("c") > picks.count("a")  # 3:1 ratio, comfortably


def test_build_body_validates_against_real_schemas():
    rng = random.Random(7)
    place_ids = ["p1", "p2", "p3"]
    # Every endpoint the driver hits with a POST body must produce a body the
    # real Pydantic request model accepts — this pins the driver to the API contract.
    DashboardAnalyzeRequest.model_validate(sd.build_body("analyze", rng, place_ids))
    DashboardAnalyzeRequest.model_validate(sd.build_body("neighborhood", rng, place_ids))
    DashboardIncidentDetailsRequest.model_validate(sd.build_body("incidents", rng, place_ids))
    DashboardCompareRequest.model_validate(sd.build_body("compare", rng, place_ids))


def _rec(ts, lat, ok):
    return sd.RequestRecord(ts=ts, vu=0, endpoint="analyze",
                            status=200 if ok else 500, latency_ms=lat, ok=ok)


def test_summarize_rollup_and_drift():
    # first-hour rows ~100ms, last-hour rows ~300ms → drift ≈ 3x on /analyze.
    base = 1_000_000.0
    rows = [_rec(base + i, 100.0, True) for i in range(600)]
    rows += [_rec(base + 7200 + i, 300.0, True) for i in range(600)]
    rows.append(_rec(base + 10, 5.0, False))
    summary = sd.summarize(rows, budgets={"analyze": 150.0})
    ep = summary["endpoints"]["analyze"]
    assert ep["count"] == 1201
    assert ep["errors"] == 1
    assert summary["drift"]["analyze"] == pytest.approx(3.0, rel=0.1)
    assert "analyze" in summary["budget_breaches"]  # p95 ~300 > 150
