"""A points-path compare is a stateless recompute, like the points-path analyze.

Inline points resolve to synthetic clusters with no saved place_cluster_id, so the
StatisticalComparison rows written for them are audit records nothing can ever look up
again — one shared-view link reloaded N times wrote N unreachable comparisons. The
place_ids path keeps persisting, because the run-scoped export reads those rows back.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import (
    CrimeIncident,
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
)

_WINDOW = {"analysis_start_date": "2024-01-01", "analysis_end_date": "2024-06-30"}
_POINTS = [
    {"latitude": 47.6094, "longitude": -122.3334, "label": "A"},
    {"latitude": 47.6206, "longitude": -122.3206, "label": "B"},
]


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'compare.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    session = get_sessionmaker()()
    for index in range(6):
        session.add(
            CrimeIncident(
                id=f"incident-{index}",
                offense_start_utc=datetime(2024, 1 + index % 6, 10, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6094,
                longitude=-122.3334,
            )
        )
    session.commit()
    session.close()
    return client


def _comparison_row_counts() -> tuple[int, int, int]:
    session = get_sessionmaker()()
    counts = (
        session.query(StatisticalComparison).count(),
        session.query(StatisticalComparisonOption).count(),
        session.query(StatisticalPairwiseResult).count(),
    )
    session.close()
    return counts


def test_points_path_compare_persists_nothing(tmp_path):
    client = _client(tmp_path)
    before = _comparison_row_counts()

    response = client.post(
        "/dashboard/compare", json={"points": _POINTS, "radius_m": 250, **_WINDOW}
    )

    assert response.status_code == 200
    body = response.json()
    # The payload is unchanged — same shape, same analysis, just not written down.
    assert body["overview"]["options"]
    assert body["analytical"]["pairwise_results"]
    assert len(body["overview"]["options"]) == 2
    assert _comparison_row_counts() == before == (0, 0, 0)


def test_repeated_points_path_compares_do_not_accumulate_rows(tmp_path):
    client = _client(tmp_path)
    for _ in range(3):
        assert (
            client.post(
                "/dashboard/compare", json={"points": _POINTS, "radius_m": 250, **_WINDOW}
            ).status_code
            == 200
        )
    assert _comparison_row_counts() == (0, 0, 0)


def test_place_ids_path_compare_still_persists(tmp_path):
    client = _client(tmp_path)
    place_ids = []
    for label, lat, lon in [("A", 47.6094, -122.3334), ("B", 47.6206, -122.3206)]:
        created = client.post(
            "/places", json={"display_label": label, "latitude": lat, "longitude": lon}
        )
        assert created.status_code == 201
        place_ids.append(created.json()["id"])

    response = client.post(
        "/dashboard/compare", json={"place_ids": place_ids, "radius_m": 250, **_WINDOW}
    )
    assert response.status_code == 200

    comparisons, options, pairwise = _comparison_row_counts()
    assert comparisons == 1
    assert options == 2
    assert pairwise == 1

    # The saved comparison is retrievable, which is what the run-scoped export relies on.
    from app.services.analysis_service import get_comparison_payload
    from app.sessions import public_user_hash

    user_hash = public_user_hash(client.cookies.get("mca_session"))
    session = get_sessionmaker()()
    stored = session.query(StatisticalComparison).one()
    assert get_comparison_payload(session, stored.id, user_hash) is not None
    session.close()


def test_points_and_place_ids_paths_agree_on_the_numbers(tmp_path):
    client = _client(tmp_path)
    place_ids = []
    for label, lat, lon in [("A", 47.6094, -122.3334), ("B", 47.6206, -122.3206)]:
        created = client.post(
            "/places", json={"display_label": label, "latitude": lat, "longitude": lon}
        )
        place_ids.append(created.json()["id"])

    by_points = client.post(
        "/dashboard/compare", json={"points": _POINTS, "radius_m": 250, **_WINDOW}
    ).json()
    by_ids = client.post(
        "/dashboard/compare", json={"place_ids": place_ids, "radius_m": 250, **_WINDOW}
    ).json()

    def counts(payload):
        return sorted(
            (option["label"], option["incident_count"], option["exposure"])
            for option in payload["overview"]["options"]
        )

    assert counts(by_points) == counts(by_ids)
    assert by_points["overview"]["decision_class"] == by_ids["overview"]["decision_class"]
