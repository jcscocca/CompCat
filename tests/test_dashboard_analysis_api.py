from datetime import UTC, datetime

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster
from app.sessions import public_user_hash


def _client_with_places_and_crime(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                id="incident-a",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.609,
                longitude=-122.333,
            ),
            CrimeIncident(
                id="incident-b",
                offense_start_utc=datetime(2024, 1, 11, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.621,
                longitude=-122.321,
            ),
        ]
    )
    session.commit()
    session.close()
    for label, lat, lon, visits in [
        ("Downtown transfer stop", 47.6094, -122.3334, 12),
        ("Library area", 47.6206, -122.3206, 6),
    ]:
        response = client.post(
            "/places",
            json={
                "display_label": label,
                "latitude": lat,
                "longitude": lon,
                "visit_count": visits,
            },
        )
        assert response.status_code == 201
    return client


def test_dashboard_analyze_selected_places(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]
    selected_ids = [place["id"] for place in places]

    response = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": selected_ids,
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 200
    assert response.json()["summary_count"] == 2
    dashboard = client.get("/dashboard/summary").json()
    assert dashboard["totals"]["incident_count"] == 2


def test_dashboard_analyze_filters_candidates_before_summarizing(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    assert user_hash is not None
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="selected-place",
            user_id_hash=user_hash,
            cluster_version="test",
            cluster_method="manual",
            centroid_latitude=47.5900,
            centroid_longitude=-122.2900,
            display_latitude=47.6100,
            display_longitude=-122.3330,
            visit_count=3,
            inferred_place_type="manual_place",
            sensitivity_class="normal",
            display_label="Display-safe place",
            label_source="test",
        )
    )
    session.add_all(
        [
            CrimeIncident(
                id="matching-incident",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6101,
                longitude=-122.3330,
            ),
            CrimeIncident(
                id="outside-date",
                offense_start_utc=datetime(2023, 12, 31, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.6101,
                longitude=-122.3330,
            ),
            CrimeIncident(
                id="outside-category",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PERSON",
                latitude=47.6101,
                longitude=-122.3330,
            ),
            CrimeIncident(
                id="outside-bbox",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                offense_category="PROPERTY",
                latitude=47.7000,
                longitude=-122.4500,
            ),
        ]
    )
    session.commit()
    session.close()

    response = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": ["selected-place"],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 200
    assert response.json()["summary_count"] == 1
    dashboard = client.get("/dashboard/summary").json()
    assert dashboard["totals"]["incident_count"] == 1


def test_dashboard_analyze_rejects_duplicate_radii(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]
    selected_ids = [place["id"] for place in places]

    response = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": selected_ids,
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250, 250],
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 422
    assert "radii_m values must be unique" in response.text


def test_dashboard_compare_selected_places(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]

    response = client.post(
        "/dashboard/compare",
        json={
            "place_ids": [place["id"] for place in places],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 200
    assert response.json()["overview"]["label"] == "Overview"
    assert len(response.json()["overview"]["options"]) == 2


def test_dashboard_compare_uses_public_place_display_coordinates(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places_by_id = {place["id"]: place for place in client.get("/places").json()["places"]}

    response = client.post(
        "/dashboard/compare",
        json={
            "place_ids": list(places_by_id),
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 200
    for option in response.json()["overview"]["options"]:
        place = places_by_id[option["id"]]
        assert option["geometry_metadata"]["center"] == {
            "latitude": place["latitude"],
            "longitude": place["longitude"],
        }


def test_dashboard_compare_rejects_selected_place_without_display_coordinates(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]
    selected_ids = [place["id"] for place in places]

    session = get_sessionmaker()()
    cluster = session.get(PlaceCluster, selected_ids[0])
    assert cluster is not None
    raw_centroid = {
        "latitude": cluster.centroid_latitude,
        "longitude": cluster.centroid_longitude,
    }
    cluster.display_latitude = None
    cluster.display_longitude = None
    session.commit()
    session.close()

    response = client.post(
        "/dashboard/compare",
        json={
            "place_ids": selected_ids,
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
            "offense_category": "PROPERTY",
        },
    )

    if response.status_code == 200:
        centers = [
            option["geometry_metadata"]["center"]
            for option in response.json()["overview"]["options"]
        ]
        assert raw_centroid not in centers
    assert response.status_code == 400
    assert response.json()["detail"] == "Selected places require display coordinates."


def test_dashboard_analysis_actions_require_public_session_cookie(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    for endpoint, payload in [
        (
            "/dashboard/analyze",
            {
                "place_ids": ["selected-place"],
                "analysis_start_date": "2024-01-01",
                "analysis_end_date": "2024-01-31",
                "radii_m": [250],
            },
        ),
        (
            "/dashboard/compare",
            {
                "place_ids": ["selected-place", "other-place"],
                "analysis_start_date": "2024-01-01",
                "analysis_end_date": "2024-01-31",
                "radius_m": 250,
            },
        ),
    ]:
        response = client.post(
            endpoint,
            json=payload,
            headers={"X-Demo-User-ID": "demo@example.com"},
        )

        assert response.status_code == 401


def test_dashboard_analyze_rejects_cross_session_place_ids(tmp_path):
    first = _client_with_places_and_crime(tmp_path)
    selected_ids = [place["id"] for place in first.get("/places").json()["places"]]
    second = TestClient(first.app)
    second.post("/sessions")

    response = second.post(
        "/dashboard/analyze",
        json={
            "place_ids": selected_ids,
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code in {400, 404}
    assert second.get("/dashboard/summary").json()["totals"]["incident_count"] == 0


def test_dashboard_compare_rejects_cross_session_place_ids(tmp_path):
    first = _client_with_places_and_crime(tmp_path)
    selected_ids = [place["id"] for place in first.get("/places").json()["places"]]
    second = TestClient(first.app)
    second.post("/sessions")

    response = second.post(
        "/dashboard/compare",
        json={
            "place_ids": selected_ids,
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code in {400, 404}
