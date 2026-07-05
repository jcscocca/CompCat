from __future__ import annotations

import gzip
import json

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.beat_geometry_service import beats_geojson_payloads, reset_beats_cache


def test_beats_payload_is_slimmed_and_complete() -> None:
    raw, gzipped = beats_geojson_payloads()
    body = json.loads(raw)
    assert body["type"] == "FeatureCollection"
    # 55 features in the bundled 2018 file; every property dict is exactly {"beat": code}.
    assert len(body["features"]) == 55
    for feature in body["features"]:
        assert set(feature["properties"].keys()) == {"beat"}
        assert isinstance(feature["properties"]["beat"], str)
        assert feature["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    # gzip bytes decompress to the same payload
    assert gzip.decompress(gzipped) == raw


def test_beats_payload_is_cached_in_process() -> None:
    reset_beats_cache()
    first_raw, _ = beats_geojson_payloads()
    second_raw, _ = beats_geojson_payloads()
    assert first_raw is second_raw  # same object — cached, not re-serialized


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    return TestClient(app)


def test_beats_endpoint_requires_session(tmp_path) -> None:
    client = _client(tmp_path)
    assert client.get("/dashboard/beats").status_code == 401


def test_beats_endpoint_serves_geojson(tmp_path) -> None:
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.get("/dashboard/beats")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/geo+json")
    body = response.json()
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) == 55
    assert set(body["features"][0]["properties"].keys()) == {"beat"}


def test_beats_endpoint_negotiates_gzip(tmp_path) -> None:
    client = _client(tmp_path)
    client.post("/sessions")
    # httpx auto-decodes the gzip body, so assert on headers; json() still works.
    response = client.get("/dashboard/beats", headers={"accept-encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["vary"] == "Accept-Encoding"
    assert response.json()["type"] == "FeatureCollection"

    plain = client.get("/dashboard/beats", headers={"accept-encoding": "identity"})
    assert plain.status_code == 200
    assert "content-encoding" not in plain.headers
    assert plain.headers["vary"] == "Accept-Encoding"
