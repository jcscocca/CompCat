from fastapi.testclient import TestClient

from app.main import create_app


def test_input_modes_hide_personal_uploads_by_default(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/input-modes")

    assert response.status_code == 200
    mode_ids = [mode["id"] for mode in response.json()["modes"]]
    assert "manual_places" in mode_ids
    assert "bulk_places" in mode_ids
    assert "public_commute_scenario" in mode_ids
    assert "personal_timeline" not in mode_ids


def test_input_modes_include_personal_uploads_when_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true")
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/input-modes")

    assert response.status_code == 200
    mode_ids = [mode["id"] for mode in response.json()["modes"]]
    assert mode_ids == [
        "manual_places",
        "bulk_places",
        "public_commute_scenario",
        "personal_timeline",
    ]
