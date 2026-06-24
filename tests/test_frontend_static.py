from fastapi.testclient import TestClient

from app.main import create_app


def test_dashboard_route_serves_static_index_when_built(tmp_path, monkeypatch):
    static_dir = tmp_path / "static" / "dashboard"
    static_dir.mkdir(parents=True)
    (static_dir / "index.html").write_text("<div id='root'></div>", encoding="utf-8")
    monkeypatch.setenv("MCA_STATIC_DASHBOARD_DIR", str(static_dir))

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/")

    assert response.status_code == 200
    assert "root" in response.text
