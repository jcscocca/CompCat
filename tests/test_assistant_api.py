from __future__ import annotations

import json
from datetime import UTC, date, datetime

from fastapi.testclient import TestClient

from app.api.routes_assistant import _sse_event
from app.assistant.schemas import AssistantStreamEvent
from app.main import create_app


def test_sse_event_serializes_date_and_datetime_tool_results():
    # Tool results from compare_places / get_dashboard_summary carry raw date and
    # datetime objects; the SSE encoder must coerce them instead of raising.
    event = AssistantStreamEvent(
        event="tool",
        data={
            "tool_name": "compare_places",
            "result": {
                "analysis_start_date": date(2024, 1, 1),
                "analysis_end_date": date(2024, 1, 31),
                "created_at": datetime(2024, 2, 1, tzinfo=UTC),
            },
        },
    )

    rendered = _sse_event(event)

    assert rendered.startswith("event: tool\n")
    payload = json.loads(rendered.split("data: ", 1)[1].strip())
    assert payload["result"]["analysis_start_date"] == "2024-01-01"
    assert payload["result"]["created_at"].startswith("2024-02-01")


def test_assistant_chat_requires_public_session(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)

    response = client.post(
        "/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Summarize this."}],
            "dashboard_state": {},
        },
    )

    assert response.status_code == 401


def test_assistant_chat_streams_agent_events(monkeypatch, tmp_path):
    from app.api import routes_assistant

    async def fake_run_assistant_turn(*args, **kwargs):
        yield AssistantStreamEvent(event="meta", data={"role": "waypoint_analyst"})
        yield AssistantStreamEvent(event="token", data={"delta": "hello"})
        yield AssistantStreamEvent(event="done", data={})

    monkeypatch.setattr(routes_assistant, "run_assistant_turn", fake_run_assistant_turn)
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    response = client.post(
        "/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Summarize this."}],
            "dashboard_state": {"selected_place_ids": []},
        },
    )

    assert response.status_code == 200
    assert "event: meta" in response.text
    assert '"role": "waypoint_analyst"' in response.text
    assert "event: token" in response.text
    assert '"delta": "hello"' in response.text
    assert "event: done" in response.text

