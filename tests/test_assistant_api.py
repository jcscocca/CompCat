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


def test_assistant_chat_rejects_oversized_payload(tmp_path):
    # Session-gated but free/anonymous sessions mean the payload itself must be bounded so one
    # caller can't stuff the shared LLM node. Over-long content and too many messages both 422.
    from app.assistant.schemas import MAX_MESSAGE_CHARS, MAX_MESSAGES_PER_REQUEST

    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    oversized_content = client.post(
        "/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "x" * (MAX_MESSAGE_CHARS + 1)}],
            "dashboard_state": {},
        },
    )
    assert oversized_content.status_code == 422

    too_many_messages = client.post(
        "/assistant/chat",
        json={
            "messages": [
                {"role": "user", "content": "hi"} for _ in range(MAX_MESSAGES_PER_REQUEST + 1)
            ],
            "dashboard_state": {},
        },
    )
    assert too_many_messages.status_code == 422


def test_assistant_chat_empty_or_absent_messages_use_fixed_validation_copy(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    for payload in ({"messages": [], "dashboard_state": {}}, {"dashboard_state": {}}):
        response = client.post("/assistant/chat", json=payload)

        assert response.status_code == 422
        assert response.json() == {
            "detail": "That request didn't validate — check the values and try again."
        }
        body = response.text.lower()
        for leaked in ("pydantic", "validation error", "errors.pydantic.dev", "input_value"):
            assert leaked not in body


def test_assistant_chat_rejects_oversized_dashboard_state(tmp_path, monkeypatch):
    # dashboard_state is interpolated verbatim into the planning prompt, so leaving it
    # unbounded was the payload cap without the payload: every message under
    # MAX_MESSAGE_CHARS while megabytes went upstream, before any budget accounting.
    from app.api import routes_assistant

    def _boom(*args, **kwargs):
        raise AssertionError("an over-cap request must never reach the LLM client")

    monkeypatch.setattr(routes_assistant, "build_assistant_llm_client", _boom)
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    for state in (
        {"selected_place_ids": [f"place-{index}" for index in range(30_000)]},
        {"selected_place_ids": ["x" * 5_000]},
        {"radii_m": [10**9]},
        {"offense_category": "x" * 5_000},
    ):
        response = client.post(
            "/assistant/chat",
            json={"messages": [{"role": "user", "content": "hi"}], "dashboard_state": state},
        )
        assert response.status_code == 422, state


def test_assistant_chat_streams_agent_events(monkeypatch, tmp_path):
    from app.api import routes_assistant

    async def fake_run_assistant_turn(*args, **kwargs):
        yield AssistantStreamEvent(event="meta", data={"role": "compcat_analyst"})
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
    assert '"role": "compcat_analyst"' in response.text
    assert "event: token" in response.text
    assert '"delta": "hello"' in response.text
    assert "event: done" in response.text


def test_assistant_chat_serializes_status_and_replace_events(monkeypatch, tmp_path):
    from app.api import routes_assistant

    async def fake_run_assistant_turn(*args, **kwargs):
        yield AssistantStreamEvent(event="status", data={"label": "writing up…"})
        yield AssistantStreamEvent(event="token", data={"delta": "partial "})
        yield AssistantStreamEvent(event="replace", data={"text": "Full answer."})
        yield AssistantStreamEvent(event="done", data={})

    monkeypatch.setattr(routes_assistant, "run_assistant_turn", fake_run_assistant_turn)
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    response = client.post(
        "/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Compare my places"}],
            "dashboard_state": {"selected_place_ids": []},
        },
    )

    assert response.status_code == 200
    assert "event: status" in response.text
    assert '"label": "writing up' in response.text
    assert "event: replace" in response.text
    assert '"text": "Full answer."' in response.text
    assert "event: done" in response.text


def test_assistant_chat_emits_terminal_error_frame_when_turn_raises(monkeypatch, tmp_path):
    # An exception escaping the agent mid-stream must not truncate the SSE body:
    # the route catches it and emits a terminal error frame so the frontend never hangs.
    from app.api import routes_assistant

    async def fake_run_assistant_turn(*args, **kwargs):
        yield AssistantStreamEvent(event="token", data={"delta": "partial "})
        raise RuntimeError("boom mid-stream")

    monkeypatch.setattr(routes_assistant, "run_assistant_turn", fake_run_assistant_turn)
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    client = TestClient(app)
    client.post("/sessions")

    response = client.post(
        "/assistant/chat",
        json={
            "messages": [{"role": "user", "content": "Compare my places"}],
            "dashboard_state": {"selected_place_ids": []},
        },
    )

    assert response.status_code == 200  # headers were already sent when the turn died
    assert '"delta": "partial "' in response.text
    assert "event: error" in response.text
    assert "Couldn't reach the analyst" in response.text
    assert '"code": "internal"' in response.text
