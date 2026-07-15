from fastapi.testclient import TestClient

from app.main import create_app


def test_input_modes_hide_personal_uploads_by_default(tmp_path, monkeypatch):
    monkeypatch.delenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", raising=False)
    monkeypatch.chdir(tmp_path)
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/input-modes")

    assert response.status_code == 200
    modes = response.json()["modes"]
    mode_ids = [mode["id"] for mode in modes]
    assert mode_ids == ["manual_places", "bulk_places"]

    bulk_mode = next(mode for mode in modes if mode["id"] == "bulk_places")
    assert bulk_mode["required_columns"] == ["latitude", "longitude"]
    assert bulk_mode["optional_columns"][0] == "display_label"


def test_input_modes_include_personal_uploads_when_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true")
    monkeypatch.chdir(tmp_path)
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.get("/input-modes")

    assert response.status_code == 200
    mode_ids = [mode["id"] for mode in response.json()["modes"]]
    assert mode_ids == [
        "manual_places",
        "bulk_places",
        "personal_timeline",
    ]
