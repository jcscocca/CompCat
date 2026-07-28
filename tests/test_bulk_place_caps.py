"""Row cap and transaction shape for bulk place entry.

The CSV body cap alone allows thousands of tiny rows, and the original loop committed
once per row — so a large paste was N transactions of unbounded N.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.db import get_sessionmaker
from app.main import create_app
from app.models import PlaceCluster
from app.places.schemas import MAX_BULK_PLACE_ROWS


def _client(tmp_path) -> TestClient:
    client = TestClient(create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'bulk.sqlite3'}"))
    client.post("/sessions")
    return client


def _csv(rows: int) -> str:
    header = "display_label,latitude,longitude,visit_count\n"
    body = "".join(f"Place {i},47.609,-122.333,3\n" for i in range(rows))
    return header + body


def test_bulk_entry_rejects_more_rows_than_the_cap(tmp_path):
    client = _client(tmp_path)
    response = client.post("/places/bulk", json={"csv_text": _csv(MAX_BULK_PLACE_ROWS + 1)})
    assert response.status_code == 422
    assert str(MAX_BULK_PLACE_ROWS) in response.text


def test_bulk_entry_accepts_a_batch_at_the_cap(tmp_path):
    client = _client(tmp_path)
    response = client.post("/places/bulk", json={"csv_text": _csv(MAX_BULK_PLACE_ROWS)})
    assert response.status_code == 201
    assert response.json()["created_count"] == MAX_BULK_PLACE_ROWS


def test_bulk_entry_commits_the_whole_batch_once(tmp_path, monkeypatch):
    client = _client(tmp_path)
    from app.services import manual_place_service

    commits = 0
    original = manual_place_service.Session.commit

    def counting_commit(self, *args, **kwargs):
        nonlocal commits
        commits += 1
        return original(self, *args, **kwargs)

    monkeypatch.setattr(manual_place_service.Session, "commit", counting_commit)
    response = client.post("/places/bulk", json={"csv_text": _csv(5)})

    assert response.status_code == 201
    assert response.json()["created_count"] == 5
    assert commits == 1

    session = get_sessionmaker()()
    assert session.query(PlaceCluster).count() == 5
    session.close()
