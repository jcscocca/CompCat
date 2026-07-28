"""Manual places must land inside the area CompCat has data for.

/places accepted any point on Earth while the shared-view AnalysisPoint path enforced a
Seattle bbox. A place outside Seattle can never produce incident context, so it is a
silent dead end rather than a validation error.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app

TOKYO = {"latitude": 35.6762, "longitude": 139.6503}
DOWNTOWN = {"latitude": 47.6094, "longitude": -122.3334}


def _client(tmp_path) -> TestClient:
    client = TestClient(
        create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'bounds.sqlite3'}")
    )
    client.post("/sessions")
    return client


def test_downtown_seattle_place_is_accepted(tmp_path):
    client = _client(tmp_path)
    response = client.post("/places", json={"display_label": "Home", **DOWNTOWN})
    assert response.status_code == 201


def test_tokyo_place_is_rejected(tmp_path):
    client = _client(tmp_path)
    response = client.post("/places", json={"display_label": "Shibuya", **TOKYO})
    assert response.status_code == 422
    assert "Seattle" in response.text


def test_patch_to_tokyo_is_rejected(tmp_path):
    client = _client(tmp_path)
    place_id = client.post("/places", json={"display_label": "Home", **DOWNTOWN}).json()["id"]
    response = client.patch(f"/places/{place_id}", json=TOKYO)
    assert response.status_code == 422
    assert "Seattle" in response.text


def test_patch_within_seattle_is_accepted(tmp_path):
    client = _client(tmp_path)
    place_id = client.post("/places", json={"display_label": "Home", **DOWNTOWN}).json()["id"]
    response = client.patch(f"/places/{place_id}", json={"latitude": 47.6206})
    assert response.status_code == 200


def test_bulk_skips_out_of_area_rows(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/places/bulk",
        json={
            "csv_text": (
                "display_label,latitude,longitude,visit_count\n"
                "Shibuya,35.6762,139.6503,3\n"
                "Downtown,47.6094,-122.3334,3\n"
            )
        },
    )
    assert response.status_code == 201
    assert response.json()["created_count"] == 1
    assert response.json()["skipped_count"] == 1
    assert [p["display_label"] for p in response.json()["places"]] == ["Downtown"]
