from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import PlaceCluster
from app.sessions import SESSION_COOKIE_NAME, public_user_hash


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    return client


def test_create_update_list_and_delete_public_place(tmp_path):
    client = _client(tmp_path)

    create_response = client.post(
        "/places",
        json={
            "display_label": "Downtown transfer stop",
            "latitude": 47.609,
            "longitude": -122.333,
            "visit_count": 12,
            "total_dwell_minutes": 360,
            "median_dwell_minutes": 30,
            "typical_days": "weekday",
            "typical_hours": "8-9",
            "sensitivity_class": "normal",
        },
    )

    assert create_response.status_code == 201
    place_id = create_response.json()["id"]
    assert create_response.json()["display_label"] == "Downtown transfer stop"
    assert create_response.json()["latitude"] == 47.609
    assert create_response.json()["longitude"] == -122.333

    update_response = client.patch(
        f"/places/{place_id}",
        json={"visit_count": 20, "display_label": "Downtown station area"},
    )

    assert update_response.status_code == 200
    assert update_response.json()["visit_count"] == 20
    assert update_response.json()["display_label"] == "Downtown station area"

    list_response = client.get("/places")
    assert list_response.status_code == 200
    assert list_response.json()["count"] == 1
    assert list_response.json()["places"][0]["id"] == place_id

    delete_response = client.delete(f"/places/{place_id}")
    assert delete_response.status_code == 204
    assert client.get("/places").json()["count"] == 0


def test_public_places_are_scoped_to_session(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    first = TestClient(app)
    second = TestClient(app)
    first.post("/sessions")
    second.post("/sessions")

    first.post(
        "/places",
        json={
            "display_label": "Library",
            "latitude": 47.621,
            "longitude": -122.321,
            "visit_count": 4,
        },
    )

    assert first.get("/places").json()["count"] == 1
    assert second.get("/places").json()["count"] == 0


def test_public_place_write_requires_session_cookie(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/places",
        json={
            "display_label": "Library",
            "latitude": 47.621,
            "longitude": -122.321,
            "visit_count": 4,
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Public session required"


def test_public_place_write_does_not_mutate_non_manual_cluster(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    user_id_hash = public_user_hash(client.cookies.get(SESSION_COOKIE_NAME))
    assert user_id_hash is not None

    session_factory = get_sessionmaker()
    with session_factory() as session:
        cluster = PlaceCluster(
            user_id_hash=user_id_hash,
            cluster_version="places-v1",
            cluster_method="dbscan",
            centroid_latitude=47.6,
            centroid_longitude=-122.3,
            display_latitude=47.6,
            display_longitude=-122.3,
            cluster_radius_m=75,
            visit_count=7,
            total_dwell_minutes=240,
            median_dwell_minutes=30,
            inferred_place_type="recurring_place",
            sensitivity_class="normal",
            display_label="Imported cluster",
            label_source="inferred",
        )
        session.add(cluster)
        session.commit()
        cluster_id = cluster.id

    patch_response = client.patch(
        f"/places/{cluster_id}",
        json={"display_label": "Mutated by public write", "visit_count": 99},
    )
    delete_response = client.delete(f"/places/{cluster_id}")

    assert patch_response.status_code == 404
    assert delete_response.status_code == 404
    with session_factory() as session:
        cluster = session.get(PlaceCluster, cluster_id)
        assert cluster is not None
        assert cluster.display_label == "Imported cluster"
        assert cluster.visit_count == 7


def test_public_place_create_rejects_whitespace_label(tmp_path):
    client = _client(tmp_path)

    response = client.post(
        "/places",
        json={
            "display_label": "   ",
            "latitude": 47.621,
            "longitude": -122.321,
            "visit_count": 4,
        },
    )

    assert response.status_code == 422


def test_bulk_place_entry_creates_ranked_places(tmp_path):
    client = _client(tmp_path)

    response = client.post(
        "/places/bulk",
        json={
            "csv_text": (
                "display_label,latitude,longitude,visit_count,total_dwell_minutes\n"
                "Downtown transfer stop,47.609,-122.333,12,360\n"
                "Library area,47.621,-122.321,6,420\n"
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["created_count"] == 2
    places = client.get("/places").json()["places"]
    assert [place["display_label"] for place in places] == [
        "Downtown transfer stop",
        "Library area",
    ]


def test_bulk_place_entry_reports_invalid_rows(tmp_path):
    client = _client(tmp_path)

    response = client.post(
        "/places/bulk",
        json={
            "csv_text": (
                "display_label,latitude,longitude,visit_count\n"
                "Missing coordinate,,,-1\n"
                "Good place,47.609,-122.333,3\n"
            )
        },
    )

    assert response.status_code == 201
    assert response.json()["created_count"] == 1
    assert response.json()["skipped_count"] == 1


def test_bulk_place_entry_requires_session_cookie(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/places/bulk",
        json={
            "csv_text": (
                "display_label,latitude,longitude,visit_count\n"
                "Good place,47.609,-122.333,3\n"
            )
        },
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Public session required"
