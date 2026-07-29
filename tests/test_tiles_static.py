from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("MCA_TILES_DIR", str(tmp_path))
    return TestClient(create_app("sqlite+pysqlite:///:memory:"))


def test_tiles_file_served_with_byte_ranges(tmp_path, monkeypatch) -> None:
    # PMTiles clients read the file via HTTP Range requests; 206 support is load-bearing.
    (tmp_path / "seattle.pmtiles").write_bytes(b"PMTiles-test-payload")
    client = _client(tmp_path, monkeypatch)

    full = client.get("/tiles/seattle.pmtiles")
    assert full.status_code == 416
    assert full.headers["content-range"] == "bytes */20"

    part = client.get("/tiles/seattle.pmtiles", headers={"Range": "bytes=0-6"})
    assert part.status_code == 206
    assert part.content == b"PMTiles"
    assert client.head("/tiles/seattle.pmtiles").status_code == 200


def test_pmtiles_range_limit_handles_normal_map_panning_volume(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_BURST_PER_MINUTE", "1")
    monkeypatch.setenv("MCA_RATE_LIMIT_TILES_PER_MINUTE", "8")
    (tmp_path / "seattle.pmtiles").write_bytes(b"PMTiles-test-payload")
    client = _client(tmp_path, monkeypatch)

    statuses = [
        client.get("/tiles/seattle.pmtiles", headers={"Range": "bytes=0-6"}).status_code
        for _ in range(8)
    ]
    assert statuses == [206] * 8


def test_pmtiles_range_limit_is_enforced_per_ip(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_TILES_PER_MINUTE", "2")
    (tmp_path / "seattle.pmtiles").write_bytes(b"PMTiles-test-payload")
    client = _client(tmp_path, monkeypatch)

    statuses = [
        client.get("/tiles/seattle.pmtiles", headers={"Range": "bytes=0-6"}).status_code
        for _ in range(3)
    ]
    assert statuses == [206, 206, 429]


def test_pmtiles_default_bucket_supports_map_panning_volume() -> None:
    from app.config import Settings

    assert Settings(_env_file=None).rate_limit_tiles_per_minute == 600


def test_missing_tiles_file_is_404_not_boot_failure(tmp_path, monkeypatch) -> None:
    client = _client(tmp_path, monkeypatch)
    assert client.get("/tiles/seattle.pmtiles").status_code == 404
    # The rest of the app still works without the artifact.
    assert client.get("/health").status_code == 200


def test_built_dashboard_serves_basemap_glyphs_and_sprites(tmp_path, monkeypatch) -> None:
    # Vite copies frontend/public/basemaps-assets/ into the built dashboard dir; the
    # map style requests them at /basemaps-assets/. The vite dev server masks a missing
    # backend mount, so this pins production serving.
    static_dir = tmp_path / "dashboard"
    (static_dir / "assets").mkdir(parents=True)
    (static_dir / "index.html").write_text("<html></html>")
    fonts_dir = static_dir / "basemaps-assets" / "fonts" / "Noto Sans Regular"
    fonts_dir.mkdir(parents=True)
    (fonts_dir / "0-255.pbf").write_bytes(b"glyphs")
    monkeypatch.setenv("MCA_STATIC_DASHBOARD_DIR", str(static_dir))

    client = TestClient(create_app("sqlite+pysqlite:///:memory:"))
    response = client.get("/basemaps-assets/fonts/Noto%20Sans%20Regular/0-255.pbf")
    assert response.status_code == 200
    assert response.content == b"glyphs"


def test_built_dashboard_serves_selfhosted_ui_fonts(tmp_path, monkeypatch) -> None:
    # Vite copies frontend/public/fonts/ into the built dashboard dir; fonts.css
    # requests them at /fonts/. The vite dev server masks a missing backend mount,
    # so this pins production serving (same seam as /basemaps-assets above).
    static_dir = tmp_path / "dashboard"
    (static_dir / "assets").mkdir(parents=True)
    (static_dir / "index.html").write_text("<html></html>")
    ui_fonts_dir = static_dir / "fonts"
    ui_fonts_dir.mkdir(parents=True)
    (ui_fonts_dir / "archivo-var.woff2").write_bytes(b"wOF2-test")
    monkeypatch.setenv("MCA_STATIC_DASHBOARD_DIR", str(static_dir))

    client = TestClient(create_app("sqlite+pysqlite:///:memory:"))
    response = client.get("/fonts/archivo-var.woff2")
    assert response.status_code == 200
    assert response.content == b"wOF2-test"
