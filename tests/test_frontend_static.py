from fastapi.testclient import TestClient

from app.main import create_app


def _built_dashboard(tmp_path):
    static_dir = tmp_path / "static" / "dashboard"
    assets_dir = static_dir / "assets"
    assets_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text("<div id='root'></div>", encoding="utf-8")
    (assets_dir / "app.js").write_text("console.log('dashboard');", encoding="utf-8")
    return static_dir


def test_dashboard_route_serves_static_index_when_built(tmp_path, monkeypatch):
    static_dir = _built_dashboard(tmp_path)
    monkeypatch.setenv("MCA_STATIC_DASHBOARD_DIR", str(static_dir))

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "root" in response.text


def test_dashboard_fallback_and_assets_when_built(tmp_path, monkeypatch):
    static_dir = _built_dashboard(tmp_path)
    monkeypatch.setenv("MCA_STATIC_DASHBOARD_DIR", str(static_dir))

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    fallback = client.get("/dashboard-app/saved/comparison")
    asset = client.get("/assets/app.js")

    assert fallback.status_code == 200
    assert "root" in fallback.text
    assert asset.status_code == 200
    assert "dashboard" in asset.text


def test_dashboard_static_mount_does_not_shadow_dashboard_api(tmp_path, monkeypatch):
    static_dir = _built_dashboard(tmp_path)
    monkeypatch.setenv("MCA_STATIC_DASHBOARD_DIR", str(static_dir))

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    response = client.get("/dashboard/summary")

    assert response.status_code == 200
    assert response.json()["totals"]["place_count"] == 0


def test_dashboard_route_is_not_mounted_without_static_index(tmp_path, monkeypatch):
    static_dir = tmp_path / "missing-dashboard"
    monkeypatch.setenv("MCA_STATIC_DASHBOARD_DIR", str(static_dir))

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 404
