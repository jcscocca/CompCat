from __future__ import annotations

import gzip
import json

from fastapi.testclient import TestClient

from app.main import create_app
from app.services.mcpp_geometry_service import mcpp_geojson_payloads, reset_mcpp_cache


def test_mcpp_payload_is_slimmed_and_complete() -> None:
    raw, gzipped = mcpp_geojson_payloads()
    body = json.loads(raw)
    assert body["type"] == "FeatureCollection"
    assert len(body["features"]) >= 55
    for feature in body["features"]:
        assert set(feature["properties"].keys()) == {"mcpp"}
        assert feature["geometry"]["type"] in {"Polygon", "MultiPolygon"}
    assert gzip.decompress(gzipped) == raw


def test_mcpp_payload_is_cached_in_process() -> None:
    reset_mcpp_cache()
    first_raw, _ = mcpp_geojson_payloads()
    second_raw, _ = mcpp_geojson_payloads()
    assert first_raw is second_raw


def _client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    return TestClient(app)


def test_mcpp_endpoint_requires_session(tmp_path) -> None:
    client = _client(tmp_path)
    assert client.get("/dashboard/mcpp").status_code == 401


def test_mcpp_endpoint_serves_geojson_with_gzip_negotiation(tmp_path) -> None:
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.get("/dashboard/mcpp", headers={"accept-encoding": "gzip"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/geo+json")
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["vary"] == "Accept-Encoding"
    assert response.json()["type"] == "FeatureCollection"

    plain = client.get("/dashboard/mcpp", headers={"accept-encoding": "identity"})
    assert plain.status_code == 200
    assert "content-encoding" not in plain.headers
