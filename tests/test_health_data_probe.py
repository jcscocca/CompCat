from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

import app.api.routes_health as health_module
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident

_SOURCES = {
    "reported": "seattle_spd_crime",
    "arrests": "seattle_spd_arrests",
    "calls": "seattle_spd_911",
}


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'probe.sqlite3'}")
    return TestClient(app)


def _seed(layer_ages: dict[str, int]) -> None:
    """One incident per layer, `age` days before today (UTC) — the probe reads
    max(coalesce(offense_start_utc, report_utc)) per layer."""
    today = datetime.now(UTC)
    session = get_sessionmaker()()
    for layer, age in layer_ages.items():
        session.add(
            CrimeIncident(
                id=f"{layer}-{age}",
                source_dataset=_SOURCES[layer],
                offense_start_utc=today - timedelta(days=age),
                offense_category="PROPERTY",
                latitude=47.6,
                longitude=-122.3,
            )
        )
    session.commit()
    session.close()


def _iso_days_ago(age: int) -> str:
    return (datetime.now(UTC).date() - timedelta(days=age)).isoformat()


def test_all_layers_fresh_returns_200(tmp_path) -> None:
    client = _client(tmp_path)
    _seed({"reported": 0, "arrests": 1, "calls": 2})
    response = client.get("/health/data")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "stale": []}


def test_future_dated_layer_is_stale_not_permanently_fresh(tmp_path) -> None:
    # A mis-dated upstream row pins data_through ahead of today; negative lag must read as
    # stale or that layer could never alarm again.
    client = _client(tmp_path)
    _seed({"reported": -3, "arrests": 0, "calls": 0})
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert [entry["layer"] for entry in body["stale"]] == ["reported"]
    assert body["stale"][0]["lag_days"] == -3


def test_one_stale_layer_returns_503_and_names_it(tmp_path) -> None:
    client = _client(tmp_path)
    _seed({"reported": 1, "arrests": 1, "calls": 30})
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "stale"
    assert body["stale"] == [
        {"layer": "calls", "data_through": _iso_days_ago(30), "lag_days": 30}
    ]


def test_every_layer_stale_is_reported(tmp_path) -> None:
    client = _client(tmp_path)
    _seed({"reported": 9, "arrests": 12, "calls": 40})
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert [entry["layer"] for entry in body["stale"]] == ["reported", "arrests", "calls"]
    assert [entry["lag_days"] for entry in body["stale"]] == [9, 12, 40]


def test_a_layer_with_no_data_counts_as_stale(tmp_path) -> None:
    # Unknown = stale: an empty database must never read as green.
    client = _client(tmp_path)
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert [entry["layer"] for entry in body["stale"]] == ["reported", "arrests", "calls"]
    assert all(entry["data_through"] is None for entry in body["stale"])
    assert all(entry["lag_days"] is None for entry in body["stale"])


def test_unreadable_freshness_returns_503(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _client(tmp_path)
    _seed({"reported": 0, "arrests": 0, "calls": 0})

    def boom(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(health_module, "dashboard_freshness_by_layer", boom)
    response = client.get("/health/data")
    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "unknown"
    assert [entry["layer"] for entry in body["stale"]] == ["reported", "arrests", "calls"]


def test_threshold_boundary_is_inclusive(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Exactly MCA_DATA_STALENESS_DAYS days of lag is still fresh; one more is not.
    monkeypatch.setenv("MCA_DATA_STALENESS_DAYS", "7")
    client = _client(tmp_path)
    _seed({"reported": 7, "arrests": 7, "calls": 7})
    response = client.get("/health/data")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "stale": []}


def test_one_day_past_the_threshold_is_stale(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MCA_DATA_STALENESS_DAYS", "7")
    client = _client(tmp_path)
    _seed({"reported": 8, "arrests": 7, "calls": 7})
    response = client.get("/health/data")
    assert response.status_code == 503
    assert [entry["layer"] for entry in response.json()["stale"]] == ["reported"]


def test_threshold_is_configurable(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MCA_DATA_STALENESS_DAYS", "60")
    client = _client(tmp_path)
    _seed({"reported": 30, "arrests": 45, "calls": 59})
    assert client.get("/health/data").status_code == 200


def test_default_threshold_is_seven_days() -> None:
    from app.config import Settings

    assert Settings(_env_file=None).data_staleness_days == 7


def test_probe_payload_uses_only_recency_vocabulary(tmp_path) -> None:
    # Product invariant: the probe describes data recency, never safety or places.
    client = _client(tmp_path)
    _seed({"reported": 40, "arrests": 40, "calls": 40})
    text = client.get("/health/data").text.lower()
    for banned in ("safe", "unsafe", "safety", "danger", "risk", "address", "neighborhood"):
        assert banned not in text


def test_probe_needs_no_session(tmp_path) -> None:
    # No POST /sessions first: an external monitor holds no cookie.
    client = _client(tmp_path)
    _seed({"reported": 0, "arrests": 0, "calls": 0})
    assert client.get("/health/data").status_code == 200


def test_liveness_probe_is_unchanged(tmp_path) -> None:
    # The container healthcheck stays on /health: stale data must not restart the app.
    client = _client(tmp_path)
    _seed({"reported": 400, "arrests": 400, "calls": 400})
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/health/data").status_code == 503


def test_lag_days_helper_handles_unparseable_values() -> None:
    today = date(2026, 7, 27)
    assert health_module._lag_days("2026-07-20", today) == 7
    assert health_module._lag_days(None, today) is None
    assert health_module._lag_days("not-a-date", today) is None
    assert health_module._lag_days(20260720, today) is None
