from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


def parse_sse(text: str) -> list[dict]:
    """Split an SSE body into {event, data} dicts (data JSON-decoded)."""
    events: list[dict] = []
    for block in text.strip().split("\n\n"):
        if not block.strip():
            continue
        event: dict = {"data": None}
        for line in block.split("\n"):
            if line.startswith("event: "):
                event["event"] = line[len("event: ") :]
            elif line.startswith("data: "):
                event["data"] = json.loads(line[len("data: ") :])
        events.append(event)
    return events


@pytest.fixture()
def client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    return TestClient(app)


@pytest.fixture()
def session_client(tmp_path) -> TestClient:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")
    return client


def test_commands_requires_public_session(client):
    response = client.post("/assistant/commands", json={"command": "suggest_followups"})
    assert response.status_code == 401


def test_commands_rejects_unknown_and_unadvertised_commands(session_client):
    # Unknown entirely.
    response = session_client.post("/assistant/commands", json={"command": "drop_tables"})
    assert response.status_code == 422
    # Real tool handlers that are NOT in the command enum must be unreachable.
    for forbidden in (
        "run_place_analysis",
        "get_neighborhood_analysis",
        "get_incident_details",
        "get_dashboard_summary",
    ):
        response = session_client.post("/assistant/commands", json={"command": forbidden})
        assert response.status_code == 422, forbidden


def test_commands_streams_tool_summary_done_without_llm(session_client, monkeypatch):
    # Constructing an LLM client on this path is a bug — make it explode if tried.
    from app.api import routes_assistant

    def _boom(*args, **kwargs):
        raise AssertionError("commands must never build an LLM client")

    monkeypatch.setattr(routes_assistant, "build_assistant_llm_client", _boom)
    response = session_client.post("/assistant/commands", json={"command": "suggest_followups"})
    assert response.status_code == 200
    events = parse_sse(response.text)
    names = [e["event"] for e in events]
    assert names[0] == "meta" and events[0]["data"]["mode"] == "command"
    assert "tool" in names and names[-1] == "done"
    tool = next(e for e in events if e["event"] == "tool")
    assert tool["data"]["tool_name"] == "suggest_followups"
    assert isinstance(tool["data"]["result"]["suggestions"], list)


def test_commands_compare_places_runs_with_window(session_client):
    # The chip path sends explicit window args (no LLM backfills them) — the command must
    # run the comparison, not clarify about a missing window.
    ids = []
    for label, lat, lon in (("Home", 47.61, -122.33), ("Work", 47.62, -122.34)):
        response = session_client.post(
            "/places",
            json={"display_label": label, "latitude": lat, "longitude": lon, "visit_count": 1},
        )
        assert response.status_code == 201
        ids.append(response.json()["id"])

    response = session_client.post(
        "/assistant/commands",
        json={
            "command": "compare_places",
            "arguments": {
                "place_ids": ids,
                "radius_m": 250,
                "analysis_start_date": "2026-01-01",
                "analysis_end_date": "2026-06-30",
                "layer": "reported",
            },
        },
    )
    assert response.status_code == 200
    events = parse_sse(response.text)
    tool = next(e for e in events if e["event"] == "tool")
    assert tool["data"]["tool_name"] == "compare_places"
    assert sorted(tool["data"]["result"]["place_ids"]) == sorted(ids)
    assert tool["data"]["result"]["comparison"] is not None
    assert events[-1]["event"] == "done"


def test_commands_update_filters_roundtrip(session_client):
    response = session_client.post(
        "/assistant/commands",
        json={"command": "update_filters", "arguments": {"radius_m": 500}},
    )
    events = parse_sse(response.text)
    tool = next(e for e in events if e["event"] == "tool")
    assert tool["data"]["result"]["patch"] == {"radius_m": 500}


def test_commands_tool_error_carries_code(session_client):
    response = session_client.post(
        "/assistant/commands",
        json={"command": "update_filters", "arguments": {"radius_m": 5}},
    )
    events = parse_sse(response.text)
    error = next(e for e in events if e["event"] == "error")
    assert error["data"]["code"] == "tool_error"
    assert error["data"]["message"]


def test_commands_clarification_streams_as_token(session_client):
    response = session_client.post("/assistant/commands", json={"command": "update_filters"})
    events = parse_sse(response.text)
    assert any(
        e["event"] == "token" and "which filter" in e["data"]["delta"] for e in events
    )
    assert events[-1]["event"] == "done"


def test_commands_internal_error_emits_coded_terminal_frame(session_client, monkeypatch):
    # An unexpected exception mid-stream must not truncate the SSE body: the route
    # terminates with a coded error frame (and no done after it).
    from app.api import routes_assistant

    def _boom(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(routes_assistant, "execute_tool", _boom)
    response = session_client.post("/assistant/commands", json={"command": "suggest_followups"})
    assert response.status_code == 200
    events = parse_sse(response.text)
    assert events[-1]["event"] == "error"
    assert events[-1]["data"]["code"] == "internal"
    assert events[-1]["data"]["message"] == "That didn't go through. Try again in a moment."
    assert all(e["event"] != "done" for e in events)


def test_commands_rate_limited_per_session(tmp_path, monkeypatch):
    # Mirror tests/test_ratelimit_api.py: enable limiting with a tiny per-session
    # capacity via env, then exhaust it. The reset_rate_limiter autouse fixture keeps
    # buckets from leaking across tests.
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_RATE_LIMIT_ASSISTANT_COMMANDS_PER_HOUR", "1")
    monkeypatch.setenv("MCA_TRUST_PROXY_HEADERS", "false")
    app = create_app(f"sqlite+pysqlite:///{tmp_path}/rlc.sqlite3")
    client = TestClient(app)
    client.post("/sessions")

    first = client.post(
        "/assistant/commands",
        json={"command": "update_filters", "arguments": {"radius_m": 500}},
    )
    assert first.status_code == 200
    second = client.post(
        "/assistant/commands",
        json={"command": "update_filters", "arguments": {"radius_m": 500}},
    )
    assert second.status_code == 429
    assert "Retry-After" in second.headers
    detail = second.json()["detail"].lower()
    assert "request" in detail or "limit" in detail
