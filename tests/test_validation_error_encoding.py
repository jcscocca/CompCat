"""A validation error must not become a 500.

FastAPI's default handler echoes the offending input back in the error body. JSON accepts
lone surrogates (\\ud800), so an over-long field containing one is parsed fine, rejected by
pydantic, then echoed — and Starlette renders JSON with ensure_ascii=False, which raises
UnicodeEncodeError inside the handler itself. The client gets a 500 for what is a plain
bad request, and the traceback is logged as a server fault.
"""

from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.main import create_app

_HEADERS = {"content-type": "application/json"}


def _client(tmp_path) -> TestClient:
    client = TestClient(
        create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'enc.sqlite3'}"),
        raise_server_exceptions=False,
    )
    client.post("/sessions")
    return client


def test_lone_surrogate_in_an_overlong_place_label_is_422(tmp_path):
    client = _client(tmp_path)
    body = (
        b'{"display_label":"hi \\ud800' + b"x" * 300 + b'",'
        b'"latitude":47.61,"longitude":-122.33}'
    )
    response = client.post("/places", content=body, headers=_HEADERS)

    assert response.status_code == 422
    # The body must be valid, decodable JSON — not a truncated or unencodable payload.
    assert json.loads(response.content)


def test_lone_surrogate_in_an_overlong_chat_message_is_422(tmp_path):
    client = _client(tmp_path)
    body = (
        b'{"messages":[{"role":"user","content":"hi \\ud800'
        + b"x" * 100_000
        + b'"}],"dashboard_state":{}}'
    )
    response = client.post("/assistant/chat", content=body, headers=_HEADERS)

    assert response.status_code == 422
    assert json.loads(response.content)


def test_ordinary_validation_errors_still_describe_themselves(tmp_path):
    # The sanitizing handler must not flatten every 422 into an opaque blob.
    client = _client(tmp_path)
    response = client.post(
        "/places", json={"display_label": "Home", "latitude": "not-a-number"}
    )
    assert response.status_code == 422
    payload = json.loads(response.content)
    assert "detail" in payload
    assert any("latitude" in str(entry.get("loc", "")) for entry in payload["detail"])


def test_valid_non_ascii_input_is_unaffected(tmp_path):
    client = _client(tmp_path)
    response = client.post(
        "/places",
        json={"display_label": "Café 日本", "latitude": 47.61, "longitude": -122.33},
    )
    assert response.status_code == 201
    assert response.json()["display_label"] == "Café 日本"
