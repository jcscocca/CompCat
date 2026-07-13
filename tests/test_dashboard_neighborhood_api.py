from __future__ import annotations

from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def _client_with_beat_crime(tmp_path) -> tuple[TestClient, str]:
    """
    Create a TestClient with a public session, one place, and several crime
    rows tagged with beat "M3" (the beat the real polygons resolve that downtown
    point to) near that place, dated 2026.
    Returns (client, place_id).
    """
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    # Seed crime incidents near 47.60945, -122.33595 (deep in beat M3), all tagged beat="M3"
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id=f"incident-nb-{i}",
                offense_start_utc=datetime(2026, 1, 10 + i, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.60945 + i * 0.0001,
                longitude=-122.33595,
                beat="M3",
            )
            for i in range(5)
        ]
    )
    session.commit()
    session.close()

    response = client.post(
        "/places",
        json={
            "display_label": "Downtown transfer stop",
            "latitude": 47.60945,
            "longitude": -122.33595,
            "visit_count": 12,
        },
    )
    assert response.status_code == 201
    place_id = response.json()["id"]
    return client, place_id


@pytest.fixture()
def neighborhood_client(tmp_path):
    return _client_with_beat_crime(tmp_path)


def test_neighborhood_endpoint_returns_place_block(neighborhood_client):
    client, place_id = neighborhood_client
    response = client.post(
        "/dashboard/neighborhood",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2026-01-01",
            "analysis_end_date": "2026-06-30",
            "radii_m": [250],
            "offense_category": None,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["radius_m"] == 250
    assert body["places"][0]["place_id"] == place_id
    assert "decision" in body["places"][0]


def test_neighborhood_endpoint_requires_public_session(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    # No /sessions call — no cookie

    response = client.post(
        "/dashboard/neighborhood",
        json={
            "place_ids": ["some-place-id"],
            "analysis_start_date": "2026-01-01",
            "analysis_end_date": "2026-06-30",
            "radii_m": [250],
            "offense_category": None,
        },
    )
    assert response.status_code == 401


def test_neighborhood_endpoint_includes_temporal_and_no_safety_language(neighborhood_client):
    import json

    client, place_id = neighborhood_client
    response = client.post(
        "/dashboard/neighborhood",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2026-01-01",
            "analysis_end_date": "2026-06-30",
            "radii_m": [250],
            "offense_category": None,
        },
    )
    assert response.status_code == 200
    body = response.json()
    temporal = body["places"][0]["temporal"]
    assert len(temporal["hour_counts"]) == 24
    assert len(temporal["dow_counts"]) == 7
    assert len(temporal["hour_by_dow"]) == 7
    assert all(len(row) == 24 for row in temporal["hour_by_dow"])
    assert temporal["total_with_time"] == 5  # the 5 seeded in-radius incidents

    # Invariant: the payload reports context, never a safety judgment.
    blob = json.dumps(body).lower()
    for banned in ("unsafe", "dangerous", "safest", "risky", "avoid "):
        assert banned not in blob


def test_neighborhood_endpoint_includes_category_breakdown_and_no_type_mix(neighborhood_client):
    import json

    client, place_id = neighborhood_client
    response = client.post(
        "/dashboard/neighborhood",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2026-01-01",
            "analysis_end_date": "2026-06-30",
            "radii_m": [250],
            "offense_category": None,
        },
    )
    assert response.status_code == 200
    body = response.json()
    place = body["places"][0]

    # type_mix must be gone.
    assert "type_mix" not in place

    # category_breakdown must be present and well-formed.
    bd = place["category_breakdown"]
    assert isinstance(bd, list)
    assert len(bd) >= 1
    for row in bd:
        assert set(row.keys()) == {"label", "place_count", "place_share", "beat_share"}
        assert isinstance(row["label"], str)
        assert isinstance(row["place_count"], int)
        assert isinstance(row["place_share"], float)
        # beat_share is float or null.
        assert row["beat_share"] is None or isinstance(row["beat_share"], float)

    # The fixture seeds place incidents with offense_category="PROPERTY" and no
    # offense_subcategory, so the label falls back to the category name.
    assert bd[0]["label"] == "PROPERTY"

    # Invariant: no safety language anywhere in the payload.
    blob = json.dumps(body).lower()
    for banned in ("unsafe", "dangerous", "safest", "risky", "avoid "):
        assert banned not in blob


def test_neighborhood_response_carries_baselines(tmp_path):
    from fastapi.testclient import TestClient

    from app.main import create_app

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'nb.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    place = client.post(
        "/places",
        json={
            "display_label": "Baseline place",
            "latitude": 47.60945,
            "longitude": -122.33595,
            "visit_count": 1,
            "sensitivity_class": "normal",
        },
    ).json()
    response = client.post(
        "/dashboard/neighborhood",
        json={
            "place_ids": [place["id"]],
            "radii_m": [250],
            "analysis_start_date": "2026-01-01",
            "analysis_end_date": "2026-06-30",
        },
    )
    assert response.status_code == 200
    places = response.json()["places"]
    assert places and isinstance(places[0]["baselines"], list)
    # Real bundled geometry resolves this downtown point. With an empty incident DB the
    # mcpp/beat entries are omitted (no rest incidents), but sector and citywide always
    # form from the bundled beat areas — their presence proves the route wired the real
    # geography through without error.
    kinds = {entry["kind"] for entry in places[0]["baselines"]}
    assert {"sector", "city"} <= kinds
