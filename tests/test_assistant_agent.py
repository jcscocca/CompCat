from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime
from typing import Any

from app.assistant.agent import run_assistant_turn
from app.assistant.schemas import AssistantChatMessage, AssistantDashboardState
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster


class FakeClient:
    def __init__(self, responses: list[str]) -> None:
        self.responses = responses
        self.calls: list[list[dict[str, str]]] = []

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self.calls.append(messages)
        return self.responses.pop(0)


async def _collect(*args: Any):
    return [event async for event in run_assistant_turn(*args)]


def _session_with_place_and_crime(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    user_hash = "user-1"
    session.add(
        PlaceCluster(
            id="place-1",
            user_id_hash=user_hash,
            cluster_version="manual-v1",
            cluster_method="manual",
            centroid_latitude=47.61,
            centroid_longitude=-122.33,
            display_latitude=47.61,
            display_longitude=-122.33,
            visit_count=3,
            sensitivity_class="normal",
            display_label="Library stop",
            inferred_place_type="manual_place",
            label_source="test",
        )
    )
    session.add(
        CrimeIncident(
            id="incident-1",
            offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
            offense_category="PROPERTY",
            latitude=47.6101,
            longitude=-122.3301,
        )
    )
    session.commit()
    return session, user_hash


def test_agent_returns_final_answer_without_tool(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(['{"type":"final","message":"There is one saved place."}'])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="What do you see?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    assert events[1].data["delta"] == "There is one saved place."
    assert len(client.calls) == 1


def test_agent_executes_run_place_analysis_tool_call(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        [
            (
                '{"type":"tool_call","tool_name":"run_place_analysis",'
                '"arguments":{"place_ids":["place-1"],'
                '"analysis_start_date":"2024-01-01",'
                '"analysis_end_date":"2024-01-31",'
                '"radii_m":[250],"offense_category":"PROPERTY"}}'
            ),
            '{"type":"final","message":"I found 1 reported incident in the selected context."}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Run this for January.")],
                AssistantDashboardState(
                    selected_place_ids=["place-1"],
                    analysis_start_date=date(2024, 1, 1),
                    analysis_end_date=date(2024, 1, 31),
                    radii_m=[250],
                    offense_category="PROPERTY",
                ),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "tool", "token", "done"]
    assert events[1].data["tool_name"] == "run_place_analysis"
    assert events[1].data["result"]["summary_count"] == 1
    assert "reported incident" in events[2].data["delta"]
    assert len(client.calls) == 2


def test_agent_chains_two_tool_calls_then_narrates(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient(
        [
            (
                '{"type":"tool_call","tool_name":"run_place_analysis",'
                '"arguments":{"place_ids":["place-1"],'
                '"analysis_start_date":"2024-01-01",'
                '"analysis_end_date":"2024-01-31",'
                '"radii_m":[250],"offense_category":"PROPERTY"}}'
            ),
            '{"type":"tool_call","tool_name":"suggest_followups","arguments":{}}',
            '{"type":"final","message":"One reported incident, with follow-up ideas."}',
        ]
    )
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Analyze then suggest follow-ups.")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "tool", "tool", "token", "done"]
    assert events[1].data["tool_name"] == "run_place_analysis"
    assert events[2].data["tool_name"] == "suggest_followups"
    # planning + one follow-up call per tool result == 3 model calls
    assert len(client.calls) == 3


def test_agent_stops_executing_tools_at_the_configured_budget(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    # A model that never stops requesting tools must be capped at assistant_max_tool_calls (2).
    client = FakeClient(['{"type":"tool_call","tool_name":"suggest_followups","arguments":{}}'] * 3)
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Keep going.")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    tool_events = [event for event in events if event.event == "tool"]
    assert len(tool_events) == 2
    assert events[-1].event == "error"


def test_agent_redirects_safe_unsafe_language_without_model_call(tmp_path):
    session, user_hash = _session_with_place_and_crime(tmp_path)
    client = FakeClient([])
    try:
        events = asyncio.run(
            _collect(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="Which place is safest?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        )
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    assert "reported incident context" in events[1].data["delta"]
    assert client.calls == []

