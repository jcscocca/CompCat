from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.parsers.recurring_places import RecurringPlacesParser

FIXTURES = Path(__file__).parent / "fixtures"


def test_recurring_places_parser_creates_direct_place_inputs():
    result = RecurringPlacesParser().parse_bytes(
        (FIXTURES / "recurring_places.csv").read_bytes(),
        "recurring_places.csv",
    )

    assert result.detected_schema == "recurring_places_csv"
    assert len(result.direct_place_clusters) == 2
    assert result.direct_place_clusters[0].display_label == "Downtown transfer stop"
    assert result.direct_place_clusters[0].visit_count == 12
    assert result.direct_place_clusters[0].display_latitude == 47.609


def test_recurring_places_upload_creates_places_without_normalize(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/imports",
        headers={"X-Demo-User-Id": "demo@example.com"},
        files={
            "file": (
                "recurring_places.csv",
                (FIXTURES / "recurring_places.csv").read_bytes(),
                "text/csv",
            )
        },
    )

    assert response.status_code == 200
    assert response.json()["detected_schema"] == "recurring_places_csv"
    assert response.json()["place_cluster_count"] == 2

    places = client.get("/internal/places", headers={"X-Demo-User-Id": "demo@example.com"})
    assert places.json()["count"] == 2
