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


def _seed_layered_incident(client: TestClient, *, source: str, external_id: str) -> None:
    """Add one incident for ``source`` at the Downtown place so layer queries can tell the
    reported (crime), arrests, and 911 calls layers apart."""
    session = get_sessionmaker()()
    session.add(
        CrimeIncident(
            id=external_id,
            external_incident_id=external_id,
            source_dataset=source,
            offense_start_utc=datetime(2024, 1, 12, tzinfo=UTC),
            offense_category="PROPERTY" if source == "seattle_spd_crime" else None,
            offense_subcategory="THEFT" if source == "seattle_spd_911" else None,
            latitude=47.6094,
            longitude=-122.3334,
        )
    )
    session.commit()
    session.close()


def test_dashboard_incidents_layers_are_disjoint(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    # incident-a (crime) is already at the Downtown place; add an arrest and a 911 call there.
    _seed_layered_incident(client, source="seattle_spd_arrests", external_id="arr-1")
    _seed_layered_incident(client, source="seattle_spd_911", external_id="call-1")
    place_id = client.get("/places").json()["places"][0]["id"]
    body = {
        "place_ids": [place_id],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [250],
    }

    def ids(layer: str) -> set[str]:
        resp = client.post("/dashboard/incidents", json={**body, "layer": layer})
        assert resp.status_code == 200, resp.text
        return {row["incident_id"] for row in resp.json()["incidents"]}

    # reported = crime only — the arrest is no longer unioned in.
    assert ids("reported") == {"incident-a"}
    # arrests layer = arrests only.
    assert ids("arrests") == {"arr-1"}
    # calls layer = 911 only.
    assert ids("calls") == {"call-1"}
    # No layer specified still defaults to reported (crime only).
    default = client.post("/dashboard/incidents", json=body).json()
    assert {row["incident_id"] for row in default["incidents"]} == {"incident-a"}


def test_dashboard_summary_reports_the_analyzed_layer(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    _seed_layered_incident(client, source="seattle_spd_911", external_id="call-1")
    place_id = client.get("/places").json()["places"][0]["id"]
    body = {
        "place_ids": [place_id],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [250],
    }

    client.post("/dashboard/analyze", json={**body, "layer": "calls"})
    summary = client.get("/dashboard/summary").json()
    assert summary["layer"] == "calls"

    client.post("/dashboard/analyze", json={**body, "layer": "reported"})
    summary = client.get("/dashboard/summary").json()
    assert summary["layer"] == "reported"


def test_dashboard_analyze_rejects_unknown_layer(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    place_id = client.get("/places").json()["places"][0]["id"]

    response = client.post(
        "/dashboard/analyze",
        json={
            "place_ids": [place_id],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "layer": "nope",
        },
    )

    assert response.status_code == 422
    assert "layer must be one of" in response.text


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


def test_dashboard_incidents_returns_selected_place_rows(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]

    response = client.post(
        "/dashboard/incidents",
        json={
            "place_ids": [places[0]["id"]],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["radius_m"] == 250
    assert body["total_count"] == 1
    assert body["returned_count"] == 1
    assert body["limit"] == 100
    assert body["incidents"][0]["place_id"] == places[0]["id"]
    assert body["incidents"][0]["place_label"] == "Downtown transfer stop"
    assert body["incidents"][0]["incident_id"] == "incident-a"
    assert body["incidents"][0]["occurred_at"] == "2024-01-10T00:00:00Z"
    assert body["incidents"][0]["reported_at"] is None
    assert body["incidents"][0]["offense_category"] == "PROPERTY"
    assert body["incidents"][0]["distance_m"] < 70


def test_dashboard_incidents_respects_limit_and_total_count(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]

    response = client.post(
        "/dashboard/incidents",
        json={
            "place_ids": [place["id"] for place in places],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radii_m": [250],
            "offense_category": "PROPERTY",
            "limit": 1,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total_count"] == 2
    assert body["returned_count"] == 1
    assert len(body["incidents"]) == 1


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
        (
            "/dashboard/incidents",
            {
                "place_ids": ["selected-place"],
                "analysis_start_date": "2024-01-01",
                "analysis_end_date": "2024-01-31",
                "radii_m": [250],
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


def test_second_analyze_run_does_not_wipe_the_first(tmp_path):
    client = _client_with_places_and_crime(tmp_path)
    places = client.get("/places").json()["places"]
    body = {
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radii_m": [250],
    }

    client.post("/dashboard/analyze", json={**body, "place_ids": [places[0]["id"]]})
    client.post("/dashboard/analyze", json={**body, "place_ids": [places[1]["id"]]})

    from app.db import get_sessionmaker
    from app.models import PlaceCrimeSummary
    with get_sessionmaker()() as session:
        rows = session.query(PlaceCrimeSummary).all()
        assert {r.place_cluster_id for r in rows} >= {places[0]["id"], places[1]["id"]}
        assert all(r.analysis_run_id is not None for r in rows)
