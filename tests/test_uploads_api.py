from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"


def _client(tmp_path):
    return TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'm.sqlite3'}"))


def _files():
    return {
        "file": (
            "timeline.json",
            (FIXTURES / "google_recurring.json").read_bytes(),
            "application/json",
        )
    }


def test_uploads_404_when_flag_off(tmp_path, monkeypatch):
    monkeypatch.delenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", raising=False)
    client = _client(tmp_path)
    client.post("/sessions")  # real session so the dep passes; the flag check then 404s
    assert client.post("/uploads", files=_files()).status_code == 404


def test_uploads_401_without_session(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true")
    client = _client(tmp_path)
    assert client.post("/uploads", files=_files()).status_code == 401


def test_uploads_creates_clusters_when_enabled(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true")
    client = _client(tmp_path)
    client.post("/sessions")
    response = client.post("/uploads", files=_files())
    assert response.status_code == 200
    assert response.json()["place_cluster_count"] == 1
    assert client.delete("/uploads").status_code == 200
